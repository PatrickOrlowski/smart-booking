"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requirePlatformAdminAction } from "@/lib/admin-auth";
import { ForbiddenError, UnauthorizedError } from "@/lib/authz";
import type { ActionResult } from "@/components/admin/action-result";
import type { BusinessStatus } from "@/generated/prisma/enums";

/**
 * Decyzje platformy o firmie: weryfikacja, odrzucenie, zawieszenie, przywrócenie.
 *
 * Każda akcja: Zod → `requirePlatformAdminAction()` → warunek na statusie
 * wyjściowym → zapis → `logAudit` → `revalidatePath`. Warunek na statusie
 * jest ważniejszy, niż wygląda: dwie karty przeglądarki otwarte na tej samej
 * firmie nie mogą zweryfikować jej dwa razy ani „przywrócić" firmy, którą
 * ktoś właśnie odrzucił. Dlatego siedzi w SAMYM UPDATE (warunkowe
 * `updateMany` + kontrola `count`), a wcześniejszy odczyt służy tylko
 * przyjaznym komunikatom — read-modify-write przegrywałby wyścig dwóch kart.
 *
 * Powód decyzji (odrzucenie, zawieszenie) trafia do `Business.rejectionReason`
 * — to jedyne pole tekstowe płynące od platformy do właściciela, więc pełni
 * rolę „powodu ostatniej decyzji platformy". Pełna historia jest w AuditLog.
 */

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
    return { ok: false, error: error.message };
  }
  console.error(fallback, error);
  return { ok: false, error: fallback };
}

/**
 * Odświeżenie wszystkich widoków, na których widać firmę.
 *
 * Zmiana statusu wpycha firmę na marketplace albo ją z niego zdejmuje.
 * Listingi miasta i kategorii są statyczne z ISR (`revalidate = 3600`),
 * więc bez tego zawieszona firma wisiałaby na liście miasta jeszcze godzinę.
 */
function revalidateBusiness(businessId: string, slug: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/firmy");
  revalidatePath(`/admin/firmy/${businessId}`);
  revalidatePath("/");
  revalidatePath(`/b/${slug}`);
  revalidatePath("/m/[miasto]", "page");
  revalidatePath("/k/[kategoria]", "page");
  revalidatePath("/sitemap.xml");
}

const businessIdSchema = z.object({ businessId: z.string().min(1) });

const reasonSchema = businessIdSchema.extend({
  reason: z
    .string()
    .trim()
    .min(5, "Podaj powód — trafia do właściciela firmy")
    .max(500, "Powód może mieć maksymalnie 500 znaków"),
});

type BusinessRow = {
  id: string;
  slug: string;
  name: string;
  status: BusinessStatus;
  verifiedAt: Date | null;
};

async function loadBusiness(businessId: string): Promise<BusinessRow | null> {
  return prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, slug: true, name: true, status: true, verifiedAt: true },
  });
}

/** PENDING_REVIEW → ACTIVE. Zapisuje kto i kiedy zweryfikował. */
export async function verifyBusinessAction(input: unknown): Promise<ActionResult> {
  const parsed = businessIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };

  let business: BusinessRow;
  try {
    const admin = await requirePlatformAdminAction();

    const found = await loadBusiness(parsed.data.businessId);
    if (!found) return { ok: false, error: "Nie znaleziono firmy" };
    if (found.status !== "PENDING_REVIEW") {
      return {
        ok: false,
        error: "Weryfikować można tylko firmę czekającą na weryfikację",
      };
    }
    business = found;

    const updated = await prisma.business.updateMany({
      where: { id: business.id, status: "PENDING_REVIEW" },
      data: {
        status: "ACTIVE",
        verifiedAt: new Date(),
        verifiedByUserId: admin.id,
        // Zweryfikowana firma nie może nosić powodu poprzedniego odrzucenia.
        rejectionReason: null,
      },
    });
    if (updated.count === 0) {
      return {
        ok: false,
        error: "Status firmy zmienił się w międzyczasie. Odśwież widok.",
      };
    }

    await logAudit({
      businessId: business.id,
      actorUserId: admin.id,
      action: "BUSINESS_VERIFIED",
      entityType: "Business",
      entityId: business.id,
      metadata: { from: "PENDING_REVIEW", to: "ACTIVE", slug: business.slug },
    });
  } catch (error) {
    return failure(error, "Nie udało się zweryfikować firmy");
  }

  revalidateBusiness(business.id, business.slug);
  return { ok: true };
}

