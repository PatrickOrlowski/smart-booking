import { localDayMinutesToUtc, utcToZonedWallClock } from "@/lib/time";

/**
 * Silnik dostępności — czysta logika, zero I/O.
 *
 * Wejście to dane (grafiki, godziny otwarcia, urlopy, zajęte przedziały,
 * aktywne holdy) plus konfiguracja lokalizacji; wyjście to wolne sloty
 * per zasób oraz scalony widok „dowolny pracownik".
 *
 * Grafiki i godziny otwarcia są zapisane w minutach czasu ściennego
 * lokalizacji — wszystkie konwersje idą przez src/lib/time.ts, więc doby
 * 23- i 25-godzinne (DST) wychodzą poprawnie. Wynik jest zawsze w UTC.
 */

// ---------------------------------------------------------------------------
// Typy wejścia
// ---------------------------------------------------------------------------

export type LocalDate = { year: number; month: number; day: number };

export type Interval = { start: Date; end: Date };

export type WorkingHoursRule = {
  weekday: number; // 0 = poniedziałek ... 6 = niedziela
  startMinute: number;
  endMinute: number;
  /** Daty graniczne wersji grafiku (kolumny @db.Date — północ UTC). */
  validFrom?: Date | null;
  validTo?: Date | null;
};

export type OpeningHoursRule = {
  weekday: number;
  startMinute: number;
  endMinute: number;
};

export type ResourceAvailabilityInput = {
  id: string;
  workingHours: WorkingHoursRule[];
  /** Zajęte przedziały grafiku (BookingItem.blockedStartAt/blockedEndAt). */
  busy: Interval[];
  /** Urlopy / blokady tego zasobu. */
  timeOff: Interval[];
  /** Aktywne holdy (checkout innego klienta). */
  holds: Interval[];
  /** Nadpisanie czasu trwania usługi dla tego zasobu (ServiceResource). */
  durationMinOverride?: number | null;
};

export type AvailabilityConfig = {
  timezone: string;
  slotGranularityMin: number;
  minLeadTimeMin: number;
  maxAdvanceDays: number;
};

export type ComputeAvailabilityInput = {
  resources: ResourceAvailabilityInput[];
  /** Godziny otwarcia lokalu. Pusta lista = brak zewnętrznej granicy. */
  openingHours: OpeningHoursRule[];
  /** Blokady na poziomie całej lokalizacji (np. święto). */
  locationTimeOff: Interval[];
  config: AvailabilityConfig;
  /** Zakres dni lokalnych, obustronnie domknięty. */
  dateFrom: LocalDate;
  dateTo: LocalDate;
  /** Czas trwania usługi (bez buforów) — bazowy, per zasób może być nadpisany. */
  serviceDurationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  /** „Teraz" — wstrzykiwane, żeby logika była testowalna. */
  now: Date;
};

// ---------------------------------------------------------------------------
// Typy wyniku
// ---------------------------------------------------------------------------

export type AvailableSlot = {
  resourceId: string;
  /** Czas widoczny dla klienta. */
  startAt: Date;
  endAt: Date;
  /** Czas faktycznie blokowany w grafiku (z buforami). */
  blockedStartAt: Date;
  blockedEndAt: Date;
};

export type MergedSlot = {
  startAt: Date;
  /** Zasoby mogące obsłużyć ten start — wybór następuje przy rezerwacji. */
  resourceIds: string[];
};

export type AvailabilityResult = {
  perResource: { resourceId: string; slots: AvailableSlot[] }[];
  /** Widok „dowolny pracownik": suma zbiorów z deduplikacją po starcie. */
  merged: MergedSlot[];
};

// ---------------------------------------------------------------------------
// Arytmetyka przedziałów (wewnętrznie na milisekundach)
// ---------------------------------------------------------------------------

type Span = { start: number; end: number };

const toSpan = (interval: Interval): Span => ({
  start: interval.start.getTime(),
  end: interval.end.getTime(),
});

