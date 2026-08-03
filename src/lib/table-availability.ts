import type { RestaurantArea } from "@/generated/prisma/enums";
import type { LocalDate, OpeningHoursRule } from "@/lib/availability";
import { localDayMinutesToUtc, utcToZonedWallClock } from "@/lib/time";

/**
 * Silnik dostępności stolików — czysta logika, zero I/O.
 *
 * Rezerwacja stolika różni się od wizyty w salonie trzema rzeczami:
 *  1. czas trwania wynika z liczby osób (TurnTimeRule), nie z usługi,
 *  2. zasób dobieramy sami — najmniejszy pasujący stolik, a gdy żaden nie
 *     jest wolny, zestawienie stolików (wtedy rezerwacja zajmuje KAŻDY
 *     stolik członkowski),
 *  3. poza zajętością obowiązuje pacing: ile osób kuchnia przyjmuje
 *     w danym kwadransie.
 *
 * Godziny otwarcia i okna pacingu są w minutach czasu ściennego lokalu —
 * wszystkie konwersje idą przez src/lib/time.ts, więc doby 23- i 25-godzinne
 * (DST) wychodzą poprawnie. Wynik jest zawsze w UTC.
 */

// ---------------------------------------------------------------------------
// Typy wejścia
// ---------------------------------------------------------------------------

/** Stolik — Resource typu TABLE sprowadzony do pól potrzebnych silnikowi. */
export type TableInput = {
  id: string;
  /** Numer widoczny dla obsługi („12", „T3") — do etykiety slotu. */
  tableNumber: string | null;
  roomId: string | null;
  area: RestaurantArea | null;
  capacityMin: number;
  capacityMax: number;
  sortOrder: number;
  isActive: boolean;
};

/** Zestawienie stolików: rezerwacja zajmuje wszystkie stoliki członkowskie. */
export type TableCombinationInput = {
  id: string;
  name: string;
  capacityMin: number;
  capacityMax: number;
  isActive: boolean;
  tableIds: string[];
};

export type TurnTimeRuleInput = {
  partySizeMin: number;
  partySizeMax: number;
  durationMin: number;
};

export type PacingRuleInput = {
  /** null = reguła obowiązuje codziennie. */
  weekday: number | null;
  startMinute: number;
  endMinute: number;
  intervalMin: number;
  maxCovers: number | null;
  maxBookings: number | null;
};

/**
 * Pozycja istniejącej rezerwacji (BookingItem). `blockedStartAt/blockedEndAt`
 * zawierają już bufor sprzątania, `startAt` jest czasem widocznym dla gościa —
 * po nim liczymy pacing. `bookingId` pozwala nie policzyć dwa razy rezerwacji
 * rozłożonej na zestawienie stolików.
 */
export type ExistingTableItem = {
  bookingId: string;
  tableId: string;
  startAt: Date;
  blockedStartAt: Date;
  blockedEndAt: Date;
  partySize: number | null;
};

/** Blokada slotu na czas checkoutu. Nieaktywne (expiresAt <= now) pomijamy. */
export type TableHoldInput = {
  tableId: string;
  startAt: Date;
  endAt: Date;
  expiresAt: Date;
};

/** Urlop/blokada. tableId = null oznacza blokadę całej lokalizacji. */
export type TableTimeOffInput = {
  tableId: string | null;
  startAt: Date;
  endAt: Date;
};

/** Zawężenie do konkretnego stolika/zestawienia — rewalidacja przy rezerwacji. */
export type TableSelectionRequest = {
  tableIds?: string[];
  combinationId?: string;
};

