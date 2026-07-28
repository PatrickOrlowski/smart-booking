"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  ForbiddenError,
  UnauthorizedError,
  requireBusinessManager,
} from "@/lib/authz";
import { PLAN_LABELS, getBusinessSubscription } from "@/lib/subscription";
import { PriceType } from "@/generated/prisma/enums";

type ActionResult = { ok: true } | { ok: false; error: string };

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
    return { ok: false, error: error.message };
  }
  console.error(fallback, error);
  return { ok: false, error: fallback };
}

const saveServiceSchema = z.object({
  businessId: z.string().min(1),
  serviceId: z.string().min(1).optional(),
  name: z.string().trim().min(2, "Podaj nazwę usługi").max(120),
  description: z.string().trim().max(500).optional(),
  categoryId: z.string().min(1).nullable(),
  newCategoryName: z.string().trim().min(2).max(80).optional(),
  durationMin: z
    .number()
    .int()
    .min(5, "Czas trwania: minimum 5 minut")
    .max(600),
  bufferBeforeMin: z.number().int().min(0).max(180),
  bufferAfterMin: z.number().int().min(0).max(180),
  priceCents: z.number().int().min(0).max(100_000_00),
  priceType: z.enum(PriceType),
  /** Zadatek online: wymagany przy rezerwacji, kwota w groszach. */
  depositRequired: z.boolean(),
  depositCents: z
    .number()
    .int()
    .min(1, "Kwota zadatku musi być większa od zera")
    .max(100_000_00)
    .nullable(),
  onlineBookable: z.boolean(),
  assignments: z
    .array(
      z.object({
        resourceId: z.string().min(1),
        durationMinOverride: z.number().int().min(5).max(600).nullable(),
      }),
    )
    .max(100),
});

/**
 * Dodanie lub edycja usługi wraz z kategorią i przypisaniem pracowników
 * (ServiceResource z opcjonalnym nadpisaniem czasu).
 */
export async function saveServiceAction(input: unknown): Promise<ActionResult> {
  const parsed = saveServiceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane usługi",
    };
  }
  const data = parsed.data;

  // Zadatek: włączony wymaga kwoty > 0 nieprzekraczającej ceny usługi;
  // wyłączony zawsze czyści kwotę (depositCents = null).
  const depositCents = data.depositRequired ? data.depositCents : null;
  if (data.depositRequired) {
    if (!depositCents || depositCents <= 0) {
      return { ok: false, error: "Podaj kwotę zadatku większą od zera" };
    }
    if (data.priceCents <= 0 || depositCents > data.priceCents) {
      return {
        ok: false,
        error: "Zadatek nie może przekraczać ceny usługi",
      };
    }
  }

  try {
    await requireBusinessManager(data.businessId);

    // Zadatki online to wyróżnik płatnych planów (karta PRO obiecuje
    // „Zadatki za usługi premium") — bez tej bramki plan FREE dostawał je
    // za darmo. Liczy się plan efektywny, więc wygasłe PRO też traci funkcję.
    if (data.depositRequired) {
      const subscription = await getBusinessSubscription(data.businessId);
      if (subscription.effectivePlan === "FREE") {
        return {
          ok: false,
          error: `Zadatki online są dostępne od planu ${PLAN_LABELS.PRO}. Zmień plan w /panel/plan albo wyłącz zadatek.`,
        };
      }
    }

    // Multi-tenant: każdy identyfikator z formularza weryfikowany
    // względem firmy przed zapisem.
    if (data.serviceId) {
      const service = await prisma.service.findFirst({
        where: { id: data.serviceId, businessId: data.businessId },
        select: { id: true },
      });
      if (!service) return { ok: false, error: "Nie znaleziono usługi" };
    }
    if (data.categoryId) {
      const category = await prisma.serviceCategory.findFirst({
        where: { id: data.categoryId, businessId: data.businessId },
        select: { id: true },
      });
      if (!category) return { ok: false, error: "Nie znaleziono kategorii" };
    }
    if (data.assignments.length > 0) {
      const validCount = await prisma.resource.count({
        where: {
          id: { in: data.assignments.map((entry) => entry.resourceId) },
          type: "STAFF",
          location: { businessId: data.businessId },
        },
      });
      if (validCount !== data.assignments.length) {
        return { ok: false, error: "Nieprawidłowe przypisanie pracowników" };
      }
    }

    await prisma.$transaction(async (tx) => {
      let categoryId = data.categoryId;
      if (data.newCategoryName) {
        const maxCategory = await tx.serviceCategory.aggregate({
          where: { businessId: data.businessId },
          _max: { sortOrder: true },
        });
        const category = await tx.serviceCategory.create({
          data: {
            businessId: data.businessId,
            name: data.newCategoryName,
            sortOrder: (maxCategory._max.sortOrder ?? -1) + 1,
          },
        });
        categoryId = category.id;
      }

      const serviceData = {
        name: data.name,
        description: data.description || null,
        categoryId,
        durationMin: data.durationMin,
        bufferBeforeMin: data.bufferBeforeMin,
        bufferAfterMin: data.bufferAfterMin,
        priceCents: data.priceCents,
        priceType: data.priceType,
        depositRequired: data.depositRequired && depositCents !== null,
        depositCents,
        onlineBookable: data.onlineBookable,
      };

      let serviceId = data.serviceId;
      if (serviceId) {
        await tx.service.update({ where: { id: serviceId }, data: serviceData });
      } else {
        const maxService = await tx.service.aggregate({
          where: { businessId: data.businessId },
          _max: { sortOrder: true },
        });
        const created = await tx.service.create({
          data: {
            ...serviceData,
            businessId: data.businessId,
            sortOrder: (maxService._max.sortOrder ?? -1) + 1,
          },
        });
        serviceId = created.id;
      }

      await tx.serviceResource.deleteMany({ where: { serviceId } });
      if (data.assignments.length > 0) {
        await tx.serviceResource.createMany({
          data: data.assignments.map((entry) => ({
            serviceId: serviceId!,
            resourceId: entry.resourceId,
            durationMinOverride: entry.durationMinOverride,
          })),
        });
      }
    });
  } catch (error) {
    return failure(error, "Nie udało się zapisać usługi");
  }

  revalidatePath("/panel/uslugi");
  revalidatePath("/panel");
  return { ok: true };
}

