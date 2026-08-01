import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getRestaurantLocation,
  turnTimeForContext,
} from "@/lib/restaurant-data";
import {
  findCustomerByContact,
  findOrCreateCustomerForBooking,
  findOrCreateCustomerForUser,
} from "@/app/panel/(dashboard)/klienci/customer-match";

/**
 * POST /api/v1/restaurants/[slug]/waitlist — zapis na listę oczekujących.
 *
 * Wchodzi w grę, gdy o wybranej godzinie nie ma stolika: gość zostawia
 * kontakt i tolerancję czasową (`flexMin`), a lokal odzywa się, gdy coś się
 * zwolni. Lista działa tylko przy `Location.waitlistEnabled`.
 */

const waitlistSchema = z.object({
  requestedAt: z.iso.datetime(),
  partySize: z.number().int().min(1, "Podaj liczbę osób").max(200),
  /** Ile minut w obie strony gość przyjmie zamiast preferowanej godziny. */
  flexMin: z.number().int().min(0).max(240).optional(),
  guest: z
    .object({
      name: z.string().min(2, "Podaj imię i nazwisko").max(120),
      email: z.email("Nieprawidłowy adres e-mail").optional(),
      phone: z
        .string()
        .min(7, "Nieprawidłowy numer telefonu")
        .max(20)
        .regex(/^[+\d][\d\s-]+$/, "Nieprawidłowy numer telefonu")
        .optional(),
    })
    .optional(),
  note: z.string().max(500).optional(),
});

const validation = (message: string, issues?: { path: string; message: string }[]) =>
  NextResponse.json(
    { error: "VALIDATION", message, ...(issues ? { issues } : {}) },
    { status: 422 },
  );

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "Nieprawidłowe body żądania" },
      { status: 400 },
    );
  }

  const parsed = waitlistSchema.safeParse(body);
  if (!parsed.success) {
    return validation(
      "Nieprawidłowe dane zapisu",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  const input = parsed.data;

  let sessionUserId: string | null = null;
  try {
    const session = await auth();
    sessionUserId = session?.user?.id ?? null;
  } catch {
    sessionUserId = null;
  }

  // Kontakt jest sensem listy oczekujących — bez telefonu albo e-maila nie ma
  // jak zawiadomić o zwolnionym stoliku.
  if (!sessionUserId) {
    if (!input.guest) {
      return validation("Podaj dane kontaktowe albo zaloguj się.");
    }
    if (!input.guest.email && !input.guest.phone) {
      return validation("Podaj telefon albo e-mail — inaczej nie damy znać.");
    }
  }

  const context = await getRestaurantLocation(slug);
  if (!context) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "Nie znaleziono restauracji" },
      { status: 404 },
    );
  }
  if (!context.location.waitlistEnabled) {
    return validation("Ten lokal nie prowadzi listy oczekujących.");
  }

  const now = new Date();
  const requestedAt = new Date(input.requestedAt);
  if (requestedAt.getTime() <= now.getTime()) {
    return validation("Termin musi być w przyszłości.");
  }
  const horizon = new Date(
    now.getTime() + context.location.maxAdvanceDays * 24 * 60 * 60 * 1000,
  );
  if (requestedAt.getTime() > horizon.getTime()) {
    return validation(
      `Zapisy przyjmujemy najdalej ${context.location.maxAdvanceDays} dni naprzód.`,
    );
  }

  const sessionUser = sessionUserId
    ? await prisma.user.findUnique({
        where: { id: sessionUserId },
        select: { name: true, email: true, phone: true },
      })
    : null;
  const contact = {
    name: sessionUser?.name ?? input.guest?.name ?? "Gość",
    email: sessionUser?.email ?? input.guest?.email ?? null,
    phone: sessionUser?.phone ?? input.guest?.phone ?? null,
  };

  // Ta sama polityka co przy rezerwacji: zablokowany klient nie wchodzi
  // na listę tylnymi drzwiami.
  const existingCustomer = await findCustomerByContact(
    context.business.id,
    contact,
  );
  if (existingCustomer?.isBlocked) {
    return NextResponse.json(
      {
        error: "BOOKING_BLOCKED",
        message: "Rezerwacja online niedostępna. Skontaktuj się z restauracją.",
      },
      { status: 403 },
    );
  }

  // Podwójne kliknięcie nie ma robić dwóch wpisów na tej samej godzinie.
  const duplicate = await prisma.waitlistEntry.findFirst({
    where: {
      locationId: context.location.id,
      status: "WAITING",
      requestedAt,
      partySize: input.partySize,
      ...(sessionUserId
        ? { customerUserId: sessionUserId }
        : {
            OR: [
              ...(contact.email ? [{ guestEmail: contact.email }] : []),
              ...(contact.phone ? [{ guestPhone: contact.phone }] : []),
            ],
          }),
    },
    select: { id: true, requestedAt: true, flexMin: true, status: true },
  });
  if (duplicate) {
    return NextResponse.json(
      {
        entry: {
          id: duplicate.id,
          status: duplicate.status,
          requestedAt: duplicate.requestedAt.toISOString(),
          flexMin: duplicate.flexMin,
          partySize: input.partySize,
          timezone: context.location.timezone,
        },
        message: "Jesteś już na liście oczekujących na ten termin.",
      },
      { status: 200 },
    );
  }

  const customerId = sessionUserId
    ? await findOrCreateCustomerForUser(
        context.business.id,
        sessionUserId,
        contact,
      )
    : ((
        await findOrCreateCustomerForBooking(context.business.id, {
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
        })
      )?.id ?? null);

  const entry = await prisma.waitlistEntry.create({
    data: {
      businessId: context.business.id,
      locationId: context.location.id,
      requestedAt,
      flexMin: input.flexMin ?? 60,
      partySize: input.partySize,
      customerUserId: sessionUserId,
      customerId,
      ...(sessionUserId
        ? {}
        : {
            guestName: input.guest?.name ?? null,
            guestEmail: input.guest?.email ?? null,
            guestPhone: input.guest?.phone ?? null,
          }),
      note: input.note ?? null,
      status: "WAITING",
    },
    select: { id: true, status: true, requestedAt: true, flexMin: true },
  });

  return NextResponse.json(
    {
      entry: {
        id: entry.id,
        status: entry.status,
        requestedAt: entry.requestedAt.toISOString(),
        flexMin: entry.flexMin,
        partySize: input.partySize,
        /** Ile stolik byłby zajęty — do komunikatu „damy znać". */
        durationMin: turnTimeForContext(context, input.partySize),
        restaurantName: context.business.name,
        phone: context.location.phone,
        timezone: context.location.timezone,
      },
      message:
        "Jesteś na liście oczekujących. Damy znać, gdy zwolni się stolik.",
    },
    { status: 201 },
  );
}
