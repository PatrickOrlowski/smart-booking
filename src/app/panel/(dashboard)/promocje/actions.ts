"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import {
  ForbiddenError,
  UnauthorizedError,
  requireBusinessManager,
} from "@/lib/authz";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { normalizeDiscountCode } from "@/lib/discounts";
import {
  findUsablePackagesForCustomer,
  packageExpiryDate,
} from "@/lib/packages";
import { localDayMinutesToUtc } from "@/lib/time";
import { DiscountType } from "@/generated/prisma/enums";

/**
 * Kody rabatowe i karnety — mutacje panelu firmy.
 *
 * Każda akcja przechodzi przez `requireBusinessManager` (szeregowy pracownik
 * nie zmienia cennika ani promocji) i weryfikuje każdy identyfikator
 * względem firmy: multi-tenant nie może polegać na tym, co przyszło z formularza.
 */

type ActionResult = { ok: true } | { ok: false; error: string };

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
    return { ok: false, error: error.message };
  }
  console.error(fallback, error);
  return { ok: false, error: fallback };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Strefa lokalu — daty ważności kodu wpisujemy w kalendarzu firmy, nie w UTC. */
async function businessTimezone(businessId: string): Promise<string> {
  const location = await prisma.location.findFirst({
    where: { businessId },
    orderBy: { createdAt: "asc" },
    select: { timezone: true },
  });
  return location?.timezone ?? "Europe/Warsaw";
}

const parseDay = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return { year: year!, month: month!, day: day! };
};

// ---------------------------------------------------------------------------
// Kody rabatowe
// ---------------------------------------------------------------------------

const saveCodeSchema = z
  .object({
    businessId: z.string().min(1),
    codeId: z.string().min(1).optional(),
    code: z.string().trim().min(3, "Kod musi mieć min. 3 znaki").max(32),
    description: z.string().trim().max(200).optional(),
    type: z.enum(DiscountType),
    value: z.number().int().min(1, "Wartość musi być większa od zera"),
    minAmountCents: z.number().int().min(0).max(1_000_000).nullable(),
    maxUses: z.number().int().min(1).max(1_000_000).nullable(),
    maxUsesPerCustomer: z.number().int().min(0).max(1000),
    validFrom: z.string().regex(DATE_RE).nullable(),
    validTo: z.string().regex(DATE_RE).nullable(),
    isActive: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "PERCENT" && (data.value < 1 || data.value > 100)) {
      ctx.addIssue({
        code: "custom",
        message: "Rabat procentowy mieści się w przedziale 1–100%",
        path: ["value"],
      });
    }
    if (data.type === "AMOUNT" && data.value > 1_000_000) {
      ctx.addIssue({
        code: "custom",
        message: "Rabat kwotowy nie może przekraczać 10 000 zł",
        path: ["value"],
      });
    }
    if (data.validFrom && data.validTo && data.validTo < data.validFrom) {
      ctx.addIssue({
        code: "custom",
        message: "Koniec ważności nie może wypadać przed początkiem",
        path: ["validTo"],
      });
    }
  });

/** Dodanie albo edycja kodu rabatowego. Kod jest unikalny w obrębie firmy. */
export async function saveDiscountCodeAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = saveCodeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane kodu",
    };
  }
  const data = parsed.data;

  const code = normalizeDiscountCode(data.code);
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
    return {
      ok: false,
      error: "Kod może zawierać wyłącznie litery, cyfry, myślnik i podkreślenie",
    };
  }

  try {
    const { user } = await requireBusinessManager(data.businessId);
    const timezone = await businessTimezone(data.businessId);

    // Ważność liczona w kalendarzu lokalu: „od" to północ dnia startowego,
    // „do" to północ dnia NASTĘPNEGO po ostatnim dniu ważności — dzięki temu
    // kod działa przez cały wskazany dzień (kalkulacja traktuje validTo jako
    // granicę otwartą).
    const validFrom = data.validFrom
      ? localDayMinutesToUtc(parseDay(data.validFrom), 0, timezone)
      : null;
    const validTo = data.validTo
      ? localDayMinutesToUtc(parseDay(data.validTo), 24 * 60, timezone)
      : null;

    const payload = {
      code,
      description: data.description || null,
      type: data.type,
      value: data.value,
      minAmountCents: data.minAmountCents,
      maxUses: data.maxUses,
      maxUsesPerCustomer: data.maxUsesPerCustomer,
      validFrom,
      validTo,
      isActive: data.isActive,
    };

    if (data.codeId) {
      const existing = await prisma.discountCode.findFirst({
        where: { id: data.codeId, businessId: data.businessId },
        select: { id: true, usedCount: true },
      });
      if (!existing) return { ok: false, error: "Nie znaleziono kodu" };

      await prisma.discountCode.update({
        where: { id: existing.id },
        data: payload,
      });
      await logAudit({
        businessId: data.businessId,
        actorUserId: user.id,
        action: "DISCOUNT_CODE_UPDATED",
        entityType: "DiscountCode",
        entityId: existing.id,
        metadata: { code, type: data.type, value: data.value },
      });
    } else {
      const created = await prisma.discountCode.create({
        data: { ...payload, businessId: data.businessId },
        select: { id: true },
      });
      await logAudit({
        businessId: data.businessId,
        actorUserId: user.id,
        action: "DISCOUNT_CODE_CREATED",
        entityType: "DiscountCode",
        entityId: created.id,
        metadata: { code, type: data.type, value: data.value },
      });
    }
  } catch (error) {
    // Unikalność [businessId, code] pilnuje baza — kolizja to komunikat
    // dla użytkownika, nie 500.
    if (isUniqueConstraintError(error)) {
      return {
        ok: false,
        error: `Kod ${code} już istnieje w Twojej firmie. Wybierz inny.`,
      };
    }
    return failure(error, "Nie udało się zapisać kodu rabatowego");
  }

  revalidatePath("/panel/promocje");
  return { ok: true };
}

