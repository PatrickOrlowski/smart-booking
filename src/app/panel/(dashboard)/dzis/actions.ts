"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import {
  ForbiddenError,
  UnauthorizedError,
  requireBusinessManager,
} from "@/lib/authz";
import {
  addMinutes,
  localDayMinutesToUtc,
  utcToZonedWallClock,
} from "@/lib/time";
import { sendMail } from "@/lib/mail";
import { refundPackageEntryForBooking } from "@/lib/packages";
import { settleBookingPaymentsOnCancellation } from "@/lib/payments";
import { emitEvent } from "@/lib/webhooks";
import { sendBookingCancellationEmails } from "@/app/api/v1/bookings/emails";
import { setBookingStatusAction } from "@/app/panel/(dashboard)/actions";

/**
 * Akcje hosta restauracji (widok /panel/dzis).
 *
 * Rezerwacja stolika to zwykły `Booking` z `partySize` i pozycją `BookingItem`
 * na każdym zajmowanym stoliku — dzięki temu podwójnych rezerwacji pilnuje
 * ograniczenie wykluczające `booking_items_no_overlap` w bazie, a nie kod.
 *
 * Wszystkie mutacje: `requireBusinessManager` + kontrola, że firma jest
 * restauracją, + Zod + strażnik stanu w samym UPDATE (żadnego
 * read-modify-write, po którym równoległa zmiana ginie bez śladu).
 */

type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

/**
 * Ile czasu host daje powiadomionemu gościowi na odpowiedź.
 *
 * To NIE jest blokada stolika: `WaitlistEntry.holdUntil` nie jest czytane ani
 * przez `getTableOccupancy`, ani przez `computeTableAvailability`, więc stolik
 * przez cały ten czas pozostaje dostępny online. Wpis (i e-mail) mówi wyłącznie
 * o terminie odpowiedzi — żadnych obietnic „trzymamy stolik".
 */
const WAITLIST_REPLY_MIN = 15;

const failure = (error: string): ActionResult => ({ ok: false, error });

/**
 * Baza rzuca 23P01 (exclusion constraint), gdy pozycja rezerwacji nachodzi
 * na inną blokującą pozycję tego samego stolika. Prisma nie mapuje tego kodu
 * na własny błąd — szukamy go w łańcuchu przyczyn.
 *
 * Kopia helpera z `(dashboard)/actions.ts`: pliki „use server" mogą
 * eksportować wyłącznie funkcje asynchroniczne, więc nie da się go stamtąd
 * współdzielić bez ruszania cudzego modułu.
 */
function isOverlapError(error: unknown): boolean {
  const seen = new Set<object>();
  const stack: unknown[] = [error];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const record = current as Record<string, unknown> & {
      message?: unknown;
      cause?: unknown;
    };
    for (const value of [
      ...Object.values(record),
      record.message,
      record.cause,
    ]) {
      if (
        typeof value === "string" &&
        (value.includes("23P01") ||
          value.toLowerCase().includes("exclusion constraint"))
      ) {
        return true;
      }
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return false;
}

/** Menedżer/właściciel restauracji — salon nie ma widoku hosta. */
async function requireRestaurantManager(businessId: string) {
  const result = await requireBusinessManager(businessId);
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { type: true },
  });
  if (!business || business.type !== "RESTAURANT") {
    throw new ForbiddenError("Widok hosta jest dostępny tylko w restauracji");
  }
  return result;
}

function handleError(scope: string, error: unknown): ActionResult {
  if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
    return failure(error.message);
  }
  if (isOverlapError(error)) {
    return failure("Ten stolik jest już zajęty w tym czasie");
  }
  console.error(scope, error);
  return failure("Nie udało się wykonać akcji. Spróbuj ponownie.");
}

