import { prisma } from "@/lib/prisma";
import { addMinutes, utcToZonedWallClock } from "@/lib/time";
import {
  MAX_SERIES_OCCURRENCES,
  planSeriesDates,
  type PlannedOccurrence,
} from "@/lib/booking-series";
import { TIME_OFF_LABELS, WEEKDAY_SHORT } from "@/components/panel/format";

/**
 * Warstwa danych rezerwacji cyklicznych: kontekst reguły (pracownik, usługa,
 * lokalizacja) oraz sprawdzenie, które z zaplanowanych terminów są wolne.
 *
 * Podgląd i zapis korzystają z tego samego kodu — inaczej lista pokazana
 * przed zapisem rozjeżdżałaby się z tym, co faktycznie powstanie.
 */

export type SeriesContext = {
  location: {
    id: string;
    timezone: string;
    maxAdvanceDays: number;
  };
  resource: { id: string; name: string };
  service: {
    id: string;
    name: string;
    currency: string;
    durationMin: number;
    priceCents: number;
    bufferBeforeMin: number;
    bufferAfterMin: number;
  };
};

/**
 * Pracownik + usługa firmy wraz z nadpisaniami ServiceResource.
 * Zwraca null, gdy którekolwiek id nie należy do tej firmy — id z formularza
 * nigdy nie jest zaufane.
 */
export async function loadSeriesContext(
  businessId: string,
  resourceId: string,
  serviceId: string,
): Promise<SeriesContext | null> {
  const [resource, service] = await Promise.all([
    prisma.resource.findFirst({
      where: {
        id: resourceId,
        type: "STAFF",
        isActive: true,
        location: { businessId },
      },
      select: {
        id: true,
        name: true,
        location: {
          select: { id: true, timezone: true, maxAdvanceDays: true },
        },
      },
    }),
    prisma.service.findFirst({
      where: { id: serviceId, businessId },
      select: {
        id: true,
        name: true,
        currency: true,
        durationMin: true,
        priceCents: true,
        bufferBeforeMin: true,
        bufferAfterMin: true,
        resources: {
          where: { resourceId },
          select: { durationMinOverride: true, priceCentsOverride: true },
        },
      },
    }),
  ]);

  if (!resource || !service) return null;

  const override = service.resources[0];
  return {
    location: resource.location,
    resource: { id: resource.id, name: resource.name },
    service: {
      id: service.id,
      name: service.name,
      currency: service.currency,
      durationMin: override?.durationMinOverride ?? service.durationMin,
      priceCents: override?.priceCentsOverride ?? service.priceCents,
      bufferBeforeMin: service.bufferBeforeMin,
      bufferAfterMin: service.bufferAfterMin,
    },
  };
}

export type SeriesRule = {
  startDate: string;
  weekday: number;
  startMinute: number;
  intervalWeeks: number;
  occurrences?: number | null;
  endDate?: string | null;
};

/** Przedziały jednej wizyty: widoczny dla klienta i blokujący grafik. */
export type PlannedVisit = PlannedOccurrence & {
  endAt: Date;
  blockedStartAt: Date;
  blockedEndAt: Date;
};

/**
 * Horyzont przy odtwarzaniu ZAPISANEJ reguły. Zapisując serię, utrwalamy
 * faktyczną liczbę terminów w `occurrences`, więc lista dat jest już domknięta
 * — horyzont lokalizacji nie może jej po latach skrócić i „zgubić" wizyt,
 * które realnie istnieją w kalendarzu.
 */
export const STORED_RULE_HORIZON_DAYS = 3650;