const toggleCodeSchema = z.object({
  businessId: z.string().min(1),
  codeId: z.string().min(1),
  isActive: z.boolean(),
});

/** Włączenie/wyłączenie kodu przełącznikiem na liście. */
export async function toggleDiscountCodeAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = toggleCodeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  try {
    const { user } = await requireBusinessManager(data.businessId);
    const updated = await prisma.discountCode.updateMany({
      where: { id: data.codeId, businessId: data.businessId },
      data: { isActive: data.isActive },
    });
    if (updated.count === 0) return { ok: false, error: "Nie znaleziono kodu" };
    await logAudit({
      businessId: data.businessId,
      actorUserId: user.id,
      action: data.isActive ? "DISCOUNT_CODE_ENABLED" : "DISCOUNT_CODE_DISABLED",
      entityType: "DiscountCode",
      entityId: data.codeId,
    });
  } catch (error) {
    return failure(error, "Nie udało się zmienić statusu kodu");
  }

  revalidatePath("/panel/promocje");
  return { ok: true };
}

const deleteCodeSchema = z.object({
  businessId: z.string().min(1),
  codeId: z.string().min(1),
});

/**
 * Usunięcie kodu. Kod z historią użyć NIE znika z bazy — zostaje
 * dezaktywowany, żeby nie osierocić wierszy DiscountRedemption
 * i rezerwacji, które się na niego powołują.
 */
export async function deleteDiscountCodeAction(
  input: unknown,
): Promise<{ ok: true; deactivated: boolean } | { ok: false; error: string }> {
  const parsed = deleteCodeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  let deactivated = false;
  try {
    const { user } = await requireBusinessManager(data.businessId);
    const code = await prisma.discountCode.findFirst({
      where: { id: data.codeId, businessId: data.businessId },
      select: {
        id: true,
        code: true,
        usedCount: true,
        _count: { select: { redemptions: true, bookings: true } },
      },
    });
    if (!code) return { ok: false, error: "Nie znaleziono kodu" };

    const used =
      code.usedCount > 0 ||
      code._count.redemptions > 0 ||
      code._count.bookings > 0;
    if (used) {
      await prisma.discountCode.update({
        where: { id: code.id },
        data: { isActive: false },
      });
      deactivated = true;
    } else {
      await prisma.discountCode.delete({ where: { id: code.id } });
    }
    await logAudit({
      businessId: data.businessId,
      actorUserId: user.id,
      action: deactivated ? "DISCOUNT_CODE_DISABLED" : "DISCOUNT_CODE_DELETED",
      entityType: "DiscountCode",
      entityId: code.id,
      metadata: { code: code.code },
    });
  } catch (error) {
    return failure(error, "Nie udało się usunąć kodu rabatowego");
  }

  revalidatePath("/panel/promocje");
  return { ok: true, deactivated };
}

// ---------------------------------------------------------------------------
// Karnety
// ---------------------------------------------------------------------------

const savePackageSchema = z.object({
  businessId: z.string().min(1),
  packageId: z.string().min(1).optional(),
  name: z.string().trim().min(3, "Podaj nazwę karnetu").max(120),
  description: z.string().trim().max(400).optional(),
  /** null = karnet na dowolną usługę firmy. */
  serviceId: z.string().min(1).nullable(),
  entries: z.number().int().min(1, "Karnet musi mieć min. 1 wejście").max(500),
  priceCents: z.number().int().min(0).max(10_000_000),
  validityDays: z.number().int().min(1).max(3650),
  isActive: z.boolean(),
});

