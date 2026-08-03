import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/webhooks";
import { refundPackageEntryForBooking } from "@/lib/packages";
import { settleBookingPaymentsOnCancellation } from "@/lib/payments";
import { sendBookingCancellationEmails } from "@/app/api/v1/bookings/emails";

/**
 * Anulowanie rezerwacji przez klienta — jedno miejsce dla wszystkich wejść:
 * POST /api/v1/bookings/[id]/cancel, akcja z /konto i strona zarządzania
 * rezerwacją gościa. Wcześniej reguły (własność, anulowalny status, cutoff)
 * i powiadomienia żyły osobno w każdej ścieżce, przez co anulowanie z /konto
 * nie wysyłało ani potwierdzenia klientowi, ani powiadomienia do firmy.
 */

export type CancelActor =
  /** Zalogowany właściciel rezerwacji. */
  | { kind: "user"; userId: string }
  /** Gość — tożsamość potwierdzona e-mailem podanym przy rezerwacji. */
  | { kind: "guest"; email: string };

export type CancelBookingError =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_STATE"
  | "CUTOFF_PASSED";

export type CancelBookingResult =
  | {
      ok: true;
      booking: { id: string; status: "CANCELLED_BY_CUSTOMER"; cancelledAt: Date };
    }
  | {
      ok: false;
      error: CancelBookingError;
      /** Gotowy komunikat po polsku — ten sam w API i w UI. */
      message: string;
      status: number;
    };

const HOUR_MS = 60 * 60 * 1000;

const fail = (
  error: CancelBookingError,
  message: string,
  status: number,
): CancelBookingResult => ({ ok: false, error, message, status });

export async function cancelBooking(input: {
  bookingId: string;
  actor: CancelActor;
  reason?: string | null;
  now?: Date;
}): Promise<CancelBookingResult> {
  const now = input.now ?? new Date();

  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      id: true,
      businessId: true,
      status: true,
      startAt: true,
      customerUserId: true,
      guestEmail: true,
      location: { select: { cancellationCutoffHours: true } },
    },
  });
  if (!booking) {
    return fail("NOT_FOUND", "Nie znaleziono rezerwacji.", 404);
  }

  const isOwner =
    input.actor.kind === "user" &&
    booking.customerUserId !== null &&
    booking.customerUserId === input.actor.userId;
  const isGuestMatch =
    input.actor.kind === "guest" &&
    booking.customerUserId === null &&
    booking.guestEmail !== null &&
    booking.guestEmail.toLowerCase() === input.actor.email.toLowerCase();

  if (!isOwner && !isGuestMatch) {
    // Cudza rezerwacja ma wyglądać jak nieistniejąca w UI konta, ale API
    // rozróżnia 403 — dlatego oddzielny kod błędu z własnym komunikatem.
    return fail("FORBIDDEN", "Brak uprawnień do tej rezerwacji.", 403);
  }

  if (booking.status !== "PENDING" && booking.status !== "CONFIRMED") {
    return fail("INVALID_STATE", "Tej wizyty nie można już anulować.", 422);
  }

  const cutoffHours = booking.location.cancellationCutoffHours;
  const deadline = new Date(booking.startAt.getTime() - cutoffHours * HOUR_MS);
  if (now.getTime() > deadline.getTime()) {
    return fail(
      "CUTOFF_PASSED",
      `Można anulować najpóźniej ${cutoffHours} h przed wizytą. Skontaktuj się z lokalem telefonicznie.`,
      422,
    );
  }

  const cancelledAt = new Date();
  // Strażnik statusu w samym UPDATE: równoległe odwołanie przez firmę
  // (CANCELLED_BY_BUSINESS) nie może zostać nadpisane read-modify-write.
  // Zwrot wejścia z karnetu idzie w TEJ SAMEJ transakcji — anulowana wizyta
  // opłacona karnetem nie może „zjeść" wejścia (odwrotność consumePackageEntry).
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.booking.updateMany({
      where: {
        id: booking.id,
        status: { in: ["PENDING", "CONFIRMED"] },
        ...(input.actor.kind === "user"
          ? { customerUserId: input.actor.userId }
          : { customerUserId: null }),
      },
      data: {
        status: "CANCELLED_BY_CUSTOMER",
        cancelledAt,
        ...(input.reason !== undefined
          ? { cancellationReason: input.reason }
          : {}),
      },
    });
    if (result.count > 0) {
      await refundPackageEntryForBooking(tx, booking.id);
    }
    return result;
  });
  if (updated.count === 0) {
    return fail("INVALID_STATE", "Tej wizyty nie można już anulować.", 422);
  }

  // Rozliczenie zadatku i wpis audytu TUTAJ, nie w poszczególnych wejściach
  // (API route / akcja z /konto / strona gościa) — każda ścieżka anulowania
  // musi zwrócić opłacony zadatek (PAID → zwrot), zamknąć wiszący PENDING
  // i zostawić ślad BOOKING_CANCELLED. Oba wywołania są best-effort i nie
  // mogą unieważnić już wykonanego anulowania.
  const actorUserId = input.actor.kind === "user" ? input.actor.userId : null;
  const settledPayments = await settleBookingPaymentsOnCancellation(
    booking.id,
    { actorUserId, reason: input.reason ?? null },
  );
  await logAudit({
    businessId: booking.businessId,
    actorUserId,
    action: "BOOKING_CANCELLED",
    entityType: "Booking",
    entityId: booking.id,
    metadata: {
      cancelledBy: input.actor.kind,
      reason: input.reason ?? null,
      payments: settledPayments,
    },
  });

  // Powiadomienia best-effort i po odpowiedzi — poczta nie może opóźniać ani
  // wywracać anulowania (sendBookingCancellationEmails sam też nie rzuca).
  after(() => sendBookingCancellationEmails(booking.id));

  // Webhooki integratorów — również po odpowiedzi i best-effort (emitEvent
  // sam nie rzuca); cudzy serwer nie może opóźnić anulowania.
  after(() =>
    emitEvent(booking.businessId, "booking.cancelled", {
      bookingId: booking.id,
      status: "CANCELLED_BY_CUSTOMER",
      cancelledAt: cancelledAt.toISOString(),
      reason: input.reason ?? null,
    }),
  );

  return {
    ok: true,
    booking: { id: booking.id, status: "CANCELLED_BY_CUSTOMER", cancelledAt },
  };
}