/** Kolumna @db.Date (północ UTC) → „2026-09-10". */
export const dateColumnToIso = (value: Date): string =>
  `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;

export type StoredSeriesRule = {
  startDate: Date;
  endDate: Date | null;
  occurrences: number | null;
  weekday: number;
  startMinute: number;
  intervalWeeks: number;
};

/** Terminy wynikające z reguły zapisanej w bazie. */
export function planStoredSeriesVisits(
  series: StoredSeriesRule,
  context: SeriesContext,
): PlannedVisit[] {
  return planSeriesVisits(
    {
      startDate: dateColumnToIso(series.startDate),
      weekday: series.weekday,
      startMinute: series.startMinute,
      intervalWeeks: series.intervalWeeks,
      // Reguła bez żadnego końca nie powinna istnieć (walidacja przy zapisie),
      // ale wiersz z importu/seeda nie może wywrócić strony szczegółów.
      occurrences:
        series.occurrences ??
        (series.endDate === null ? MAX_SERIES_OCCURRENCES : null),
      endDate: series.endDate ? dateColumnToIso(series.endDate) : null,
    },
    {
      ...context,
      location: {
        ...context.location,
        maxAdvanceDays: STORED_RULE_HORIZON_DAYS,
      },
    },
  );
}

export function planSeriesVisits(
  rule: SeriesRule,
  context: SeriesContext,
): PlannedVisit[] {
  const planned = planSeriesDates({
    startDate: rule.startDate,
    weekday: rule.weekday,
    startMinute: rule.startMinute,
    intervalWeeks: rule.intervalWeeks,
    occurrences: rule.occurrences ?? null,
    endDate: rule.endDate ?? null,
    timezone: context.location.timezone,
    maxAdvanceDays: context.location.maxAdvanceDays,
  });

  return planned.map((entry) => {
    const endAt = addMinutes(entry.startAt, context.service.durationMin);
    return {
      ...entry,
      endAt,
      blockedStartAt: addMinutes(entry.startAt, -context.service.bufferBeforeMin),
      blockedEndAt: addMinutes(endAt, context.service.bufferAfterMin),
    };
  });
}

/**
 * `busy` = kolizja z inną wizytą (twarda — baza i tak odrzuci taki INSERT),
 * `timeOff` = urlop/blokada, `outsideHours` = poza grafikiem pracownika.
 * Dwa ostatnie są ostrzeżeniami: obsługa świadomie wpisuje wizyty poza
 * grafikiem, tak samo jak przy pojedynczej wizycie ręcznej.
 */
export type PlannedSlotStatus = "free" | "busy" | "timeOff" | "outsideHours";

export type PlannedSlotPreview = {
  index: number;
  iso: string;
  startAtIso: string;
  /** „cz 06.08, 17:00" — sformatowane w strefie lokalizacji. */
  label: string;
  /** „06.08" — do krótkich komunikatów. */
  dayLabel: string;
  status: PlannedSlotStatus;
  detail: string | null;
};

/** Instant → „cz 06.08, 17:00" w strefie lokalizacji. */
export function formatVisitLabel(instant: Date, timezone: string): string {
  const wall = utcToZonedWallClock(instant, timezone);
  return `${WEEKDAY_SHORT[wall.weekday]} ${dayLabelOf(instant, timezone)}, ${clockOf(wall)}`;
}

/** Instant → „06.08" w strefie lokalizacji. */
export function dayLabelOf(instant: Date, timezone: string): string {
  const wall = utcToZonedWallClock(instant, timezone);
  return `${String(wall.day).padStart(2, "0")}.${String(wall.month).padStart(2, "0")}`;
}

const clockOf = (wall: { hour: number; minute: number }): string =>
  `${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`;

/** Instant → „17:00" w strefie lokalizacji. */
export function timeLabelOf(instant: Date, timezone: string): string {
  return clockOf(utcToZonedWallClock(instant, timezone));
}

const overlaps = (
  a: { start: Date; end: Date },
  b: { start: Date; end: Date },
): boolean => a.start.getTime() < b.end.getTime() && a.end.getTime() > b.start.getTime();

/**
 * Sprawdza zaplanowane terminy jednym zapytaniem na kategorię (a nie jednym
 * na wizytę) i zwraca gotową listę do podglądu w dialogu.
 */
export async function checkPlannedVisits(
  visits: PlannedVisit[],
  context: SeriesContext,
): Promise<PlannedSlotPreview[]> {
  if (visits.length === 0) return [];

  const tz = context.location.timezone;
  const rangeStart = visits[0]!.blockedStartAt;
  const rangeEnd = visits[visits.length - 1]!.blockedEndAt;

  const [busyItems, timeOff, workingHours] = await Promise.all([
    prisma.bookingItem.findMany({
      where: {
        resourceId: context.resource.id,
        isBlocking: true,
        blockedStartAt: { lt: rangeEnd },
        blockedEndAt: { gt: rangeStart },
      },
      select: {
        startAt: true,
        endAt: true,
        blockedStartAt: true,
        blockedEndAt: true,
        booking: {
          select: {
            guestName: true,
            customer: { select: { fullName: true } },
            user: { select: { name: true } },
          },
        },
      },
      orderBy: { blockedStartAt: "asc" },
    }),
    prisma.timeOff.findMany({
      where: {
        OR: [
          { resourceId: context.resource.id },
          { locationId: context.location.id },
        ],
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
      },
      select: { startAt: true, endAt: true, type: true, reason: true },
    }),
    prisma.workingHours.findMany({
      where: { resourceId: context.resource.id },
      select: {
        weekday: true,
        startMinute: true,
        endMinute: true,
        validFrom: true,
        validTo: true,
      },
    }),
  ]);

  return visits.map((visit) => {
    const span = { start: visit.blockedStartAt, end: visit.blockedEndAt };
    const base = {
      index: visit.index,
      iso: visit.iso,
      startAtIso: visit.startAt.toISOString(),
      label: formatVisitLabel(visit.startAt, tz),
      dayLabel: dayLabelOf(visit.startAt, tz),
    };

    const busy = busyItems.find((item) =>
      overlaps(span, { start: item.blockedStartAt, end: item.blockedEndAt }),
    );
    if (busy) {
      const who =
        busy.booking.customer?.fullName ??
        busy.booking.user?.name ??
        busy.booking.guestName ??
        null;
      const hours = `${timeLabelOf(busy.startAt, tz)}–${timeLabelOf(busy.endAt, tz)}`;
      return {
        ...base,
        status: "busy" as const,
        detail: who ? `zajęte ${hours} · ${who}` : `zajęte ${hours}`,
      };
    }

    const off = timeOff.find((entry) =>
      overlaps(span, { start: entry.startAt, end: entry.endAt }),
    );
    if (off) {
      return {
        ...base,
        status: "timeOff" as const,
        detail: off.reason
          ? `${TIME_OFF_LABELS[off.type]} · ${off.reason}`
          : TIME_OFF_LABELS[off.type],
      };
    }

    // Grafik pracownika: wersja obowiązująca tego dnia musi objąć całą
    // widoczną część wizyty (bufory mogą wystawać poza grafik).
    const daySerial = Date.UTC(
      visit.date.year,
      visit.date.month - 1,
      visit.date.day,
    );
    const wall = utcToZonedWallClock(visit.startAt, tz);
    const visitStartMin = wall.hour * 60 + wall.minute;
    const visitEndMin = visitStartMin + context.service.durationMin;
    const covered = workingHours.some(
      (rule) =>
        rule.weekday === wall.weekday &&
        (rule.validFrom === null || rule.validFrom.getTime() <= daySerial) &&
        (rule.validTo === null || rule.validTo.getTime() >= daySerial) &&
        rule.startMinute <= visitStartMin &&
        rule.endMinute >= visitEndMin,
    );
    if (!covered) {
      return {
        ...base,
        status: "outsideHours" as const,
        detail: "poza grafikiem pracownika",
      };
    }

    return { ...base, status: "free" as const, detail: null };
  });
}

/**
 * Baza rzuca 23P01 (exclusion constraint `booking_items_no_overlap`), gdy
 * pozycja rezerwacji nachodzi na inny blokujący wpis tego samego zasobu.
 * Prisma nie mapuje tego kodu na własny błąd, więc szukamy go w łańcuchu
 * przyczyn — kolizja pojedynczego terminu nie może wywrócić całej serii.
 */
export function isOverlapError(error: unknown): boolean {
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
