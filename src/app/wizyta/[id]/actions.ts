"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { cancelBooking } from "@/lib/booking-cancel";
import { verifyBookingManageToken } from "@/lib/booking-link";

/**
 * Odwołanie wizyty ze strony gościa (/wizyta/[id]?t=…).
 *
 * Autoryzacją jest podpisany token z e-maila — ta sama reguła co w
 * POST /api/v1/bookings/[id]/cancel dla gościa, tylko bez przepisywania
 * adresu w formularzu. Reszta (status, cutoff, powiadomienia) siedzi
 * w `@/lib/booking-cancel`.
 */
export async function cancelGuestBookingAction(
  formData: FormData,
): Promise<void> {
  const bookingId = String(formData.get("bookingId") ?? "");
  const token = String(formData.get("token") ?? "");
  if (!bookingId || !token) redirect("/");

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, guestEmail: true, customerUserId: true },
  });
  if (
    !booking ||
    booking.customerUserId !== null ||
    !booking.guestEmail ||
    !verifyBookingManageToken(bookingId, booking.guestEmail, token)
  ) {
    redirect("/");
  }

  const result = await cancelBooking({
    bookingId,
    actor: { kind: "guest", email: booking.guestEmail },
  });

  const target = `/wizyta/${bookingId}?t=${encodeURIComponent(token)}`;
  revalidatePath(target);
  redirect(result.ok ? target : `${target}&blad=${result.error}`);
}
