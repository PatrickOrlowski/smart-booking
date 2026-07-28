import { NextResponse, after } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { consumeHold, resolveSlot, SLOT_TAKEN_MESSAGE } from "@/lib/hold";
import { createBookingPayment } from "@/lib/payments";
import {
  findCustomerByContact,
  findOrCreateCustomerForBooking,
  findOrCreateCustomerForUser,
} from "@/app/panel/(dashboard)/klienci/customer-match";
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

  // Kontakt rezerwującego: zalogowany bierze dane z konta, gość z formularza.
  // Ten sam kontakt decyduje o blokadzie i o dopasowaniu profilu CRM.
  const sessionUser = sessionUserId
    ? await prisma.user.findUnique({
        where: { id: sessionUserId },
        select: { name: true, email: true, phone: true },
      })
    : null;
  const contact = {
    name: sessionUser?.name ?? input.guest?.name ?? "Klient",
    email: sessionUser?.email ?? input.guest?.email ?? null,
    phone: sessionUser?.phone ?? input.guest?.phone ?? null,
  };

  // Polityka no-show: zablokowany profil klienta (Customer.isBlocked) nie
  // rezerwuje online. Sprawdzamy konto ORAZ kontakt — dopasowanie kontaktu
  // idzie przez ten sam moduł CRM co rezerwacje ręczne (telefon po samych
  // cyfrach, e-mail bez wielkości liter), więc blokady nie obchodzi ani
  // format numeru („+48 600 700 800" vs „600700800"), ani inna wielkość
  // liter w e-mailu, ani założenie konta na dane z wizyty ręcznej.
  // Komunikat celowo nie zdradza powodu blokady.
  const [blockedAccount, contactMatch] = await Promise.all([
    sessionUserId
      ? prisma.customer.findFirst({
          where: {
            businessId: context.business.id,
            userId: sessionUserId,
            isBlocked: true,
          },
          select: { id: true },
        })
      : null,
    findCustomerByContact(context.business.id, contact),
  ]);
  if (blockedAccount || contactMatch?.isBlocked) {
    return NextResponse.json(
      {
        error: "BOOKING_BLOCKED",
        message: "Rezerwacja online niedostępna. Skontaktuj się z salonem.",
      },
      { status: 403 },
    );
  }

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

      // Profil CRM dla KAŻDEJ rezerwacji online, także gościa: bez wiersza
      // Customer registerNoShow pomija rezerwację, więc nieobecności
      // z marketplace'u (główne źródło no-show) nie liczyłyby się do limitu
      // firmy i automatyczna blokada nigdy by nie zadziałała. Ten sam moduł
      // co przy wizytach ręcznych, w tej samej transakcji co rezerwacja —
      // odrzucony slot nie zostawia osieroconego profilu.
      const customerId = sessionUserId
        ? await findOrCreateCustomerForUser(
            context.business.id,
            sessionUserId,
            contact,
            tx,
          )
        : ((
            await findOrCreateCustomerForBooking(
              context.business.id,
              {
                name: contact.name,
                phone: contact.phone,
                email: contact.email,
              },
              tx,
            )
          )?.id ?? null);

      // Dane gościa zostają na rezerwacji (kontakt do wizyty, link
      // zarządzania z e-maila); profil CRM jest rozstrzygnięty wyżej.
      const guestData =
        !sessionUserId && input.guest
          ? {
              guestName: input.guest.name,
              guestEmail: input.guest.email,
              guestPhone: input.guest.phone,
            }
          : { guestName: null, guestEmail: null, guestPhone: null };

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

    // Zadatek: gdy usługa go wymaga, do rezerwacji powstaje Payment
    // (MANUAL = zapłata na miejscu; Stripe za flagą daje redirectUrl do
    // Checkout). Best-effort — awaria warstwy płatności nie może cofnąć
    // już zapisanej rezerwacji, więc łapiemy wszystko i logujemy.
    let payment: {
      amountCents: number;
      currency: string;
      provider: string;
      status: string;
      redirectUrl?: string;
    } | null = null;
    try {
      const deposit = await prisma.service.findUnique({
        where: { id: context.service.id },
        select: { depositRequired: true, depositCents: true },
      });
      if (deposit?.depositRequired && deposit.depositCents) {
        const created = await createBookingPayment(
          booking.id,
          context.business.id,
          {
            kind: "DEPOSIT",
            amountCents: deposit.depositCents,
            currency: context.service.currency,
            description: `Zadatek — ${context.service.name}`,
            // Powrót z bramki na ekran sukcesu flow rezerwacji.
            returnUrl: `${env.NEXT_PUBLIC_APP_URL}/b/${context.business.slug}/rezerwacja?serviceId=${context.service.id}&krok=sukces`,
          },
        );
        payment = {
          amountCents: created.payment.amountCents,
          currency: created.payment.currency,
          provider: created.payment.provider,
          status: created.payment.status,
          ...(created.redirectUrl ? { redirectUrl: created.redirectUrl } : {}),
        };
      }
    } catch (error) {
      console.error("Nie udało się utworzyć płatności zadatku:", error);
    }

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
        /** Zadatek do rezerwacji — null, gdy usługa go nie wymaga. */
        payment,
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
