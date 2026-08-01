import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createTableBooking } from "@/lib/table-booking";

/**
 * POST /api/v1/restaurants/[slug]/bookings — rezerwacja stolika.
 *
 * Gość podaje imię + e-mail + telefon, zalogowany jest brany z sesji.
 * Termin przechodzi pełną rewalidację (dostępność stolika, bufor sprzątania,
 * godziny otwarcia, pacing), a wyścig dwóch rezerwacji na ten sam stolik
 * łapie exclusion constraint w Postgresie → HTTP 409.
 *
 * Kody: 201 utworzono, 403 blokada klienta, 409 stolik zajęty,
 * 422 walidacja / grupa ponad limit online.
 */

const bookingSchema = z.object({
  startAt: z.iso.datetime(),
  partySize: z.number().int().min(1, "Podaj liczbę osób").max(200),
  /** Wybór gościa; brak = silnik dobiera stolik sam. */
  tableIds: z.array(z.string().min(1)).min(1).max(8).optional(),
  combinationId: z.string().min(1).optional(),
  area: z.enum(["INDOOR", "OUTDOOR", "BAR", "PRIVATE"]).optional(),
  guest: z
    .object({
      name: z.string().min(2, "Podaj imię i nazwisko").max(120),
      email: z.email("Nieprawidłowy adres e-mail"),
      phone: z
        .string()
        .min(7, "Nieprawidłowy numer telefonu")
        .max(20)
        .regex(/^[+\d][\d\s-]+$/, "Nieprawidłowy numer telefonu"),
    })
    .optional(),
  note: z.string().max(500).optional(),
});

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

  const parsed = bookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "VALIDATION",
        message: "Nieprawidłowe dane rezerwacji",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 422 },
    );
  }
  const input = parsed.data;

  // Sesja defensywnie — rezerwacja gościa ma działać także, gdy auth
  // nie jest skonfigurowany.
  let sessionUserId: string | null = null;
  try {
    const session = await auth();
    sessionUserId = session?.user?.id ?? null;
  } catch {
    sessionUserId = null;
  }

  const result = await createTableBooking({
    slug,
    startAt: new Date(input.startAt),
    partySize: input.partySize,
    tableIds: input.tableIds,
    combinationId: input.combinationId,
    area: input.area ?? null,
    guest: input.guest,
    sessionUserId,
    note: input.note ?? null,
    source: "WEB_MARKETPLACE",
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: result.status },
    );
  }

  const { booking } = result;

  return NextResponse.json(
    {
      booking: {
        id: booking.id,
        status: booking.status,
        startAt: booking.startAt.toISOString(),
        endAt: booking.endAt.toISOString(),
        durationMin: booking.durationMin,
        partySize: booking.partySize,
        tableIds: booking.tableIds,
        tableNumbers: booking.tableNumbers,
        tableLabel: booking.tableLabel,
        ...(booking.combinationId
          ? { combinationId: booking.combinationId }
          : {}),
        area: booking.area,
        restaurantName: booking.businessName,
        address: booking.address,
        timezone: booking.timezone,
        cancellationCutoffHours: booking.cancellationCutoffHours,
        cancellationDeadline: booking.cancellationDeadline.toISOString(),
      },
    },
    { status: 201 },
  );
}