export type ComputeTableAvailabilityInput = {
  openingHours: OpeningHoursRule[];
  tables: TableInput[];
  combinations: TableCombinationInput[];
  existingItems: ExistingTableItem[];
  holds: TableHoldInput[];
  timeOffs: TableTimeOffInput[];
  pacingRules: PacingRuleInput[];
  turnTimeRules: TurnTimeRuleInput[];
  defaultTurnTimeMin: number;
  tableBufferMin: number;
  slotGranularityMin: number;
  minLeadTimeMin: number;
  maxAdvanceDays: number;
  /** Dzień lokalny lokalu. */
  day: LocalDate;
  timezone: string;
  partySize: number;
  /** Filtr strefy — gość chce taras albo bar. */
  areaPreference?: RestaurantArea | null;
  /** Rewalidacja: licz tylko wskazany stolik/zestawienie. */
  restrictTo?: TableSelectionRequest | null;
  /** „Teraz" — wstrzykiwane, żeby logika była testowalna. */
  now: Date;
};

// ---------------------------------------------------------------------------
// Typy wyniku
// ---------------------------------------------------------------------------

export type TableSlot = {
  startAt: Date;
  endAt: Date;
  /** Czas faktycznie blokowany w grafiku = endAt + bufor sprzątania. */
  blockedStartAt: Date;
  blockedEndAt: Date;
  durationMin: number;
  /** Stoliki do zajęcia — jeden element albo cały skład zestawienia. */
  tableIds: string[];
  tableNumbers: string[];
  combinationId?: string;
  area: RestaurantArea | null;
  /** Gotowa etykieta dla obsługi: „Stolik 4" albo „Stoliki 1+2". */
  label: string;
};

export type TableAvailabilityResult = {
  /** Czas zajęcia stolika dla tej liczby osób (TurnTimeRule). */
  durationMin: number;
  slots: TableSlot[];
};

// ---------------------------------------------------------------------------
// Arytmetyka przedziałów
// ---------------------------------------------------------------------------