/** Sortuje i scala nachodzące/stykające się przedziały. */
function normalizeSpans(spans: Span[]): Span[] {
  const valid = spans
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const span of valid) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/** base − cut. Obie listy mogą być nieposortowane. */
function subtractSpans(base: Span[], cut: Span[]): Span[] {
  const cuts = normalizeSpans(cut);
  let result = normalizeSpans(base);
  for (const c of cuts) {
    const next: Span[] = [];
    for (const span of result) {
      if (c.end <= span.start || c.start >= span.end) {
        next.push(span);
        continue;
      }
      if (c.start > span.start) next.push({ start: span.start, end: c.start });
      if (c.end < span.end) next.push({ start: c.end, end: span.end });
    }
    result = next;
  }
  return result;
}

/** Część wspólna dwóch list przedziałów. */
function intersectSpans(a: Span[], b: Span[]): Span[] {
  const left = normalizeSpans(a);
  const right = normalizeSpans(b);
  const result: Span[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const start = Math.max(left[i].start, right[j].start);
    const end = Math.min(left[i].end, right[j].end);
    if (start < end) result.push({ start, end });
    if (left[i].end < right[j].end) i++;
    else j++;
  }
  return result;
}

const spanContains = (spans: Span[], start: number, end: number): boolean =>
  spans.some((span) => span.start <= start && end <= span.end);

// ---------------------------------------------------------------------------
// Kalendarz lokalny
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** Numer seryjny dnia — porównywalny niezależnie od strefy. */
const dateSerial = (d: LocalDate): number => Date.UTC(d.year, d.month - 1, d.day);

const serialToLocalDate = (serial: number): LocalDate => {
  const date = new Date(serial);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

export const addLocalDays = (d: LocalDate, days: number): LocalDate =>
  serialToLocalDate(dateSerial(d) + days * DAY_MS);

export function enumerateLocalDays(from: LocalDate, to: LocalDate): LocalDate[] {
  const days: LocalDate[] = [];
  for (let serial = dateSerial(from); serial <= dateSerial(to); serial += DAY_MS) {
    days.push(serialToLocalDate(serial));
  }
  return days;
}

/** 0 = poniedziałek ... 6 = niedziela — spójnie z resztą systemu. */
const localWeekday = (d: LocalDate): number =>
  (new Date(dateSerial(d)).getUTCDay() + 6) % 7;

export const isoDateToLocalDate = (iso: string): LocalDate | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const date = { year: +match[1], month: +match[2], day: +match[3] };
  const roundTrip = serialToLocalDate(dateSerial(date));
  // Odrzuca daty w rodzaju 2026-02-31.
  if (
    roundTrip.year !== date.year ||
    roundTrip.month !== date.month ||
    roundTrip.day !== date.day
  ) {
    return null;
  }
  return date;
};

