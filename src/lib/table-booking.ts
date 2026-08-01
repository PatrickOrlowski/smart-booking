import { after } from "next/server";
import type { BookingSource, RestaurantArea } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  getRestaurantLocation,
  partyTooLargeMessage,
  resolveTableSlot,
  type RestaurantContext,
} from "@/lib/restaurant-data";
import type { TableSlot } from "@/lib/table-availability";
import {
  findCustomerByContact,
  findOrCreateCustomerForBooking,
  findOrCreateCustomerForUser,
} from "@/app/panel/(dashboard)/klienci/customer-match";
import { sendBookingConfirmationEmails } from "@/app/api/v1/bookings/emails";

/**
 * Zapis rezerwacji stolika.
 *
 * Rezerwacja stolika to zwykły `Booking` z `partySize` i pozycją
 * (`BookingItem`) na KAŻDYM zajmowanym stoliku — dzięki temu podwójnej
 * rezerwacji pilnuje to samo ograniczenie wykluczające w Postgresie
 * (`booking_items_no_overlap`), co przy wizytach w salonie. Zestawienie
 * stolików to po prostu kilka pozycji tej samej rezerwacji.
 *
 * Reguły wstępu są te same co w POST /api/v1/bookings: termin musi wyjść
 * z silnika dostępności (tu: `resolveTableSlot`, razem z pacingiem), a klient
 * z blokadą no-show nie rezerwuje online. Ponad to dochodzi limit
 * `Location.maxPartySizeOnline` — większe grupy lokal ustala telefonicznie.
 *
 * Anulowanie NIE żyje tutaj: obsługuje je wspólne `cancelBooking()`
 * z src/lib/booking-cancel.ts (te same reguły cutoffu, zwrot zadatku, audyt
 * i e-maile co przy wizytach salonowych).
 */

export type TableBookingGuest = {
  name: string;
  phone: string;
  email: string;
};

export type CreateTableBookingInput = {
  slug: string;
  startAt: Date;
  partySize: number;
  /** Wybór gościa — pominięty oznacza „dobierz automatycznie". */
  tableIds?: string[];
  combinationId?: string;
  area?: RestaurantArea | null;
  /** Dane gościa bez konta... */
  guest?: TableBookingGuest;
  /** ...albo id zalogowanego użytkownika. */
  sessionUserId?: string | null;
  note?: string | null;
  source?: BookingSource;
  now?: Date;
};

export type TableBookingError =
  | "NOT_FOUND"
  | "VALIDATION"
  | "PARTY_TOO_LARGE"
  | "BOOKING_BLOCKED"
  | "SLOT_TAKEN"
  | "INTERNAL";

export type CreatedTableBooking = {
  id: string;
  status: "CONFIRMED";
  startAt: Date;
  endAt: Date;
  durationMin: number;
  partySize: number;
  tableIds: string[];
  tableNumbers: string[];
  tableLabel: string;
  combinationId?: string;
  area: RestaurantArea | null;
  businessName: string;
  locationName: string;
  address: string;
  timezone: string;
  cancellationCutoffHours: number;
  cancellationDeadline: Date;
};

export type CreateTableBookingResult =
  | { ok: true; context: RestaurantContext; booking: CreatedTableBooking }
  | {
      ok: false;
      error: TableBookingError;
      /** Gotowy komunikat po polsku — ten sam w API i w UI. */
      message: string;
      status: number;
    };

const fail = (
  status: number,
  error: TableBookingError,
  message: string,
): CreateTableBookingResult => ({ ok: false, status, error, message });

export const TABLE_SLOT_TAKEN_MESSAGE =
  "Ten stolik właśnie został zajęty. Wybierz inną godzinę.";

