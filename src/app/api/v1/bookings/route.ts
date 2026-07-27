import { NextResponse, after } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { consumeHold, resolveSlot, SLOT_TAKEN_MESSAGE } from "@/lib/hold";
import { sendBookingConfirmationEmails } from "./emails";

/**
 * POST /api/v1/bookings — utworzenie rezerwacji.
 *
 * Gość podaje imię + e-mail + telefon; zalogowany użytkownik jest brany
 * z sesji. Slot jest walidowany silnikiem dostępności, a wyścig dwóch
 * równoczesnych rezerwacji łapie exclusion constraint w Postgresie
 * (błąd 23P01 → HTTP 409).
 *
 * `holdToken` (opcjonalny) to blokada slotu założona przez POST /api/v1/holds
 * na czas checkoutu: hold jest weryfikowany i kasowany w tej samej transakcji,
 * w której powstaje rezerwacja. Brak tokenu jest dozwolony — z tej samej
 * ścieżki korzystają panel firmy i klienci API.
 */

const bookingSchema = z.object({
  businessSlug: z.string().min(1),
  serviceId: z.string().min(1),
  /** Brak = „dowolny pracownik" — zasób przypisujemy przy potwierdzeniu. */
  resourceId: z.string().min(1).optional(),
  startAt: z.iso.datetime(),
  /** Token holda z checkoutu — patrz POST /api/v1/holds. */
  holdToken: z.string().min(1).max(100).optional(),
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
  customerNote: z.string().max(500).optional(),
});

/**
 * Naruszenie exclusion constraint `booking_items_no_overlap` wychodzi
 * z Postgresa jako SQLSTATE 23P01 — Prisma nie mapuje go na dedykowany
 * kod, więc szukamy go w łańcuchu przyczyn błędu.
 */
function isOverlapConflict(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const { code, message, cause } = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (code === "23P01") return true;
    if (
      typeof message === "string" &&
      (message.includes("23P01") ||
        message.includes("booking_items_no_overlap") ||
        message.includes("exclusion constraint"))
    ) {
      return true;
    }
    current = cause;
  }
  return false;
}

const conflictResponse = (message: string = SLOT_TAKEN_MESSAGE) =>
  NextResponse.json({ error: "SLOT_TAKEN", message }, { status: 409 });

/** Przerywa transakcję, gdy hold nie przechodzi weryfikacji. */
class HoldRejected extends Error {
  constructor(
    readonly code: "HOLD_EXPIRED" | "HOLD_INVALID",
    readonly userMessage: string,
  ) {
    super(code);
  }
}