/** Dodanie albo edycja karnetu w ofercie firmy. */
export async function savePackageAction(input: unknown): Promise<ActionResult> {
  const parsed = savePackageSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane karnetu",
    };
  }
  const data = parsed.data;

  try {
    const { user } = await requireBusinessManager(data.businessId);

    if (data.serviceId) {
      const service = await prisma.service.findFirst({
        where: {
          id: data.serviceId,
          businessId: data.businessId,
          kind: "STANDARD",
        },
        select: { id: true },
      });
      if (!service) return { ok: false, error: "Nie znaleziono usługi" };
    }

    const payload = {
      name: data.name,
      description: data.description || null,
      serviceId: data.serviceId,
      entries: data.entries,
      priceCents: data.priceCents,
      validityDays: data.validityDays,
      isActive: data.isActive,
    };

    if (data.packageId) {
      const existing = await prisma.servicePackage.findFirst({
        where: { id: data.packageId, businessId: data.businessId },
        select: { id: true },
      });
      if (!existing) return { ok: false, error: "Nie znaleziono karnetu" };
      // Liczba wejść na JUŻ SPRZEDANYCH egzemplarzach się nie zmienia —
      // CustomerPackage ma własne entriesTotal utrwalone przy sprzedaży.
      await prisma.servicePackage.update({
        where: { id: existing.id },
        data: payload,
      });
      await logAudit({
        businessId: data.businessId,
        actorUserId: user.id,
        action: "PACKAGE_UPDATED",
        entityType: "ServicePackage",
        entityId: existing.id,
        metadata: { name: data.name },
      });
    } else {
      const created = await prisma.servicePackage.create({
        data: { ...payload, businessId: data.businessId },
        select: { id: true },
      });
      await logAudit({
        businessId: data.businessId,
        actorUserId: user.id,
        action: "PACKAGE_CREATED",
        entityType: "ServicePackage",
        entityId: created.id,
        metadata: { name: data.name, entries: data.entries },
      });
    }
  } catch (error) {
    return failure(error, "Nie udało się zapisać karnetu");
  }

  revalidatePath("/panel/promocje");
  return { ok: true };
}

const togglePackageSchema = z.object({
  businessId: z.string().min(1),
  packageId: z.string().min(1),
  isActive: z.boolean(),
});

export async function togglePackageAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = togglePackageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  try {
    await requireBusinessManager(data.businessId);
    const updated = await prisma.servicePackage.updateMany({
      where: { id: data.packageId, businessId: data.businessId },
      data: { isActive: data.isActive },
    });
    if (updated.count === 0) {
      return { ok: false, error: "Nie znaleziono karnetu" };
    }
  } catch (error) {
    return failure(error, "Nie udało się zmienić statusu karnetu");
  }

  revalidatePath("/panel/promocje");
  return { ok: true };
}

const deletePackageSchema = z.object({
  businessId: z.string().min(1),
  packageId: z.string().min(1),
});

/**
 * Usunięcie karnetu z oferty. Karnet ze sprzedanymi egzemplarzami zostaje
 * dezaktywowany — wykupione wejścia klientów muszą działać dalej.
 */
export async function deletePackageAction(
  input: unknown,
): Promise<{ ok: true; deactivated: boolean } | { ok: false; error: string }> {
  const parsed = deletePackageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  let deactivated = false;
  try {
    await requireBusinessManager(data.businessId);
    const pkg = await prisma.servicePackage.findFirst({
      where: { id: data.packageId, businessId: data.businessId },
      select: { id: true, _count: { select: { sold: true } } },
    });
    if (!pkg) return { ok: false, error: "Nie znaleziono karnetu" };

    if (pkg._count.sold > 0) {
      await prisma.servicePackage.update({
        where: { id: pkg.id },
        data: { isActive: false },
      });
      deactivated = true;
    } else {
      await prisma.servicePackage.delete({ where: { id: pkg.id } });
    }
  } catch (error) {
    return failure(error, "Nie udało się usunąć karnetu");
  }

  revalidatePath("/panel/promocje");
  return { ok: true, deactivated };
}

const sellPackageSchema = z.object({
  businessId: z.string().min(1),
  packageId: z.string().min(1),
  customerId: z.string().min(1),
});

/**
 * Sprzedaż karnetu klientowi: powstaje CustomerPackage z własną liczbą wejść
 * i datą ważności (teraz + validityDays karnetu).
 *
 * Wpisu Payment celowo nie zakładamy — model Payment wymaga `bookingId`,
 * a sprzedaż karnetu nie ma rezerwacji (patrz raport, schematu nie ruszamy).
 */