function refresh(): void {
  revalidatePath("/panel/dzis");
  revalidatePath("/panel");
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Instant → "19:30" w strefie lokalu (nigdy przez toLocaleString). */
function formatInZone(instant: Date, timezone: string): string {
  const wall = utcToZonedWallClock(instant, timezone);
  return `${pad(wall.hour)}:${pad(wall.minute)}`;
}

/**
 * Czas zajęcia stolika: pierwsza pasująca reguła TurnTimeRule po liczbie osób,
 * w razie braku `Location.defaultTurnTimeMin`.
 */
async function resolveTurnTimeMin(
  locationId: string,
  partySize: number,
  fallbackMin: number,
): Promise<number> {
  const rule = await prisma.turnTimeRule.findFirst({
    where: {
      locationId,
      partySizeMin: { lte: partySize },
      partySizeMax: { gte: partySize },
    },
    orderBy: { partySizeMin: "asc" },
    select: { durationMin: true },
  });
  if (rule) return rule.durationMin;

  // Grupa większa niż najwyższa reguła dostaje JEJ czas, nie wartość domyślną
  // — inaczej dziesiątka siedziałaby krócej niż czwórka (ta sama zasada co
  // w `turnTimeForPartySize` w src/lib/table-availability.ts).
  const highest = await prisma.turnTimeRule.findFirst({
    where: { locationId, partySizeMax: { lt: partySize } },
    orderBy: { partySizeMax: "desc" },
    select: { durationMin: true },
  });
  return highest?.durationMin ?? fallbackMin;
}

type TableContext = {
  resourceId: string;
  locationId: string;
  timezone: string;
  defaultTurnTimeMin: number;
  tableBufferMin: number;
  openingHours: { weekday: number; startMinute: number; endMinute: number }[];
};

/** Stolik należący do firmy + ustawienia restauracyjne jego lokalu. */
async function loadTableContext(
  businessId: string,
  resourceId: string,
): Promise<TableContext | null> {
  const resource = await prisma.resource.findFirst({
    where: {
      id: resourceId,
      type: "TABLE",
      isActive: true,
      location: { businessId },
    },
    select: {
      id: true,
      location: {
        select: {
          id: true,
          timezone: true,
          defaultTurnTimeMin: true,
          tableBufferMin: true,
          openingHours: {
            select: { weekday: true, startMinute: true, endMinute: true },
          },
        },
      },
    },
  });
  if (!resource) return null;
  return {
    resourceId: resource.id,
    locationId: resource.location.id,
    timezone: resource.location.timezone,
    defaultTurnTimeMin: resource.location.defaultTurnTimeMin,
    tableBufferMin: resource.location.tableBufferMin,
    openingHours: resource.location.openingHours,
  };
}

/** Syntetyczna usługa „rezerwacja stolika" firmy (kind = TABLE_RESERVATION). */
async function loadTableService(businessId: string) {
  return prisma.service.findFirst({
    where: { businessId, kind: "TABLE_RESERVATION" },
    orderBy: { createdAt: "asc" },
    select: { id: true, currency: true, durationMin: true },
  });
}

type OpenWindow = { openMin: number; closeMin: number };

/**
 * Rozłączne okna otwarcia danego dnia tygodnia.
 *
 * Nie min(start)/max(end)! Lokal z lunchem 12:00–16:00 i kolacją 18:00–23:00
 * byłby wtedy „otwarty" 12:00–23:00 i host tworzyłby rezerwacje w przerwie,
 * których silnik online (mergeSpans + spanContains) i tak nie pokazuje.
 */
function openWindows(
  openingHours: { weekday: number; startMinute: number; endMinute: number }[],
  weekday: number,
): OpenWindow[] {
  const blocks = openingHours
    .filter((block) => block.weekday === weekday)
    .map((block) => ({
      openMin: block.startMinute,
      closeMin: block.endMinute,
    }))
    .filter((block) => block.closeMin > block.openMin)
    .sort((a, b) => a.openMin - b.openMin);

  const merged: OpenWindow[] = [];
  for (const block of blocks) {
    const last = merged[merged.length - 1];
    if (last && block.openMin <= last.closeMin) {
      last.closeMin = Math.max(last.closeMin, block.closeMin);
    } else {
      merged.push({ ...block });
    }
  }
  return merged;
}

/** Okno, które w CAŁOŚCI mieści [startMin, endMin] — albo null. */
function windowContaining(
  windows: OpenWindow[],
  startMin: number,
  endMin: number,
): OpenWindow | null {
  return (
    windows.find(
      (window) => window.openMin <= startMin && endMin <= window.closeMin,
    ) ?? null
  );
}

/** Czytelny opis godzin otwarcia do komunikatu błędu („12:00–16:00, 18:00–23:00"). */
function windowsLabel(windows: OpenWindow[]): string {
  const pad2 = (value: number) => String(value).padStart(2, "0");
  const label = (minute: number) =>
    `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`;
  return windows
    .map((window) => `${label(window.openMin)}–${label(window.closeMin)}`)
    .join(", ");
}

/**
 * Kolizje, których NIE łapie ograniczenie wykluczające `booking_items_no_overlap`
 * — leżą w innych tabelach: urlop/blokada stolika lub całego lokalu (`TimeOff`)
 * oraz aktywna blokada slotu na czas checkoutu (`Hold`). Silnik online honoruje
 * jedno i drugie (`computeTableAvailability`), więc host nie może ich pomijać.
 *
 * Zwraca gotowy komunikat albo null, gdy stolik jest wolny.
 */
async function findExternalConflict(options: {
  locationId: string;
  resourceId: string;
  startAt: Date;
  blockedEndAt: Date;
  now: Date;
}): Promise<string | null> {
  const [timeOff, hold] = await Promise.all([
    prisma.timeOff.findFirst({
      where: {
        OR: [
          { resourceId: options.resourceId },
          // Blokada CAŁEGO lokalu to wiersz bez zasobu — dokładnie tak
          // interpretuje go silnik (`tableId === null` → locationBusy).
          // Bez `resourceId: null` łapalibyśmy tu urlopy cudzych stolików.
          { resourceId: null, locationId: options.locationId },
        ],
        startAt: { lt: options.blockedEndAt },
        endAt: { gt: options.startAt },
      },
      select: { resourceId: true },
    }),
    prisma.hold.findFirst({
      where: {
        resourceId: options.resourceId,
        expiresAt: { gt: options.now },
        startAt: { lt: options.blockedEndAt },
        endAt: { gt: options.startAt },
      },
      select: { id: true },
    }),
  ]);

  if (timeOff) {
    return timeOff.resourceId
      ? "Ten stolik jest w tym czasie wyłączony z użytku"
      : "Lokal ma w tym czasie blokadę — nie da się posadzić gości";
  }
  if (hold) {
    return "Ten stolik jest właśnie rezerwowany przez gościa online. Poczekaj chwilę.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Akcje na rezerwacji
// ---------------------------------------------------------------------------

const bookingSchema = z.object({
  businessId: z.string().min(1),
  bookingId: z.string().min(1),
});

/** Potwierdzenie rezerwacji oczekującej: PENDING → CONFIRMED. */
export async function confirmTableBookingAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) return failure("Nieprawidłowe dane rezerwacji");
  const data = parsed.data;

  try {
    const { user } = await requireRestaurantManager(data.businessId);

    // Strażnik statusu w samym UPDATE — równoległe anulowanie przez gościa
    // nie może zostać „odpotwierdzone" przez read-modify-write.
    const updated = await prisma.booking.updateMany({
      where: {
        id: data.bookingId,
        businessId: data.businessId,
        status: "PENDING",
      },
      data: { status: "CONFIRMED" },
    });
    if (updated.count === 0) {
      return failure("Rezerwacja nie oczekuje już na potwierdzenie. Odśwież widok.");
    }

    await logAudit({
      businessId: data.businessId,
      actorUserId: user.id,
      action: "BOOKING_CONFIRMED",
      entityType: "Booking",
      entityId: data.bookingId,
      metadata: { source: "host-dzis" },
    });
  } catch (error) {
    return handleError("confirmTableBookingAction", error);
  }

  refresh();
  return { ok: true, message: "Rezerwacja potwierdzona" };
}

/**
 * „Posadź" — gość przy stole: PENDING/CONFIRMED → CONFIRMED.
 *
 * Posadzenie NIE jest zakończeniem wizyty. Wcześniej akcja ustawiała
 * COMPLETED, przez co gość w chwili posadzenia widział rezerwację jako
 * zakończoną i dostawał przycisk „Oceń" (konto/booking-status.ts), statystyki
 * liczyły ją jako odbytą, a host tracił „Nie przyszli"/„Odwołaj". Status
 * COMPLETED zostaje wyłącznie dla `setBookingStatusAction`.
 *
 * Ten sam wzorzec strażnika co `setBookingStatusAction` w panelu, ale bez
 * warunku „wizyta już się zaczęła": hosta obowiązuje doba lokalu, nie zegar
 * co do minuty (gości sadza się też kwadrans przed czasem). Moment posadzenia
 * zapisujemy w audycie — schemat nie ma pola `seatedAt`.
 */
export async function seatTableBookingAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) return failure("Nieprawidłowe dane rezerwacji");
  const data = parsed.data;

  try {
    const { user } = await requireRestaurantManager(data.businessId);

    const booking = await prisma.booking.findFirst({
      where: { id: data.bookingId, businessId: data.businessId },
      select: {
        id: true,
        startAt: true,
        location: { select: { timezone: true } },
      },
    });
    if (!booking) return failure("Nie znaleziono rezerwacji");

    const timezone = booking.location.timezone;
    const seatedAt = new Date();
    const bookingDay = utcToZonedWallClock(booking.startAt, timezone);
    const today = utcToZonedWallClock(seatedAt, timezone);
    const sameDay =
      bookingDay.year === today.year &&
      bookingDay.month === today.month &&
      bookingDay.day === today.day;
    if (!sameDay) {
      return failure("Posadzić można tylko gościa z dzisiejszej listy");
    }

    const updated = await prisma.booking.updateMany({
      where: {
        id: booking.id,
        businessId: data.businessId,
        status: { in: ["PENDING", "CONFIRMED"] },
      },
      data: { status: "CONFIRMED" },
    });
    if (updated.count === 0) {
      return failure("Status rezerwacji zmienił się w międzyczasie. Odśwież widok.");
    }

    await logAudit({
      businessId: data.businessId,
      actorUserId: user.id,
      action: "BOOKING_SEATED",
      entityType: "Booking",
      entityId: booking.id,
      metadata: {
        seatedAt: seatedAt.toISOString(),
        seatedAtLocal: formatInZone(seatedAt, timezone),
        timezone,
      },
    });
  } catch (error) {
    return handleError("seatTableBookingAction", error);
  }

  refresh();
  return { ok: true, message: "Gość posadzony przy stole" };
}