/** PENDING_REVIEW → DRAFT z powodem widocznym dla właściciela. */
export async function rejectBusinessAction(input: unknown): Promise<ActionResult> {
  const parsed = reasonSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane",
    };
  }

  let business: BusinessRow;
  try {
    const admin = await requirePlatformAdminAction();

    const found = await loadBusiness(parsed.data.businessId);
    if (!found) return { ok: false, error: "Nie znaleziono firmy" };
    if (found.status !== "PENDING_REVIEW") {
      return {
        ok: false,
        error: "Odrzucić można tylko firmę czekającą na weryfikację",
      };
    }
    business = found;

    const updated = await prisma.business.updateMany({
      where: { id: business.id, status: "PENDING_REVIEW" },
      data: { status: "DRAFT", rejectionReason: parsed.data.reason },
    });
    if (updated.count === 0) {
      return {
        ok: false,
        error: "Status firmy zmienił się w międzyczasie. Odśwież widok.",
      };
    }

    await logAudit({
      businessId: business.id,
      actorUserId: admin.id,
      action: "BUSINESS_REJECTED",
      entityType: "Business",
      entityId: business.id,
      metadata: {
        from: "PENDING_REVIEW",
        to: "DRAFT",
        reason: parsed.data.reason,
        slug: business.slug,
      },
    });
  } catch (error) {
    return failure(error, "Nie udało się odrzucić firmy");
  }

  revalidateBusiness(business.id, business.slug);
  return { ok: true };
}

/**
 * Cokolwiek → SUSPENDED. Zawieszona firma znika z marketplace'u:
 * wszystkie publiczne zapytania filtrują `status: "ACTIVE"`.
 */
export async function suspendBusinessAction(input: unknown): Promise<ActionResult> {
  const parsed = reasonSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane",
    };
  }

  let business: BusinessRow;
  try {
    const admin = await requirePlatformAdminAction();

    const found = await loadBusiness(parsed.data.businessId);
    if (!found) return { ok: false, error: "Nie znaleziono firmy" };
    if (found.status === "SUSPENDED") {
      return { ok: false, error: "Firma jest już zawieszona" };
    }
    business = found;

    const updated = await prisma.business.updateMany({
      where: { id: business.id, status: { not: "SUSPENDED" } },
      data: { status: "SUSPENDED", rejectionReason: parsed.data.reason },
    });
    if (updated.count === 0) {
      return { ok: false, error: "Firma jest już zawieszona" };
    }

    // `from` w metadanych to pamięć akcji „Przywróć firmę" — zawieszony
    // szkic ma wrócić do szkicu, nie na marketplace.
    await logAudit({
      businessId: business.id,
      actorUserId: admin.id,
      action: "BUSINESS_SUSPENDED",
      entityType: "Business",
      entityId: business.id,
      metadata: {
        from: business.status,
        to: "SUSPENDED",
        reason: parsed.data.reason,
        slug: business.slug,
      },
    });
  } catch (error) {
    return failure(error, "Nie udało się zawiesić firmy");
  }

  revalidateBusiness(business.id, business.slug);
  return { ok: true };
}

/**
 * SUSPENDED → status sprzed zawieszenia (z metadanych wpisu
 * BUSINESS_SUSPENDED). Zawiesić można firmę w KAŻDYM statusie — także
 * szkic i firmę czekającą na weryfikację — więc przywrócenie nie może
 * ślepo ustawiać ACTIVE ani stemplować `verifiedAt`: szkic wracałby na
 * marketplace jako „zweryfikowany" bez przejścia weryfikacji.
 */
export async function restoreBusinessAction(input: unknown): Promise<ActionResult> {
  const parsed = businessIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };

  let business: BusinessRow;
  try {
    const admin = await requirePlatformAdminAction();

    const found = await loadBusiness(parsed.data.businessId);
    if (!found) return { ok: false, error: "Nie znaleziono firmy" };
    if (found.status !== "SUSPENDED") {
      return { ok: false, error: "Przywrócić można tylko zawieszoną firmę" };
    }
    business = found;

    const lastSuspension = await prisma.auditLog.findFirst({
      where: {
        action: "BUSINESS_SUSPENDED",
        entityType: "Business",
        entityId: business.id,
      },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    });
    const meta = lastSuspension?.metadata;
    const from =
      meta && typeof meta === "object" && !Array.isArray(meta)
        ? (meta as Record<string, unknown>).from
        : undefined;
    // Brak wpisu audytu (dane sprzed dziennika): firmę kiedyś zweryfikowaną
    // przywracamy jako ACTIVE, resztę bezpiecznie do szkicu.
    const target: BusinessStatus =
      from === "DRAFT" || from === "PENDING_REVIEW" || from === "ACTIVE"
        ? from
        : business.verifiedAt
          ? "ACTIVE"
          : "DRAFT";

    const updated = await prisma.business.updateMany({
      where: { id: business.id, status: "SUSPENDED" },
      data: {
        status: target,
        rejectionReason: null,
        // Stempel weryfikacji wyłącznie przy powrocie na marketplace firmy,
        // która nie ma go z historycznych danych — nigdy dla szkicu.
        ...(target === "ACTIVE" && !business.verifiedAt
          ? { verifiedAt: new Date(), verifiedByUserId: admin.id }
          : {}),
      },
    });
    if (updated.count === 0) {
      return { ok: false, error: "Przywrócić można tylko zawieszoną firmę" };
    }

    await logAudit({
      businessId: business.id,
      actorUserId: admin.id,
      action: "BUSINESS_RESTORED",
      entityType: "Business",
      entityId: business.id,
      metadata: { from: "SUSPENDED", to: target, slug: business.slug },
    });
  } catch (error) {
    return failure(error, "Nie udało się przywrócić firmy");
  }

  revalidateBusiness(business.id, business.slug);
  return { ok: true };
}