export async function sellPackageAction(
  input: unknown,
): Promise<{ ok: true; expiresAt: string } | { ok: false; error: string }> {
  const parsed = sellPackageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane sprzedaży" };
  const data = parsed.data;

  let expiresAt: Date;
  try {
    const { user } = await requireBusinessManager(data.businessId);

    const [pkg, customer] = await Promise.all([
      prisma.servicePackage.findFirst({
        where: { id: data.packageId, businessId: data.businessId },
        select: {
          id: true,
          name: true,
          entries: true,
          priceCents: true,
          validityDays: true,
          isActive: true,
        },
      }),
      prisma.customer.findFirst({
        where: { id: data.customerId, businessId: data.businessId },
        select: { id: true, fullName: true },
      }),
    ]);
    if (!pkg) return { ok: false, error: "Nie znaleziono karnetu" };
    if (!customer) return { ok: false, error: "Nie znaleziono klienta" };
    if (!pkg.isActive) {
      return {
        ok: false,
        error: "Karnet jest wyłączony ze sprzedaży — włącz go najpierw.",
      };
    }

    const purchasedAt = new Date();
    expiresAt = packageExpiryDate(pkg.validityDays, purchasedAt);

    const sold = await prisma.customerPackage.create({
      data: {
        packageId: pkg.id,
        businessId: data.businessId,
        customerId: customer.id,
        entriesTotal: pkg.entries,
        purchasedAt,
        expiresAt,
      },
      select: { id: true },
    });

    await logAudit({
      businessId: data.businessId,
      actorUserId: user.id,
      action: "PACKAGE_SOLD",
      entityType: "CustomerPackage",
      entityId: sold.id,
      metadata: {
        packageName: pkg.name,
        customerId: customer.id,
        entries: pkg.entries,
        priceCents: pkg.priceCents,
        expiresAt: expiresAt.toISOString(),
      },
    });
  } catch (error) {
    return failure(error, "Nie udało się sprzedać karnetu");
  }

  revalidatePath("/panel/promocje");
  revalidatePath("/panel/klienci");
  return { ok: true, expiresAt: expiresAt.toISOString() };
}

const customerPackagesSchema = z.object({
  businessId: z.string().min(1),
  customerId: z.string().min(1),
  serviceId: z.string().min(1).optional(),
});

export type UsablePackageOption = {
  id: string;
  packageName: string;
  entriesLeft: number;
  entriesTotal: number;
};

/**
 * Karnety klienta możliwe do użycia przy ręcznej wizycie — podpowiedź dla
 * dialogu „Dodaj wizytę". Sam zapis wejścia dzieje się przy tworzeniu
 * rezerwacji, w transakcji (patrz `consumePackageEntry`).
 */
export async function findCustomerPackagesAction(
  input: unknown,
): Promise<
  { ok: true; packages: UsablePackageOption[] } | { ok: false; error: string }
> {
  const parsed = customerPackagesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  try {
    await requireBusinessManager(data.businessId);
    const rows = await findUsablePackagesForCustomer(prisma, {
      businessId: data.businessId,
      customerId: data.customerId,
      serviceId: data.serviceId ?? null,
    });
    return {
      ok: true,
      packages: rows.map((row) => ({
        id: row.id,
        packageName: row.packageName,
        entriesLeft: Math.max(0, row.entriesTotal - row.entriesUsed),
        entriesTotal: row.entriesTotal,
      })),
    };
  } catch (error) {
    return failure(error, "Nie udało się sprawdzić karnetów klienta");
  }
}

const cancelCustomerPackageSchema = z.object({
  businessId: z.string().min(1),
  customerPackageId: z.string().min(1),
});

/** Anulowanie sprzedanego karnetu (pomyłka przy sprzedaży, zwrot). */
export async function cancelCustomerPackageAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = cancelCustomerPackageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  try {
    const { user } = await requireBusinessManager(data.businessId);
    const updated = await prisma.customerPackage.updateMany({
      where: {
        id: data.customerPackageId,
        businessId: data.businessId,
        status: { not: "CANCELLED" },
      },
      data: { status: "CANCELLED" },
    });
    if (updated.count === 0) {
      return { ok: false, error: "Nie znaleziono aktywnego karnetu" };
    }
    await logAudit({
      businessId: data.businessId,
      actorUserId: user.id,
      action: "PACKAGE_CANCELLED",
      entityType: "CustomerPackage",
      entityId: data.customerPackageId,
    });
  } catch (error) {
    return failure(error, "Nie udało się anulować karnetu");
  }

  revalidatePath("/panel/promocje");
  return { ok: true };
}
