import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { cancelBooking } from "@/lib/booking-cancel";

/**
 * POST /api/v1/bookings/[id]/cancel — anulowanie rezerwacji przez klienta.
 *
 * Zalogowany użytkownik anuluje swoje rezerwacje; gość potwierdza
 * tożsamość e-mailem podanym przy rezerwacji. Reguły (własność, status,
 * cutoff), strażnik statusu, rozliczenie zadatku, audyt i powiadomienia
 * siedzą w `@/lib/booking-cancel` — dzieli je z akcją z /konto i ze stroną
 * zarządzania rezerwacją gościa.
 */

const cancelSchema = z.object({
  /** Wymagany dla rezerwacji gościa — musi zgadzać się z guestEmail. */
  email: z.email().optional(),
  reason: z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "Nieprawidłowe body żądania" },
      { status: 400 },
    );
  }
  const parsed = cancelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION", message: "Nieprawidłowe dane" },
      { status: 422 },
    );
  }

  let sessionUserId: string | null = null;
  try {
    const session = await auth();
    sessionUserId = session?.user?.id ?? null;
  } catch {
    sessionUserId = null;
  }

  const email = parsed.data.email;
  const reason = parsed.data.reason ?? null;

  // Właściciel rezerwacji albo gość z pasującym e-mailem — zalogowany
  // użytkownik może też odwołać rezerwację złożoną wcześniej jako gość.
  let result = sessionUserId
    ? await cancelBooking({
        bookingId: id,
        actor: { kind: "user", userId: sessionUserId },
        reason,
      })
    : null;

  if (!result || (!result.ok && result.error === "FORBIDDEN")) {
    // Pusty e-mail nie pasuje do żadnej rezerwacji gościa — ścieżka służy
    // wtedy tylko do rozróżnienia 404 od 403.
    result = await cancelBooking({
      bookingId: id,
      actor: { kind: "guest", email: email ?? "" },
      reason,
    });
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: result.status },
    );
  }

  return NextResponse.json({
    booking: {
      id: result.booking.id,
      status: result.booking.status,
      cancelledAt: result.booking.cancelledAt,
    },
  });
}