export async function POST(request: Request) {
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

  if (!sessionUserId && !input.guest) {
    return NextResponse.json(
      {
        error: "VALIDATION",
        message: "Podaj dane rezerwującego albo zaloguj się",
      },
      { status: 422 },
    );
  }

  const now = new Date();
  const startAt = new Date(input.startAt);

  // Walidacja slotu wspólna z holdami: usługa, pracownik, dostępność,
  // wybór zasobu przy „dowolnym pracowniku". Własnego holda pomijamy —
  // inaczej klient zasłoniłby sobie własny termin.
  const resolution = await resolveSlot({
    businessSlug: input.businessSlug,
    serviceId: input.serviceId,
    resourceId: input.resourceId,
    startAt,
    now,
    ignoreHoldToken: input.holdToken,
  });
  if (!resolution.ok) {
    return NextResponse.json(
      { error: resolution.error, message: resolution.message },
      { status: resolution.status },
    );
  }
  const { context, slot } = resolution;

  try {
    const booking = await prisma.$transaction(async (tx) => {
      // Hold i rezerwacja żyją w jednej transakcji: albo termin zostaje
      // wykupiony i blokada znika, albo nie dzieje się nic.
      if (input.holdToken) {
        const result = await consumeHold(tx, {
          token: input.holdToken,
          resourceId: slot.resourceId,
          blockedStartAt: slot.blockedStartAt,
          blockedEndAt: slot.blockedEndAt,
          now,
        });
        if (result === "EXPIRED") {
          throw new HoldRejected(
            "HOLD_EXPIRED",
            "Rezerwacja terminu wygasła. Wybierz godzinę jeszcze raz.",
          );
        }
        if (result === "INVALID") {
          throw new HoldRejected(
            "HOLD_INVALID",
            "Blokada terminu jest nieprawidłowa albo została już wykorzystana.",
          );
        }
      }

      let customerId: string | null = null;
      let guestData: {
        guestName: string | null;
        guestEmail: string | null;
        guestPhone: string | null;
      } = { guestName: null, guestEmail: null, guestPhone: null };

      if (sessionUserId) {
        const user = await tx.user.findUnique({
          where: { id: sessionUserId },
          select: { name: true, email: true, phone: true },
        });
        const customer = await tx.customer.upsert({
          where: {
            businessId_userId: {
              businessId: context.business.id,
              userId: sessionUserId,
            },
          },
          update: {},
          create: {
            businessId: context.business.id,
            userId: sessionUserId,
            fullName: user?.name ?? input.guest?.name ?? "Klient",
            email: user?.email ?? input.guest?.email ?? null,
            phone: user?.phone ?? input.guest?.phone ?? null,
          },
          select: { id: true },
        });
        customerId = customer.id;
      } else if (input.guest) {
        guestData = {
          guestName: input.guest.name,
          guestEmail: input.guest.email,
          guestPhone: input.guest.phone,
        };
      }

      return tx.booking.create({
        data: {
          businessId: context.business.id,
          locationId: context.location.id,
          customerUserId: sessionUserId,
          customerId,
          ...guestData,
          status: "CONFIRMED",
          source: "WEB_MARKETPLACE",
          startAt: slot.startAt,
          endAt: slot.endAt,
          totalPriceCents: slot.priceCents,
          currency: context.service.currency,
          customerNote: input.customerNote,
          items: {
            create: {
              serviceId: context.service.id,
              resourceId: slot.resourceId,
              startAt: slot.startAt,
              endAt: slot.endAt,
              blockedStartAt: slot.blockedStartAt,
              blockedEndAt: slot.blockedEndAt,
              durationMin: slot.durationMin,
              bufferBeforeMin: context.service.bufferBeforeMin,
              bufferAfterMin: context.service.bufferAfterMin,
              priceCents: slot.priceCents,
            },
          },
        },
        select: { id: true, status: true, createdAt: true },
      });
    });

    // E-maile poza transakcją, best-effort i PO odpowiedzi: wolny albo
    // zawieszony Resend nie może opóźnić 201 (klient dostawał 504, ponawiał
    // i trafiał na 409 od własnej, już zapisanej rezerwacji).
    after(() => sendBookingConfirmationEmails(booking.id));

    const cancellationDeadline = new Date(
      slot.startAt.getTime() -
        context.location.cancellationCutoffHours * 60 * 60 * 1000,
    );

    return NextResponse.json(
      {
        booking: {
          id: booking.id,
          status: booking.status,
          startAt: slot.startAt.toISOString(),
          endAt: slot.endAt.toISOString(),
          durationMin: slot.durationMin,
          priceCents: slot.priceCents,
          currency: context.service.currency,
          serviceName: context.service.name,
          resourceId: slot.resourceId,
          resourceName: slot.resourceName,
          businessName: context.business.name,
          address: `${context.location.addressLine1}, ${context.location.city}`,
          timezone: context.location.timezone,
          cancellationCutoffHours: context.location.cancellationCutoffHours,
          cancellationDeadline: cancellationDeadline.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof HoldRejected) {
      return NextResponse.json(
        { error: error.code, message: error.userMessage },
        { status: error.code === "HOLD_EXPIRED" ? 409 : 422 },
      );
    }
    if (isOverlapConflict(error)) return conflictResponse();
    console.error("Błąd tworzenia rezerwacji:", error);
    return NextResponse.json(
      {
        error: "INTERNAL",
        message: "Nie udało się utworzyć rezerwacji. Spróbuj ponownie.",
      },
      { status: 500 },
    );
  }
}
