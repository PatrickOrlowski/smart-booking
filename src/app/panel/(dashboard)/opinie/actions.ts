"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  ForbiddenError,
  UnauthorizedError,
  requireBusinessManager,
} from "@/lib/authz";

type ActionResult = { ok: true } | { ok: false; error: string };

function failure(
  error: unknown,
  fallback: string,
): { ok: false; error: string } {
  if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
    return { ok: false, error: error.message };
  }
  console.error(fallback, error);
  return { ok: false, error: fallback };
}

/**
 * Rewalidacja widoków, na których widać opinie firmy.
 *
 * Oceny na kartach firm liczą też listingi ISR (/m/[miasto], /k/[kategoria]) —
 * bez ich unieważnienia ukrycie opinii zmieniało ocenę na profilu od razu,
 * a na listingu miasta dopiero po godzinie. `revalidatePath` ze wzorcem
 * trasy + "page" czyści komplet wygenerowanych stron danego segmentu.
 */
function revalidateReviews(slug: string) {
  revalidatePath("/panel/opinie");
  revalidatePath(`/b/${slug}`);
  revalidatePath("/m/[miasto]", "page");
  revalidatePath("/k/[kategoria]", "page");
}

const replySchema = z.object({
  businessId: z.string().min(1),
  reviewId: z.string().min(1),
  reply: z
    .string()
    .trim()
    .min(2, "Odpowiedź jest za krótka")
    .max(1000, "Odpowiedź może mieć maksymalnie 1000 znaków"),
});

/**
 * Zapis lub edycja odpowiedzi właściciela na opinię.
 * `repliedAt` odświeżane przy każdej zmianie treści.
 */
export async function saveReviewReplyAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ?? "Nieprawidłowe dane odpowiedzi",
    };
  }
  const data = parsed.data;

  let slug: string;
  try {
    await requireBusinessManager(data.businessId);

    // Multi-tenant: opinia weryfikowana względem firmy przed zapisem.
    const review = await prisma.review.findFirst({
      where: { id: data.reviewId, businessId: data.businessId },
      select: { id: true, business: { select: { slug: true } } },
    });
    if (!review) return { ok: false, error: "Nie znaleziono opinii" };
    slug = review.business.slug;

    await prisma.review.update({
      where: { id: review.id },
      data: { reply: data.reply, repliedAt: new Date() },
    });
  } catch (error) {
    return failure(error, "Nie udało się zapisać odpowiedzi");
  }

  revalidateReviews(slug);
  return { ok: true };
}

const publishSchema = z.object({
  businessId: z.string().min(1),
  reviewId: z.string().min(1),
  isPublished: z.boolean(),
});

/** Pokazanie/ukrycie opinii na publicznym profilu firmy. */
export async function toggleReviewPublishedAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  let slug: string;
  try {
    await requireBusinessManager(data.businessId);

    const review = await prisma.review.findFirst({
      where: { id: data.reviewId, businessId: data.businessId },
      select: { id: true, business: { select: { slug: true } } },
    });
    if (!review) return { ok: false, error: "Nie znaleziono opinii" };
    slug = review.business.slug;

    await prisma.review.update({
      where: { id: review.id },
      data: { isPublished: data.isPublished },
    });
  } catch (error) {
    return failure(error, "Nie udało się zmienić widoczności opinii");
  }

  revalidateReviews(slug);
  return { ok: true };
}