/**
 * Naruszenie exclusion constraint `booking_items_no_overlap` wychodzi
 * z Postgresa jako SQLSTATE 23P01 — Prisma nie mapuje go na dedykowany kod,
 * więc szukamy go w łańcuchu przyczyn błędu (tak samo jak POST
 * /api/v1/bookings; ta ścieżka nie może importować z pliku route'u).
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

export async function createTableBooking(
  input: CreateTableBookingInput,
): Promise<CreateTableBookingResult> {
  const now = input.now ?? new Date();

  if (!Number.isInteger(input.partySize) || input.partySize < 1) {
    return fail(422, "VALIDATION", "Podaj liczbę osób.");
  }
  if (!input.sessionUserId && !input.guest) {
    return fail(
      422,
      "VALIDATION",
      "Podaj dane rezerwującego albo zaloguj się.",
    );
  }
  if (input.startAt.getTime() <= now.getTime()) {
    return fail(422, "VALIDATION", "Termin musi być w przyszłości.");
  }

  const context = await getRestaurantLocation(input.slug);
  if (!context) {
    return fail(404, "NOT_FOUND", "Nie znaleziono restauracji.");
  }

  // Limit rezerwacji online: duże grupy lokal ustala telefonicznie (menu
  // degustacyjne, przedpłata, zestawianie stolików na miejscu).
  const maxOnline = context.location.maxPartySizeOnline;
  if (maxOnline !== null && input.partySize > maxOnline) {
    return fail(422, "PARTY_TOO_LARGE", partyTooLargeMessage(context));
  }

  // Rewalidacja terminu: dostępność stolika, bufor sprzątania, godziny
  // otwarcia i pacing — dokładnie te same reguły co przy wyświetlaniu godzin.
  const resolved = await resolveTableSlot({
    slug: input.slug,
    startAt: input.startAt,
    partySize: input.partySize,
    tableIds: input.tableIds,
    combinationId: input.combinationId,
    area: input.area ?? null,
    now,
    context,
  });
  if (!resolved) {
    return fail(409, "SLOT_TAKEN", TABLE_SLOT_TAKEN_MESSAGE);
  }
  const slot: TableSlot = resolved.slot;

  // Kontakt rezerwującego: zalogowany bierze dane z konta, gość z formularza.
  const sessionUser = input.sessionUserId
    ? await prisma.user.findUnique({
        where: { id: input.sessionUserId },
        select: { name: true, email: true, phone: true },
      })
    : null;
  const contact = {
    name: sessionUser?.name ?? input.guest?.name ?? "Gość",
    email: sessionUser?.email ?? input.guest?.email ?? null,
    phone: sessionUser?.phone ?? input.guest?.phone ?? null,
  };

  // Polityka no-show: zablokowany profil klienta nie rezerwuje online.
  // Sprawdzamy konto ORAZ kontakt (telefon po cyfrach, e-mail bez wielkości
  // liter) — dokładnie jak w POST /api/v1/bookings. Komunikat celowo nie
  // zdradza powodu blokady.
  const [blockedAccount, contactMatch] = await Promise.all([
    input.sessionUserId
      ? prisma.customer.findFirst({
          where: {
            businessId: context.business.id,
            userId: input.sessionUserId,
            isBlocked: true,
          },
          select: { id: true },
        })
      : null,
    findCustomerByContact(context.business.id, contact),
  ]);
  if (blockedAccount || contactMatch?.isBlocked) {
    return fail(
      403,
      "BOOKING_BLOCKED",
      "Rezerwacja online niedostępna. Skontaktuj się z restauracją.",
    );
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      // Profil CRM dla KAŻDEJ rezerwacji, także gościa — bez niego historia
      // wizyt i polityka no-show nie widzą rezerwacji z marketplace'u.
      const customerId = input.sessionUserId
        ? await findOrCreateCustomerForUser(
            context.business.id,
            input.sessionUserId,
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

      const guestData =
        !input.sessionUserId && input.guest
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
          customerUserId: input.sessionUserId ?? null,
          customerId,
          ...guestData,
          status: "CONFIRMED",
          source: input.source ?? "WEB_MARKETPLACE",
          startAt: slot.startAt,
          endAt: slot.endAt,
          totalPriceCents: 0,
          currency: context.service.currency,
          partySize: input.partySize,
          customerNote: input.note ?? null,
          // Pozycja na każdym zajmowanym stoliku — to one blokują salę.
          items: {
            create: slot.tableIds.map((tableId, index) => ({
              serviceId: context.service.id,
              resourceId: tableId,
              startAt: slot.startAt,
              endAt: slot.endAt,
              blockedStartAt: slot.blockedStartAt,
              blockedEndAt: slot.blockedEndAt,
              durationMin: slot.durationMin,
              bufferAfterMin: context.location.tableBufferMin,
              priceCents: 0,
              sortOrder: index,
            })),
          },
        },
        select: { id: true },
      });
    });

    // Poczta poza transakcją, best-effort i PO odpowiedzi — wolny Resend nie
    // może opóźnić 201 ani cofnąć zapisanej rezerwacji.
    try {
      after(() => sendBookingConfirmationEmails(created.id));
    } catch {
      // Poza kontekstem żądania `after` nie jest dostępny — wtedy po prostu
      // nie wysyłamy potwierdzenia (np. wywołanie ze skryptu).
    }

    const cancellationDeadline = new Date(
      slot.startAt.getTime() -
        context.location.cancellationCutoffHours * 60 * 60 * 1000,
    );

    return {
      ok: true,
      context,
      booking: {
        id: created.id,
        status: "CONFIRMED",
        startAt: slot.startAt,
        endAt: slot.endAt,
        durationMin: slot.durationMin,
        partySize: input.partySize,
        tableIds: slot.tableIds,
        tableNumbers: slot.tableNumbers,
        tableLabel: slot.label,
        ...(slot.combinationId ? { combinationId: slot.combinationId } : {}),
        area: slot.area,
        businessName: context.business.name,
        locationName: context.location.name,
        address: `${context.location.addressLine1}, ${context.location.postalCode} ${context.location.city}`,
        timezone: context.location.timezone,
        cancellationCutoffHours: context.location.cancellationCutoffHours,
        cancellationDeadline,
      },
    };
  } catch (error) {
    // Wyścig dwóch rezerwacji na ten sam stolik rozstrzyga baza, nie kod.
    if (isOverlapConflict(error)) {
      return fail(409, "SLOT_TAKEN", TABLE_SLOT_TAKEN_MESSAGE);
    }
    console.error("Błąd tworzenia rezerwacji stolika:", error);
    return fail(
      500,
      "INTERNAL",
      "Nie udało się zapisać rezerwacji. Spróbuj ponownie.",
    );
  }
}
