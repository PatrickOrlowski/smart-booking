"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { ForbiddenError, requireUser } from "@/lib/authz";

/**
 * Zmiana statusu wizyty przez pracownika.
 *
 * Reguły dostępu (sprawdzane w akcji, nie w UI):
 * - użytkownik musi być zalogowany,
 * - wizyta musi mieć pozycję na zasobie, którego StaffProfile należy do
 *   tego użytkownika (aktywny profil) — pracownik nie ruszy cudzego grafiku,
 * - tylko wizyty rozpoczęte (przeszłe/trwające) i w statusie
 *   PENDING/CONFIRMED — zakończone, nieobecności i anulowane zostają
 *   nietknięte.
 */
async function setBookingStatus(
  bookingId: string,
  status: "COMPLETED" | "NO_SHOW",
): Promise<void> {
  const user = await requireUser();
  if (!bookingId) {
    throw new Error("Brak identyfikatora wizyty");
  }

  const booking = await prisma.booking.findFirst({
    where: {
      id: bookingId,
      items: {
        some: {
          resource: {
            staffProfile: { userId: user.id, isActive: true },
          },
        },
      },
    },
    select: { id: true, status: true, startAt: true },
  });
  if (!booking) {
    throw new ForbiddenError();
  }

  const isActionable =
    (booking.status === "PENDING" || booking.status === "CONFIRMED") &&
    booking.startAt.getTime() <= Date.now();
  if (!isActionable) {
    // Wizyta w przyszłości albo już rozliczona — nic do zrobienia.
    return;
  }

  await prisma.booking.update({
    where: { id: booking.id },
    data: { status },
  });

  revalidatePath("/pracownik");
}

export async function markBookingCompleted(formData: FormData): Promise<void> {
  await setBookingStatus(String(formData.get("bookingId") ?? ""), "COMPLETED");
}

export async function markBookingNoShow(formData: FormData): Promise<void> {
  await setBookingStatus(String(formData.get("bookingId") ?? ""), "NO_SHOW");
}
