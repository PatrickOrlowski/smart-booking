"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requirePlatformAdminAction } from "@/lib/admin-auth";
import { ForbiddenError, UnauthorizedError } from "@/lib/authz";
import type { ActionResult } from "@/components/admin/action-result";

/**
 * Moderacja opinii przez platformę.
 *
 * Ukrycie ustawia `Review.isPublished = false` — to samo pole, którym operuje
 * właściciel w panelu firmy. Świadomie nie ma tu osobnego „ukryte przez
 * administratora": jedno pole, jedna prawda o widoczności, a kto i kiedy
 * zdecydował, mówi AuditLog.
 */

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
    return { ok: false, error: error.message };
  }
  console.error(fallback, error);
  return { ok: false, error: fallback };
}

const visibilitySchema = z.object({
  reviewId: z.string().min(1),
  isPublished: z.boolean(),
  /** Skąd przyszła decyzja — pozwala odświeżyć też widok zgłoszenia. */
  reportId: z.string().min(1).optional(),
});

export async function setReviewVisibilityAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = visibilitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  let slug: string;
  try {
    const admin = await requirePlatformAdminAction();

    const review = await prisma.review.findUnique({
      where: { id: data.reviewId },
      select: {
        id: true,
        isPublished: true,
        businessId: true,
        business: { select: { slug: true } },
      },
    });
    if (!review) return { ok: false, error: "Nie znaleziono opinii" };
    slug = review.business.slug;

    if (review.isPublished === data.isPublished) {
      return {
        ok: false,
        error: data.isPublished
          ? "Opinia jest już widoczna"
          : "Opinia jest już ukryta",
      };
    }

    await prisma.review.update({
      where: { id: review.id },
      data: { isPublished: data.isPublished },
    });

    await logAudit({
      businessId: review.businessId,
      actorUserId: admin.id,
      action: data.isPublished ? "REVIEW_RESTORED" : "REVIEW_HIDDEN",
      entityType: "Review",
      entityId: review.id,
      metadata: { moderator: "platform", ...(data.reportId ? { fromReport: data.reportId } : {}) },
    });
  } catch (error) {
    return failure(error, "Nie udało się zmienić widoczności opinii");
  }

  revalidatePath("/admin");
  revalidatePath("/admin/opinie");
  revalidatePath("/admin/zgloszenia");
  if (data.reportId) revalidatePath(`/admin/zgloszenia/${data.reportId}`);
  // Ocena firmy liczy się z opublikowanych opinii, więc zmiana rusza też
  // karty na listingach ISR.
  revalidatePath(`/b/${slug}`);
  revalidatePath("/m/[miasto]", "page");
  revalidatePath("/k/[kategoria]", "page");
  return { ok: true };
}