/**
 * „Nie przyszli" — delegacja do istniejącej ścieżki panelu, żeby polityka
 * no-show (`registerNoShow`, licznik i blokada klienta, wpis audytu) miała
 * jedno miejsce w kodzie.
 */
export async function markTableNoShowAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) return failure("Nieprawidłowe dane rezerwacji");
  const data = parsed.data;

  try {
    await requireRestaurantManager(data.businessId);
  } catch (error) {
    return handleError("markTableNoShowAction", error);
  }

  const result = await setBookingStatusAction({
    businessId: data.businessId,
    bookingId: data.bookingId,
    status: "NO_SHOW",
  });
  if (!result.ok) return result;

  refresh();
  return { ok: true, message: "Oznaczono nieobecność" };
}

const cancelSchema = bookingSchema.extend({
  reason: z.string().trim().max(200).optional(),
});

/** Odwołanie rezerwacji przez lokal: PENDING/CONFIRMED → CANCELLED_BY_BUSINESS. */
export async function cancelTableBookingAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return failure("Nieprawidłowe dane rezerwacji");
  const data = parsed.data;

  try {
    const { user } = await requireRestaurantManager(data.businessId);

    const cancelledAt = new Date();
    // Zwrot wejścia z karnetu w tej samej transakcji co zmiana statusu —
    // odwołana wizyta opłacona karnetem oddaje wejście klientowi.
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.booking.updateMany({
        where: {
          id: data.bookingId,
          businessId: data.businessId,
          status: { in: ["PENDING", "CONFIRMED"] },
        },
        data: {
          status: "CANCELLED_BY_BUSINESS",
          cancelledAt,
          cancellationReason: data.reason || null,
        },
      });
      if (result.count > 0) {
        await refundPackageEntryForBooking(tx, data.bookingId);
      }
      return result;
    });
    if (updated.count === 0) {
      return failure("Tej rezerwacji nie można już odwołać. Odśwież widok.");
    }

    // Zadatek (przy dużych grupach) musi zostać rozliczony tak samo jak
    // przy anulowaniu przez gościa — jedno źródło prawdy w payments.ts.
    const settledPayments = await settleBookingPaymentsOnCancellation(
      data.bookingId,
      { actorUserId: user.id, reason: data.reason ?? null },
    );
    await logAudit({
      businessId: data.businessId,
      actorUserId: user.id,
      action: "BOOKING_CANCELLED",
      entityType: "Booking",
      entityId: data.bookingId,
      metadata: {
        cancelledBy: "business",
        reason: data.reason ?? null,
        payments: settledPayments,
      },
    });

    // Poczta best-effort i po odpowiedzi — nie może opóźniać akcji hosta.
    after(() => sendBookingCancellationEmails(data.bookingId));

    // Webhooki integratorów: dokumentacja obiecuje booking.cancelled przy
    // KAŻDYM odwołaniu — także zainicjowanym przez lokal (spójnie
    // z booking-cancel.ts i publicznym API).
    after(() =>
      emitEvent(data.businessId, "booking.cancelled", {
        bookingId: data.bookingId,
        status: "CANCELLED_BY_BUSINESS",
        cancelledAt: cancelledAt.toISOString(),
        reason: data.reason || null,
      }),
    );
  } catch (error) {
    return handleError("cancelTableBookingAction", error);
  }

  refresh();
  return { ok: true, message: "Rezerwacja odwołana" };
}