const toggleSchema = z.object({
  businessId: z.string().min(1),
  serviceId: z.string().min(1),
  isActive: z.boolean(),
});

/** Włączenie/wyłączenie usługi przełącznikiem na liście. */
export async function toggleServiceActiveAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = toggleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  try {
    await requireBusinessManager(data.businessId);
    const updated = await prisma.service.updateMany({
      where: { id: data.serviceId, businessId: data.businessId },
      data: { isActive: data.isActive },
    });
    if (updated.count === 0) return { ok: false, error: "Nie znaleziono usługi" };
  } catch (error) {
    return failure(error, "Nie udało się zmienić statusu usługi");
  }

  revalidatePath("/panel/uslugi");
  revalidatePath("/panel");
  return { ok: true };
}

const deleteSchema = z.object({
  businessId: z.string().min(1),
  serviceId: z.string().min(1),
});

/**
 * Usunięcie usługi. Usługa z rezerwacjami w historii nie znika z bazy —
 * zostaje dezaktywowana, żeby nie osierocić BookingItem.
 */
export async function deleteServiceAction(
  input: unknown,
): Promise<{ ok: true; deactivated: boolean } | { ok: false; error: string }> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  let deactivated = false;
  try {
    await requireBusinessManager(data.businessId);
    const service = await prisma.service.findFirst({
      where: { id: data.serviceId, businessId: data.businessId },
      select: { id: true, _count: { select: { bookingItems: true } } },
    });
    if (!service) return { ok: false, error: "Nie znaleziono usługi" };

    if (service._count.bookingItems > 0) {
      await prisma.service.update({
        where: { id: service.id },
        data: { isActive: false, onlineBookable: false },
      });
      deactivated = true;
    } else {
      await prisma.service.delete({ where: { id: service.id } });
    }
  } catch (error) {
    return failure(error, "Nie udało się usunąć usługi");
  }

  revalidatePath("/panel/uslugi");
  revalidatePath("/panel");
  return { ok: true, deactivated };
}