type Span = { start: number; end: number };

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Sortuje i scala nachodzące/stykające się przedziały. */
function mergeSpans(spans: Span[]): Span[] {
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

const spanContains = (spans: Span[], start: number, end: number): boolean =>
  spans.some((span) => span.start <= start && end <= span.end);

const overlapsAny = (spans: Span[], start: number, end: number): boolean =>
  spans.some((span) => span.start < end && span.end > start);

const dateSerial = (day: LocalDate): number =>
  Date.UTC(day.year, day.month - 1, day.day);

/** 0 = poniedziałek ... 6 = niedziela — spójnie z resztą systemu. */
const localWeekday = (day: LocalDate): number =>
  (new Date(dateSerial(day)).getUTCDay() + 6) % 7;

// ---------------------------------------------------------------------------
// Turn time
// ---------------------------------------------------------------------------

/**
 * Czas zajęcia stolika dla danej liczby osób: pierwsza pasująca reguła
 * (zakresy nie powinny się nakładać), a gdy żadna nie pasuje — wartość
 * domyślna lokalizacji.
 *
 * Wyjątek: grupa WIĘKSZA niż najwyższa reguła dostaje regułę o największym
 * `partySizeMax`, nie wartość domyślną. Przy regułach 1–2:90, 3–4:120,
 * 5–8:150 dziewięcioosobowa grupa dostawała wcześniej 90 minut, czyli KRÓTSZY
 * czas niż czwórka — stolik szedł do kolejnego gościa, zanim ta wstała od stołu.
 */
export function turnTimeForPartySize(
  rules: TurnTimeRuleInput[],
  partySize: number,
  defaultTurnTimeMin: number,
): number {
  const rule = rules.find(
    (r) => partySize >= r.partySizeMin && partySize <= r.partySizeMax,
  );
  if (rule) return rule.durationMin;

  const highest = rules.reduce<TurnTimeRuleInput | null>(
    (best, candidate) =>
      best === null || candidate.partySizeMax > best.partySizeMax
        ? candidate
        : best,
    null,
  );
  if (highest && partySize > highest.partySizeMax) return highest.durationMin;
  return defaultTurnTimeMin;
}

// ---------------------------------------------------------------------------
// Kandydaci: stoliki i zestawienia
// ---------------------------------------------------------------------------

type TableOption = {
  tableIds: string[];
  tableNumbers: string[];
  combinationId?: string;
  area: RestaurantArea | null;
  label: string;
  capacityMin: number;
  capacityMax: number;
  sortOrder: number;
  memberCount: number;
};

const tableLabel = (table: TableInput): string =>
  table.tableNumber ? `Stolik ${table.tableNumber}` : "Stolik";

/**
 * Lista kandydatów w kolejności preferencji.
 *
 * Zasady doboru:
 *  - pojemność musi obejmować liczbę osób (capacityMin <= n <= capacityMax),
 *    czyli pary nie sadzamy przy stole na osiem osób,
 *  - wygrywa najmniejszy pasujący stolik, przy równej pojemności mniejszy
 *    sortOrder,
 *  - POJEDYNCZY STOLIK ZAWSZE PRZED ZESTAWIENIEM — zestawianie stolików
 *    kosztuje obsługę pracy, więc sięgamy po nie dopiero, gdy w danej
 *    godzinie nie ma wolnego pojedynczego stolika o odpowiedniej pojemności,
 *  - areaPreference (taras/sala/bar) filtruje kandydatów; zestawienie musi
 *    mieć wszystkie stoliki w wybranej strefie.
 */
function buildOptions(input: ComputeTableAvailabilityInput): TableOption[] {
  const { partySize, areaPreference } = input;
  const fitsArea = (table: TableInput) =>
    !areaPreference || table.area === areaPreference;

  const singles: TableOption[] = input.tables
    .filter(
      (table) =>
        table.isActive &&
        table.capacityMin <= partySize &&
        partySize <= table.capacityMax &&
        fitsArea(table),
    )
    .map((table) => ({
      tableIds: [table.id],
      tableNumbers: table.tableNumber ? [table.tableNumber] : [],
      area: table.area,
      label: tableLabel(table),
      capacityMin: table.capacityMin,
      capacityMax: table.capacityMax,
      sortOrder: table.sortOrder,
      memberCount: 1,
    }));

  const tableById = new Map(input.tables.map((table) => [table.id, table]));

  const combos: TableOption[] = [];
  for (const combination of input.combinations) {
    if (!combination.isActive) continue;
    if (
      combination.capacityMin > partySize ||
      partySize > combination.capacityMax
    ) {
      continue;
    }
    const members = combination.tableIds.map((id) => tableById.get(id));
    if (members.some((member) => !member || !member.isActive)) continue;
    const active = members.filter((m): m is TableInput => m !== undefined);
    if (active.length === 0 || !active.every(fitsArea)) continue;

    combos.push({
      tableIds: active.map((member) => member.id),
      tableNumbers: active
        .map((member) => member.tableNumber)
        .filter((number): number is string => number !== null),
      combinationId: combination.id,
      area: active[0].area,
      label: `Stoliki ${combination.name}`,
      capacityMin: combination.capacityMin,
      capacityMax: combination.capacityMax,
      sortOrder: Math.min(...active.map((member) => member.sortOrder)),
      memberCount: active.length,
    });
  }

  // Najlepsze dopasowanie: najpierw najmniej zmarnowanych miejsc
  // (capacityMax), potem stolik o najciaśniejszym zakresie (wyższe
  // capacityMin) — elastyczny stolik „2–4" zostaje wolny dla pary,
  // a czwórka siada przy stole na dokładnie cztery osoby.
  const byCapacity = (a: TableOption, b: TableOption) =>
    a.capacityMax - b.capacityMax ||
    b.capacityMin - a.capacityMin ||
    a.memberCount - b.memberCount ||
    a.sortOrder - b.sortOrder ||
    a.label.localeCompare(b.label, "pl");

  singles.sort(byCapacity);
  combos.sort(byCapacity);

  const options = [...singles, ...combos];
  const wanted = input.restrictTo;
  if (!wanted) return options;

  // Oba zawężenia obowiązują JEDNOCZEŚNIE. Wcześniej `combinationId` wygrywał
  // i po cichu unieważniał `tableIds`, więc rezerwacja lądowała na stolikach
  // zestawienia, a nie na tych, o które prosił klient.
  let filtered = options;
  if (wanted.combinationId) {
    filtered = filtered.filter(
      (option) => option.combinationId === wanted.combinationId,
    );
  }
  if (wanted.tableIds && wanted.tableIds.length > 0) {
    const requested = [...wanted.tableIds].sort().join("|");
    filtered = filtered.filter(
      (option) => [...option.tableIds].sort().join("|") === requested,
    );
  }
  return filtered;
}

// ---------------------------------------------------------------------------
// Silnik
// ---------------------------------------------------------------------------

export function computeTableAvailability(
  input: ComputeTableAvailabilityInput,
): TableAvailabilityResult {
  const durationMin = turnTimeForPartySize(
    input.turnTimeRules,
    input.partySize,
    input.defaultTurnTimeMin,
  );
  const empty: TableAvailabilityResult = { durationMin, slots: [] };
  if (input.partySize < 1 || durationMin <= 0) return empty;

  const { timezone, day } = input;
  const nowMs = input.now.getTime();
  const earliestStartMs = nowMs + input.minLeadTimeMin * MINUTE_MS;

  // Horyzont rezerwacji liczony w dniach lokalnych lokalu.
  const todayWall = utcToZonedWallClock(input.now, timezone);
  const maxDaySerial =
    dateSerial(todayWall) + input.maxAdvanceDays * DAY_MS;
  if (dateSerial(day) > maxDaySerial) return empty;

  // Godziny otwarcia — rezerwacja musi się w nich zmieścić w CAŁOŚCI.
  const weekday = localWeekday(day);
  const openRules = input.openingHours.filter(
    (rule) => rule.weekday === weekday,
  );
  if (openRules.length === 0) return empty;

  // Instanty minut ściennych liczymy raz (Intl nie jest darmowy) — z tej
  // samej mapy korzystają siatka slotów, godziny otwarcia i okna pacingu.
  const instantCache = new Map<number, number>();
  const minuteToMs = (minute: number): number => {
    const cached = instantCache.get(minute);
    if (cached !== undefined) return cached;
    const value = localDayMinutesToUtc(day, minute, timezone).getTime();
    instantCache.set(minute, value);
    return value;
  };

  const openSpans = mergeSpans(
    openRules.map((rule) => ({
      start: minuteToMs(rule.startMinute),
      end: minuteToMs(rule.endMinute),
    })),
  );
  if (openSpans.length === 0) return empty;

  // Zajętość per stolik: pozycje rezerwacji (mają już bufor), aktywne holdy
  // i urlopy zasobu. Blokady całej lokalizacji trzymamy osobno.
  const busyByTable = new Map<string, Span[]>();
  const addBusy = (tableId: string, start: Date, end: Date) => {
    const spans = busyByTable.get(tableId);
    const span = { start: start.getTime(), end: end.getTime() };
    if (spans) spans.push(span);
    else busyByTable.set(tableId, [span]);
  };

  for (const item of input.existingItems) {
    addBusy(item.tableId, item.blockedStartAt, item.blockedEndAt);
  }
  for (const hold of input.holds) {
    if (hold.expiresAt.getTime() <= nowMs) continue;
    addBusy(hold.tableId, hold.startAt, hold.endAt);
  }
  const locationBusy: Span[] = [];
  for (const off of input.timeOffs) {
    if (off.tableId) addBusy(off.tableId, off.startAt, off.endAt);
    else
      locationBusy.push({
        start: off.startAt.getTime(),
        end: off.endAt.getTime(),
      });
  }

  const options = buildOptions(input);
  if (options.length === 0) return empty;

  // Pacing liczymy po REZERWACJACH, nie po pozycjach: zestawienie stolików
  // to jedna rezerwacja na kilku stolikach i jedno obłożenie kuchni.
  const bookingStarts = new Map<string, { startMs: number; covers: number }>();
  for (const item of input.existingItems) {
    if (bookingStarts.has(item.bookingId)) continue;
    bookingStarts.set(item.bookingId, {
      startMs: item.startAt.getTime(),
      // Rezerwacja bez partySize (import, wizyta salonowa na tym samym
      // zasobie) to co najmniej jeden gość — pacing woli przeszacować.
      covers: item.partySize ?? 1,
    });
  }
  const startedBookings = [...bookingStarts.values()];

  const pacingRules = input.pacingRules.filter(
    (rule) => rule.weekday === null || rule.weekday === weekday,
  );

  /**
   * Czy do przedziału pacingu zmieści się jeszcze ta rezerwacja?
   * Obowiązują WSZYSTKIE pasujące reguły, więc w praktyce wygrywa
   * najostrzejsza — reguła codzienna (weekday = null) i reguła dnia
   * tygodnia obcinają się nawzajem.
   */
  const pacingAllows = (slotMinute: number): boolean => {
    for (const rule of pacingRules) {
      if (slotMinute < rule.startMinute || slotMinute >= rule.endMinute) {
        continue;
      }
      if (rule.maxCovers === null && rule.maxBookings === null) continue;

      const interval = Math.max(1, rule.intervalMin);
      const offset = Math.floor((slotMinute - rule.startMinute) / interval);
      const bucketStartMs = minuteToMs(rule.startMinute + offset * interval);
      const bucketEndMs = minuteToMs(
        rule.startMinute + (offset + 1) * interval,
      );

      let covers = 0;
      let bookings = 0;
      for (const booking of startedBookings) {
        if (booking.startMs < bucketStartMs || booking.startMs >= bucketEndMs) {
          continue;
        }
        covers += booking.covers;
        bookings += 1;
      }

      if (rule.maxCovers !== null && covers + input.partySize > rule.maxCovers) {
        return false;
      }
      if (rule.maxBookings !== null && bookings + 1 > rule.maxBookings) {
        return false;
      }
    }
    return true;
  };

  const granularity = Math.max(5, input.slotGranularityMin);
  const durationMs = durationMin * MINUTE_MS;
  const bufferMs = Math.max(0, input.tableBufferMin) * MINUTE_MS;

  const slots: TableSlot[] = [];
  // Siatka startów w czasie ściennym. Przy zmianie czasu dwie różne godziny
  // ścienne mapują się na ten sam instant — deduplikacja po instancie.
  const seenStarts = new Set<number>();

  for (let minute = 0; minute < 24 * 60; minute += granularity) {
    const startMs = minuteToMs(minute);
    if (seenStarts.has(startMs)) continue;
    seenStarts.add(startMs);

    if (startMs < earliestStartMs) continue;

    const endMs = startMs + durationMs;
    // Cała rezerwacja musi się zmieścić do zamknięcia; bufor sprzątania
    // może wyjść poza godziny otwarcia — sprząta obsługa, nie gość.
    if (!spanContains(openSpans, startMs, endMs)) continue;

    const blockedEndMs = endMs + bufferMs;
    if (overlapsAny(locationBusy, startMs, blockedEndMs)) continue;
    if (!pacingAllows(minute)) continue;

    const option = options.find((candidate) =>
      candidate.tableIds.every(
        (tableId) =>
          !overlapsAny(busyByTable.get(tableId) ?? [], startMs, blockedEndMs),
      ),
    );
    if (!option) continue;

    slots.push({
      startAt: new Date(startMs),
      endAt: new Date(endMs),
      blockedStartAt: new Date(startMs),
      blockedEndAt: new Date(blockedEndMs),
      durationMin,
      tableIds: option.tableIds,
      tableNumbers: option.tableNumbers,
      ...(option.combinationId ? { combinationId: option.combinationId } : {}),
      area: option.area,
      label: option.label,
    });
  }

  slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return { durationMin, slots };
}

/**
 * Slot o dokładnie tym starcie — rewalidacja przy zapisie rezerwacji.
 * Zawężenie do konkretnego stolika/zestawienia idzie przez `restrictTo`.
 */
export function findTableSlotAt(
  input: ComputeTableAvailabilityInput,
  startAt: Date,
): TableSlot | null {
  const { slots } = computeTableAvailability(input);
  const target = startAt.getTime();
  return slots.find((slot) => slot.startAt.getTime() === target) ?? null;
}