// ---------------------------------------------------------------------------
// Gość „z ulicy" (walk-in)
// ---------------------------------------------------------------------------

const walkInSchema = z.object({
  businessId: z.string().min(1),
  resourceId: z.string().min(1),
  partySize: z.number().int().min(1).max(30),
  guestName: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

/**
 * Rezerwacja gościa z ulicy: od teraz na czas z turn time, od razu CONFIRMED,
 * źródło MANUAL_STAFF. Godzina startu liczona wyłącznie na serwerze — klient
 * nie przysyła czasu, więc nie da się nią manipulować.
 *
 * Gdy lokal jeszcze nie otworzył, start przesuwa się na godzinę otwarcia;
 * gdy koniec wypadłby po zamknięciu, czas przy stole jest przycinany do
 * zamknięcia (rezerwacja musi mieścić się w godzinach otwarcia w całości).
 */
export async function createWalkInBookingAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = walkInSchema.safeParse(input);
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? "Nieprawidłowe dane");
  }
  const data = parsed.data;

  try {
    const { user } = await requireRestaurantManager(data.businessId);

    const [table, service] = await Promise.all([
      loadTableContext(data.businessId, data.resourceId),
      loadTableService(data.businessId),
    ]);
    if (!table) return failure("Nie znaleziono stolika");
    if (!service) {
      return failure("Lokal nie ma technicznej usługi rezerwacji stolika");
    }

    const now = new Date();
    const wall = utcToZonedWallClock(now, table.timezone);
    const windows = openWindows(table.openingHours, wall.weekday);
    if (windows.length === 0) return failure("Lokal jest dziś zamknięty");

    const nowMin = wall.hour * 60 + wall.minute;
    // Bieżące okno, a gdy trwa przerwa (albo lokal jeszcze nie otworzył) —
    // najbliższe następne. Rezerwacja nigdy nie wypada w przerwie.
    const window =
      windows.find(
        (block) => nowMin >= block.openMin && nowMin < block.closeMin,
      ) ?? windows.find((block) => block.openMin > nowMin);
    if (!window) return failure("Lokal jest już zamknięty");

    const startMin = Math.max(nowMin, window.openMin);
    const turnTimeMin = await resolveTurnTimeMin(
      table.locationId,
      data.partySize,
      table.defaultTurnTimeMin,
    );
    const endMin = Math.min(startMin + turnTimeMin, window.closeMin);
    if (endMin - startMin < 15) {
      return failure("Do zamknięcia lokalu zostało za mało czasu");
    }

    const day = { year: wall.year, month: wall.month, day: wall.day };
    const startAt = localDayMinutesToUtc(day, startMin, table.timezone);
    const endAt = localDayMinutesToUtc(day, endMin, table.timezone);
    const blockedEndAt = addMinutes(endAt, table.tableBufferMin);

    // Ograniczenie wykluczające widzi tylko `booking_items` — urlop stolika
    // i blokadę lokalu trzeba sprawdzić osobno.
    const conflict = await findExternalConflict({
      locationId: table.locationId,
      resourceId: table.resourceId,
      startAt,
      blockedEndAt,
      now,
    });
    if (conflict) return failure(conflict);

    await prisma.booking.create({
      select: { id: true },
      data: {
        businessId: data.businessId,
        locationId: table.locationId,
        guestName: data.guestName || "Gość z ulicy",
        status: "CONFIRMED",
        source: "MANUAL_STAFF",
        startAt,
        endAt,
        totalPriceCents: 0,
        currency: service.currency,
        partySize: data.partySize,
        internalNote: data.note || null,
        items: {
          create: {
            serviceId: service.id,
            resourceId: table.resourceId,
            startAt,
            endAt,
            blockedStartAt: startAt,
            // Bufor na sprzątanie po wyjściu gości.
            blockedEndAt,
            durationMin: endMin - startMin,
            bufferAfterMin: table.tableBufferMin,
            priceCents: 0,
          },
        },
      },
    });

    await logAudit({
      businessId: data.businessId,
      actorUserId: user.id,
      action: "BOOKING_WALK_IN",
      entityType: "Resource",
      entityId: table.resourceId,
      metadata: {
        partySize: data.partySize,
        startLocal: formatInZone(startAt, table.timezone),
        endLocal: formatInZone(endAt, table.timezone),
        turnTimeMin,
      },
    });

    const clamped = endMin - startMin < turnTimeMin;
    refresh();
    return {
      ok: true,
      message: clamped
        ? `Stolik zajęty do zamknięcia (${formatInZone(endAt, table.timezone)})`
        : `Stolik zajęty ${formatInZone(startAt, table.timezone)}–${formatInZone(endAt, table.timezone)}`,
    };
  } catch (error) {
    return handleError("createWalkInBookingAction", error);
  }
}

