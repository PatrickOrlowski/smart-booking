import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/v1/bookings/[id]?email= — szczegóły rezerwacji dla klienta.
 *
 * Tożsamość jak w `@/lib/booking-cancel`: rezerwację z konta czyta tylko
 * zalogowany właściciel (sesja), rezerwację gościa — ten, kto poda e-mail
 * zgodny case-insensitive z `guestEmail`. E-mail właściciela konta NIE jest
 * poświadczeniem (nie jest sekretem). Nieistniejące id i niezgodna
 * tożsamość dają ten sam 403 — endpoint nie zdradza, czy id istnieje.
 * Odpowiedź zawiera wyłącznie pola potrzebne ekranowi wizyty (status, czas,
 * usługa, pracownik, lokal, cena) — żadnych danych osobowych rezerwującego.
 */

/** Świeży Response przy każdym wywołaniu — body Response konsumuje się raz. */
const forbidden = () =>
  NextResponse.json(
    { error: "FORBIDDEN", message: "Brak uprawnień do tej rezerwacji." },
    { status: 403 },
  );

const HOUR_MS = 60 * 60 * 1000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const email = new URL(request.url).searchParams.get("email")?.trim() ?? "";

  let sessionUserId: string | null = null;
  try {
    const session = await auth();
    sessionUserId = session?.user?.id ?? null;
  } catch {
    sessionUserId = null;
  }

  if (!email && !sessionUserId) return forbidden();

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      startAt: true,
      endAt: true,
      totalPriceCents: true,
      currency: true,
      cancelledAt: true,
      guestEmail: true,
      customerUserId: true,
      business: { select: { slug: true, name: true } },
      location: {
        select: {
          addressLine1: true,
          addressLine2: true,
          city: true,
          postalCode: true,
          phone: true,
          timezone: true,
          cancellationCutoffHours: true,
        },
      },
      items: {
        orderBy: { sortOrder: "asc" },
        select: {
          durationMin: true,
          service: { select: { name: true } },
          resource: { select: { name: true } },
        },
      },
    },
  });

  // Ten sam 403 dla „nie istnieje" i „niezgodna tożsamość" — inaczej ten
  // nieuwierzytelniony GET byłby wyrocznią istnienia id rezerwacji.
  if (!booking) return forbidden();

  // Reguły własności jak w @/lib/booking-cancel: rezerwacja z konta wymaga
  // sesji właściciela; rezerwacja gościa — zgodnego `guestEmail`
  // (porównanie case-insensitive).
  const isOwner =
    booking.customerUserId !== null &&
    booking.customerUserId === sessionUserId;
  const isGuestMatch =
    booking.customerUserId === null &&
    booking.guestEmail !== null &&
    email !== "" &&
    booking.guestEmail.toLowerCase() === email.toLowerCase();
  if (!isOwner && !isGuestMatch) return forbidden();

  const item = booking.items[0] ?? null;
  const cancellationDeadline = new Date(
    booking.startAt.getTime() -
      booking.location.cancellationCutoffHours * HOUR_MS,
  );
  const address = [
    [booking.location.addressLine1, booking.location.addressLine2]
      .filter(Boolean)
      .join(" "),
    `${booking.location.postalCode} ${booking.location.city}`,
  ].join(", ");

  return NextResponse.json({
    booking: {
      id: booking.id,
      status: booking.status,
      startAt: booking.startAt.toISOString(),
      endAt: booking.endAt.toISOString(),
      durationMin: item?.durationMin ?? null,
      serviceName: item?.service.name ?? null,
      resourceName: item?.resource.name ?? null,
      priceCents: booking.totalPriceCents,
      currency: booking.currency,
      businessName: booking.business.name,
      businessSlug: booking.business.slug,
      address,
      city: booking.location.city,
      phone: booking.location.phone,
      timezone: booking.location.timezone,
      cancellationCutoffHours: booking.location.cancellationCutoffHours,
      cancellationDeadline: cancellationDeadline.toISOString(),
      cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    },
  });
}