export const localDateToIso = (d: LocalDate): string =>
  `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// Silnik
// ---------------------------------------------------------------------------

/** Grafik obowiązujący danego dnia (wersjonowanie validFrom/validTo). */
function ruleAppliesOnDay(rule: WorkingHoursRule, daySerial: number): boolean {
  if (rule.validFrom && daySerial < rule.validFrom.getTime()) return false;
  if (rule.validTo && daySerial > rule.validTo.getTime()) return false;
  return true;
}

function daySpansFromRules(
  rules: { startMinute: number; endMinute: number }[],
  day: LocalDate,
  timezone: string,
): Span[] {
  return normalizeSpans(
    rules.map((rule) => ({
      start: localDayMinutesToUtc(day, rule.startMinute, timezone).getTime(),
      end: localDayMinutesToUtc(day, rule.endMinute, timezone).getTime(),
    })),
  );
}

export function computeAvailability(
  input: ComputeAvailabilityInput,
): AvailabilityResult {
  const { config, now } = input;
  const granularity = Math.max(5, config.slotGranularityMin);
  const nowMs = now.getTime();
  const earliestStartMs = nowMs + config.minLeadTimeMin * 60_000;

  // Horyzont: ostatni rezerwowalny dzień lokalny.
  const todayLocal = utcToZonedWallClock(now, config.timezone);
  const maxDaySerial =
    dateSerial(todayLocal) + config.maxAdvanceDays * DAY_MS;

  const days = enumerateLocalDays(input.dateFrom, input.dateTo);
  const locationCuts = input.locationTimeOff.map(toSpan);
  const hasOpeningHours = input.openingHours.length > 0;

  const perResource = input.resources.map((resource) => {
    const durationMin = resource.durationMinOverride ?? input.serviceDurationMin;
    const durationMs = durationMin * 60_000;
    const bufferBeforeMs = input.bufferBeforeMin * 60_000;
    const bufferAfterMs = input.bufferAfterMin * 60_000;

    const cuts = [
      ...resource.busy.map(toSpan),
      ...resource.timeOff.map(toSpan),
      ...resource.holds.map(toSpan),
      ...locationCuts,
    ];

    const slots: AvailableSlot[] = [];

    for (const day of days) {
      const daySerial = dateSerial(day);
      if (daySerial > maxDaySerial) continue;

      const weekday = localWeekday(day);
      const workRules = resource.workingHours.filter(
        (rule) => rule.weekday === weekday && ruleAppliesOnDay(rule, daySerial),
      );
      if (workRules.length === 0) continue;

      let workSpans = daySpansFromRules(workRules, day, config.timezone);
      if (hasOpeningHours) {
        const openRules = input.openingHours.filter(
          (rule) => rule.weekday === weekday,
        );
        // Lokal zamknięty w ten dzień tygodnia → brak slotów.
        if (openRules.length === 0) continue;
        workSpans = intersectSpans(
          workSpans,
          daySpansFromRules(openRules, day, config.timezone),
        );
      }
      if (workSpans.length === 0) continue;

      const freeSpans = subtractSpans(workSpans, cuts);
      if (freeSpans.length === 0) continue;

      // Kandydaci na siatce granulacji w czasie ściennym lokalu.
      // Duplikaty instantów (godzina nieistniejąca przy zmianie czasu mapuje
      // się na tę samą chwilę co godzina po przeskoku) — deduplikacja niżej.
      const seenStarts = new Set<number>();
      for (let minute = 0; minute < 24 * 60; minute += granularity) {
        const startAt = localDayMinutesToUtc(day, minute, config.timezone);
        const startMs = startAt.getTime();
        if (seenStarts.has(startMs)) continue;
        seenStarts.add(startMs);

        if (startMs < earliestStartMs) continue;

        const blockedStartMs = startMs - bufferBeforeMs;
        const blockedEndMs = startMs + durationMs + bufferAfterMs;

        // Cały blokowany przedział (z buforami) musi się mieścić w jednym
        // wolnym oknie — bufory realnie zajmują grafik.
        if (!spanContains(freeSpans, blockedStartMs, blockedEndMs)) continue;

        slots.push({
          resourceId: resource.id,
          startAt,
          endAt: new Date(startMs + durationMs),
          blockedStartAt: new Date(blockedStartMs),
          blockedEndAt: new Date(blockedEndMs),
        });
      }
    }

    slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    return { resourceId: resource.id, slots };
  });

  // Widok scalony: deduplikacja po godzinie startu.
  const mergedMap = new Map<number, MergedSlot>();
  for (const { slots } of perResource) {
    for (const slot of slots) {
      const key = slot.startAt.getTime();
      const existing = mergedMap.get(key);
      if (existing) {
        existing.resourceIds.push(slot.resourceId);
      } else {
        mergedMap.set(key, {
          startAt: slot.startAt,
          resourceIds: [slot.resourceId],
        });
      }
    }
  }
  const merged = [...mergedMap.values()].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );

  return { perResource, merged };
}

/**
 * Pomocnik dla ekranu „dowolny pracownik": najbliższy slot z widoku scalonego.
 */
export function firstMergedSlot(result: AvailabilityResult): MergedSlot | null {
  return result.merged[0] ?? null;
}