// ---------------------------------------------------------------------------
// Lista oczekujących
// ---------------------------------------------------------------------------

const waitlistSchema = z.object({
  businessId: z.string().min(1),
  entryId: z.string().min(1),
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * „Powiadom" — wpis dostaje status NOTIFIED i termin odpowiedzi (`holdUntil`).
 * E-mail (gdy znamy adres) leci przez `sendMail`, więc próba trafia do tabeli
 * `notifications` także bez klucza Resend (status SKIPPED).
 *
 * Uwaga: to powiadomienie, nie rezerwacja. Stolik nie jest nigdzie blokowany
 * (patrz `WAITLIST_REPLY_MIN`), więc ani mail, ani toast nie mogą tego
 * obiecywać — kto pierwszy potwierdzi, ten siada.
 */
export async function notifyWaitlistEntryAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = waitlistSchema.safeParse(input);
  if (!parsed.success) return failure("Nieprawidłowe dane wpisu");
  const data = parsed.data;

  try {
    const { user } = await requireRestaurantManager(data.businessId);

    const entry = await prisma.waitlistEntry.findFirst({
      where: { id: data.entryId, businessId: data.businessId },
      select: {
        id: true,
        partySize: true,
        requestedAt: true,
        guestName: true,
        guestEmail: true,
        customer: { select: { fullName: true, email: true } },
        user: { select: { name: true, email: true } },
        business: { select: { name: true } },
        location: { select: { timezone: true, phone: true } },
      },
    });
    if (!entry) return failure("Nie znaleziono wpisu na liście");

    const notifiedAt = new Date();
    const holdUntil = addMinutes(notifiedAt, WAITLIST_REPLY_MIN);
    const updated = await prisma.waitlistEntry.updateMany({
      where: {
        id: entry.id,
        businessId: data.businessId,
        status: { in: ["WAITING", "NOTIFIED"] },
      },
      data: { status: "NOTIFIED", notifiedAt, holdUntil },
    });
    if (updated.count === 0) {
      return failure("Ten wpis nie czeka już na stolik. Odśwież widok.");
    }

    await logAudit({
      businessId: data.businessId,
      actorUserId: user.id,
      action: "WAITLIST_NOTIFIED",
      entityType: "WaitlistEntry",
      entityId: entry.id,
      metadata: { holdUntil: holdUntil.toISOString() },
    });

    const email =
      entry.guestEmail ?? entry.customer?.email ?? entry.user?.email ?? null;
    if (email) {
      const timezone = entry.location.timezone;
      const guest =
        entry.guestName ?? entry.customer?.fullName ?? entry.user?.name ?? "";
      const requested = formatInZone(entry.requestedAt, timezone);
      const until = formatInZone(holdUntil, timezone);
      const phone = entry.location.phone;
      const lines = [
        `${guest ? `${guest}, z` : "Z"}wolnił się stolik w ${entry.business.name} na godzinę ${requested} (${entry.partySize} os.).`,
        // Bez obietnicy blokady: stolik jest nadal dostępny online, więc
        // liczy się kolejność potwierdzeń, a nie sam fakt powiadomienia.
        `Odezwij się do ${until}${phone ? `, żeby go potwierdzić: ${phone}` : ""} — stolik nie jest zarezerwowany, dostaje go pierwsza osoba, która potwierdzi.`,
      ];
      after(() =>
        sendMail({
          to: email,
          type: "WAITLIST_NOTIFIED",
          subject: `Zwolnił się stolik — ${entry.business.name}, ${requested}`,
          html: `<div style="font-family:'Instrument Sans',Arial,sans-serif;font-size:14px;line-height:1.6;color:#131412;">${lines
            .map((line) => `<p>${escapeHtml(line)}</p>`)
            .join("")}</div>`,
          text: lines.join("\n"),
        }),
      );
    }

    refresh();
    return {
      ok: true,
      message: email
        ? `Powiadomiono gościa — czeka na odpowiedź do ${WAITLIST_REPLY_MIN} min (stolik nie jest blokowany)`
        : `Oznaczono jako powiadomiony (brak e-maila — zadzwoń; stolik nie jest blokowany)`,
    };
  } catch (error) {
    return handleError("notifyWaitlistEntryAction", error);
  }
}

const convertSchema = waitlistSchema.extend({
  resourceId: z.string().min(1),
  startMinute: z.number().int().min(0).max(1439),
});

/**
 * „Zamień na rezerwację" — wpis z listy staje się rezerwacją stolika.
 *
 * Zajęcie wpisu i utworzenie rezerwacji idą w jednej transakcji: gdy
 * ograniczenie wykluczające odrzuci kolidujący stolik, wpis wraca do stanu
 * oczekiwania zamiast zostać CONVERTED bez rezerwacji.
 */
export async function convertWaitlistEntryAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = convertSchema.safeParse(input);
  if (!parsed.success) return failure("Nieprawidłowe dane rezerwacji");
  const data = parsed.data;

  try {
    const { user } = await requireRestaurantManager(data.businessId);

    const [entry, table, service] = await Promise.all([
      prisma.waitlistEntry.findFirst({
        where: { id: data.entryId, businessId: data.businessId },
        select: {
          id: true,
          locationId: true,
          partySize: true,
          requestedAt: true,
          note: true,
          guestName: true,
          guestEmail: true,
          guestPhone: true,
          customerId: true,
          customerUserId: true,
        },
      }),
      loadTableContext(data.businessId, data.resourceId),
      loadTableService(data.businessId),
    ]);
    if (!entry) return failure("Nie znaleziono wpisu na liście");
    if (!table) return failure("Nie znaleziono stolika");
    if (table.locationId !== entry.locationId) {
      return failure("Stolik należy do innego lokalu");
    }
    if (!service) {
      return failure("Lokal nie ma technicznej usługi rezerwacji stolika");
    }

    // Dzień bierzemy z żądanego terminu wpisu (w strefie lokalu) — host
    // przesuwa tylko godzinę w obrębie tego dnia.
    const requested = utcToZonedWallClock(entry.requestedAt, table.timezone);
    const day = {
      year: requested.year,
      month: requested.month,
      day: requested.day,
    };
    const windows = openWindows(table.openingHours, requested.weekday);
    if (windows.length === 0) return failure("Lokal jest tego dnia zamknięty");

    const turnTimeMin = await resolveTurnTimeMin(
      table.locationId,
      entry.partySize,
      table.defaultTurnTimeMin,
    );
    const startMin = data.startMinute;
    const endMin = startMin + turnTimeMin;
    // Cała rezerwacja musi zmieścić się w JEDNYM oknie otwarcia — przerwa
    // między lunchem a kolacją nie jest czasem, w którym lokal obsługuje gości.
    if (!windowContaining(windows, startMin, endMin)) {
      return failure(
        `Rezerwacja (${turnTimeMin} min) musi zmieścić się w godzinach otwarcia: ${windowsLabel(windows)}`,
      );
    }

    const now = new Date();
    const startAt = localDayMinutesToUtc(day, startMin, table.timezone);
    const endAt = localDayMinutesToUtc(day, endMin, table.timezone);
    const blockedEndAt = addMinutes(endAt, table.tableBufferMin);

    // Host nawigujący na wcześniejszy dzień wciąż widzi wpisy WAITING z tamtej
    // doby — bez tego strażnika powstawała CONFIRMED w przeszłości, blokująca
    // historyczny slot i psująca statystyki.
    if (startAt.getTime() <= now.getTime()) {
      return failure("Rezerwację można utworzyć tylko na przyszły termin");
    }

    const conflict = await findExternalConflict({
      locationId: table.locationId,
      resourceId: table.resourceId,
      startAt,
      blockedEndAt,
      now,
    });
    if (conflict) return failure(conflict);

    const bookingId = await prisma.$transaction(async (tx) => {
      // Zajmujemy wpis strażnikiem statusu — dwóch hostów nie zamieni tego
      // samego zgłoszenia na dwie rezerwacje.
      const claimed = await tx.waitlistEntry.updateMany({
        where: {
          id: entry.id,
          businessId: data.businessId,
          status: { in: ["WAITING", "NOTIFIED"] },
        },
        data: { status: "CONVERTED" },
      });
      if (claimed.count === 0) {
        throw new ForbiddenError("Ten wpis został już obsłużony. Odśwież widok.");
      }

      const booking = await tx.booking.create({
        select: { id: true },
        data: {
          businessId: data.businessId,
          locationId: entry.locationId,
          customerId: entry.customerId,
          customerUserId: entry.customerUserId,
          guestName: entry.guestName,
          guestEmail: entry.guestEmail,
          guestPhone: entry.guestPhone,
          status: "CONFIRMED",
          source: "MANUAL_STAFF",
          startAt,
          endAt,
          totalPriceCents: 0,
          currency: service.currency,
          partySize: entry.partySize,
          customerNote: entry.note,
          items: {
            create: {
              serviceId: service.id,
              resourceId: table.resourceId,
              startAt,
              endAt,
              blockedStartAt: startAt,
              blockedEndAt,
              durationMin: turnTimeMin,
              bufferAfterMin: table.tableBufferMin,
              priceCents: 0,
            },
          },
        },
      });

      await tx.waitlistEntry.update({
        where: { id: entry.id },
        data: { bookingId: booking.id },
      });

      return booking.id;
    });

    // Audyt POZA transakcją: `logAudit` idzie globalnym klientem, więc w środku
    // `$transaction` zabierał drugie połączenie z puli (na Neonie potrafi to
    // zagłodzić transakcję do timeoutu), a przy nieudanym commicie zostawiał
    // wpis WAITLIST_CONVERTED bez rezerwacji.
    await logAudit({
      businessId: data.businessId,
      actorUserId: user.id,
      action: "WAITLIST_CONVERTED",
      entityType: "WaitlistEntry",
      entityId: entry.id,
      metadata: {
        bookingId,
        resourceId: table.resourceId,
        startLocal: formatInZone(startAt, table.timezone),
        partySize: entry.partySize,
      },
    });

    refresh();
    return {
      ok: true,
      message: `Rezerwacja utworzona na ${formatInZone(startAt, table.timezone)}`,
    };
  } catch (error) {
    return handleError("convertWaitlistEntryAction", error);
  }
}

/** „Usuń" — wpis znika z listy hosta (status CANCELLED). */
export async function cancelWaitlistEntryAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = waitlistSchema.safeParse(input);
  if (!parsed.success) return failure("Nieprawidłowe dane wpisu");
  const data = parsed.data;

  try {
    const { user } = await requireRestaurantManager(data.businessId);

    const updated = await prisma.waitlistEntry.updateMany({
      where: {
        id: data.entryId,
        businessId: data.businessId,
        status: { in: ["WAITING", "NOTIFIED", "EXPIRED"] },
      },
      data: { status: "CANCELLED", holdUntil: null },
    });
    if (updated.count === 0) {
      return failure("Tego wpisu nie można już usunąć. Odśwież widok.");
    }

    await logAudit({
      businessId: data.businessId,
      actorUserId: user.id,
      action: "WAITLIST_CANCELLED",
      entityType: "WaitlistEntry",
      entityId: data.entryId,
    });
  } catch (error) {
    return handleError("cancelWaitlistEntryAction", error);
  }

  refresh();
  return { ok: true, message: "Wpis usunięty z listy" };
}
