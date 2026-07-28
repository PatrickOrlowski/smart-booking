"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { registerNoShow } from "@/lib/no-show";
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
    select: { id: true, status: true, startAt: true, businessId: true },
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

  // Strażnik statusu w samym UPDATE: równoległe anulowanie przez klienta
  // (booking-cancel.ts — już ze zwróconym zadatkiem) nie może zostać
  // nadpisane na NO_SHOW/COMPLETED przez read-modify-write.
  const updated = await prisma.booking.updateMany({
    where: { id: booking.id, status: { in: ["PENDING", "CONFIRMED"] } },
    data: { status },
  });
  if (updated.count === 0) {
    // Wizytę rozliczył ktoś inny (albo klient ją odwołał) — nic do zrobienia.
    revalidatePath("/pracownik");
    return;
  }

  if (status === "NO_SHOW") {
    // Polityka no-show: ślad w audycie + licznik nieobecności klienta
    // (z automatyczną blokadą po przekroczeniu limitu firmy).
    const result = await registerNoShow(booking.id, { actorUserId: user.id });
    await logAudit({
      businessId: booking.businessId,
      actorUserId: user.id,
      action: "BOOKING_NO_SHOW",
      entityType: "Booking",
      entityId: booking.id,
      metadata: {
        noShowCount: result.count,
        limit: result.limit,
        customerBlocked: result.blocked,
      },
    });
  }

  revalidatePath("/pracownik");
}

export async function markBookingCompleted(formData: FormData): Promise<void> {
  await setBookingStatus(String(formData.get("bookingId") ?? ""), "COMPLETED");
}

export async function markBookingNoShow(formData: FormData): Promise<void> {
  await setBookingStatus(String(formData.get("bookingId") ?? ""), "NO_SHOW");
}
