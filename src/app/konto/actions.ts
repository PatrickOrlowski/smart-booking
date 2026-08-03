"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/authz";
import { cancelBooking } from "@/lib/booking-cancel";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { getTranslations } from "@/i18n/server";
import { isReviewable } from "./booking-status";

/**
 * Server actions konta klienta (/konto): anulowanie wizyty, wystawienie
 * opinii, usuwanie ulubionych. Każda akcja waliduje własność zasobu —
 * UI nie jest granicą bezpieczeństwa.
 */

export type KontoActionResult = { ok: true } | { ok: false; error: string };

/**
 * Anulowanie wizyty przez klienta.
 *
 * Reguły (własność, anulowalny status, cutoff lokalizacji), strażnik statusu
 * w UPDATE i powiadomienia e-mail siedzą w `@/lib/booking-cancel` — tego
 * samego modułu używa POST /api/v1/bookings/[id]/cancel, więc odwołanie
 * z /konto wysyła teraz komplet maili (klient + firma).
 */
export async function cancelBookingAction(
  bookingId: string,
): Promise<KontoActionResult> {
  const { t } = await getTranslations();
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: t("konto.error.loginToCancel") };
  }

  const result = await cancelBooking({
    bookingId,
    actor: { kind: "user", userId: user.id },
  });
  if (!result.ok) {
    // Cudza rezerwacja ma w koncie wyglądać jak nieistniejąca; pozostałe kody
    // błędów mają swoje klucze w słowniku (komunikaty silnika są polskie).
    return {
      ok: false,
      error:
        result.error === "FORBIDDEN" || result.error === "NOT_FOUND"
          ? t("err.NOT_FOUND")
          : result.error === "CUTOFF_PASSED"
            ? t("err.CUTOFF_PASSED")
            : t("err.INVALID_STATE"),
    };
  }

  revalidatePath("/konto");
  return { ok: true };
}

const reviewSchema = z.object({
  bookingId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000),
});

/** Opinia po zakończonej wizycie — jedna na rezerwację. */
export async function createReviewAction(input: {
  bookingId: string;
  rating: number;
  comment: string;
}): Promise<KontoActionResult> {
  const { t } = await getTranslations();
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: t("konto.error.loginToReview") };
  }

  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: t("konto.error.pickRating") };
  }

  const booking = await prisma.booking.findFirst({
    where: { id: parsed.data.bookingId, customerUserId: user.id },
    select: {
      id: true,
      status: true,
      endAt: true,
      businessId: true,
      review: { select: { id: true } },
    },
  });
  if (!booking) {
    return { ok: false, error: t("konto.error.bookingNotFound") };
  }
  if (!isReviewable(booking, new Date())) {
    return { ok: false, error: t("konto.error.onlyCompleted") };
  }
  if (booking.review) {
    return { ok: false, error: t("konto.error.alreadyReviewed") };
  }

  try {
    await prisma.review.create({
      data: {
        businessId: booking.businessId,
        bookingId: booking.id,
        authorUserId: user.id,
        rating: parsed.data.rating,
        comment: parsed.data.comment === "" ? null : parsed.data.comment,
      },
    });
  } catch (error) {
    // Unikalne `bookingId` w bazie: dwie karty / podwójny klik nie mogą
    // wylecieć błędem runtime zamiast komunikatem w formularzu.
    if (isUniqueConstraintError(error)) {
      return { ok: false, error: t("konto.error.alreadyReviewed") };
    }
    throw error;
  }

  revalidatePath("/konto");
  return { ok: true };
}

/** Usunięcie firmy z ulubionych — serduszko na karcie. */
export async function removeFavoriteAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  const favoriteId = String(formData.get("favoriteId") ?? "");
  if (!favoriteId) return;

  // deleteMany zamiast delete: warunek na userId w zapytaniu (nie po fakcie)
  // i brak wyjątku, gdy wpis już nie istnieje (podwójny klik).
  await prisma.favorite.deleteMany({
    where: { id: favoriteId, userId: user.id },
  });

  revalidatePath("/konto");
}
