import {
  addLocalDays,
  isoDateToLocalDate,
  localDateToIso,
  type LocalDate,
} from "@/lib/availability";
import { localDayMinutesToUtc } from "@/lib/time";

/**
 * Planowanie terminów rezerwacji cyklicznej — czysta logika, zero I/O.
 *
 * Reguła serii („co 4 tygodnie, czwartek 17:00") jest zapisana jako czas
 * ŚCIENNY strefy lokalizacji, a nie jako odstęp w milisekundach. To nie jest
 * detal: między 25.10 a 29.03 Warszawa zmienia offset, więc naiwne dodawanie
 * `4 * 7 * 24 * 60 * 60 * 1000` przesunęłoby całą serię o godzinę i klient
 * dostałby wizytę o 16:00 albo 18:00. Dlatego kolejne terminy liczymy
 * w kalendarzu (dodawanie dni), a dopiero gotowy dzień lokalny + minuta
 * od północy przechodzą przez `localDayMinutesToUtc` z src/lib/time.ts.
 *
 * Wynik jest zawsze instantem UTC — takim, jaki trafia do `Booking.startAt`.
 */

/** Twardy sufit liczby wizyt w jednej serii — chroni przed pętlą na rok wstecz. */
export const MAX_SERIES_OCCURRENCES = 52;

/** Górna granica interwału: co 26 tygodnie to już pół roku. */
export const MAX_SERIES_INTERVAL_WEEKS = 26;

export type PlanSeriesInput = {
  /** Dzień, od którego szukamy pierwszego wystąpienia (włącznie). */
  startDate: LocalDate | string;
  /** 0 = poniedziałek ... 6 = niedziela — czas ścienny lokalizacji. */
  weekday: number;
  /** Minuty od północy czasu lokalnego (np. 17:00 = 1020). */
  startMinute: number;
  /** Co ile tygodni powtarza się wizyta. */
  intervalWeeks: number;
  /** Limit liczby wizyt — albo `endDate`, albo oba naraz. */
  occurrences?: number | null;
  /** Ostatni dopuszczalny dzień serii (włącznie). */
  endDate?: LocalDate | string | null;
  timezone: string;
  /**
   * Horyzont rezerwacji lokalizacji (`Location.maxAdvanceDays`) liczony
   * od `startDate`. Funkcja nie zna „teraz" i sama NIE broni przed serią
   * w przeszłości — to obowiązek wołających (akcje panelu walidują
   * startDate ≥ dziś w strefie lokalizacji). Dzięki temu pozostaje
   * deterministyczna.
   */
  maxAdvanceDays: number;
};

export type PlannedOccurrence = {
  /** Numer wizyty w serii, liczony od 1. */
  index: number;
  /** Dzień lokalny wizyty. */
  date: LocalDate;
  /** Ten sam dzień w postaci "2026-09-10". */
  iso: string;
  /** Instant UTC startu wizyty — wartość do `Booking.startAt`. */
  startAt: Date;
};

/** Nieprawidłowa reguła serii (walidacja wejścia, nie stan bazy). */
export class SeriesPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeriesPlanError";
  }
}

const dateSerial = (d: LocalDate): number =>
  Date.UTC(d.year, d.month - 1, d.day);

/** 0 = poniedziałek ... 6 = niedziela — spójnie z resztą systemu. */
export const localDateWeekday = (d: LocalDate): number =>
  (new Date(dateSerial(d)).getUTCDay() + 6) % 7;

function toLocalDate(
  value: LocalDate | string,
  field: string,
): LocalDate {
  if (typeof value !== "string") {
    const normalized = isoDateToLocalDate(localDateToIso(value));
    if (!normalized) throw new SeriesPlanError(`Nieprawidłowa data (${field})`);
    return normalized;
  }
  const parsed = isoDateToLocalDate(value);
  if (!parsed) throw new SeriesPlanError(`Nieprawidłowa data (${field})`);
  return parsed;
}

/**
 * Lista terminów serii. Pierwsze wystąpienie to pierwszy dzień o zadanym
 * dniu tygodnia w dniu `startDate` albo po nim; kolejne co `intervalWeeks`
 * tygodni. Seria kończy się na tym, co wypadnie pierwsze: liczbie powtórzeń,
 * dacie końca, horyzoncie rezerwacji albo twardym suficie.
 */
export function planSeriesDates(input: PlanSeriesInput): PlannedOccurrence[] {
  const {
    weekday,
    startMinute,
    intervalWeeks,
    occurrences,
    timezone,
    maxAdvanceDays,
  } = input;

  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new SeriesPlanError("Dzień tygodnia musi być w zakresie 0–6");
  }
  if (!Number.isInteger(startMinute) || startMinute < 0 || startMinute > 1439) {
    throw new SeriesPlanError("Godzina startu musi być w zakresie 0–1439 minut");
  }
  if (
    !Number.isInteger(intervalWeeks) ||
    intervalWeeks < 1 ||
    intervalWeeks > MAX_SERIES_INTERVAL_WEEKS
  ) {
    throw new SeriesPlanError(
      `Interwał musi być liczbą tygodni z zakresu 1–${MAX_SERIES_INTERVAL_WEEKS}`,
    );
  }
  if (
    occurrences != null &&
    (!Number.isInteger(occurrences) || occurrences < 1)
  ) {
    throw new SeriesPlanError("Liczba powtórzeń musi być dodatnią liczbą całkowitą");
  }
  if (!Number.isInteger(maxAdvanceDays) || maxAdvanceDays < 0) {
    throw new SeriesPlanError("Horyzont rezerwacji musi być liczbą dni ≥ 0");
  }
  if (!timezone) {
    throw new SeriesPlanError("Brak strefy czasowej lokalizacji");
  }

  const startDate = toLocalDate(input.startDate, "start serii");
  const endDate =
    input.endDate == null ? null : toLocalDate(input.endDate, "koniec serii");

  if (occurrences == null && endDate === null) {
    throw new SeriesPlanError(
      "Podaj liczbę powtórzeń albo datę końca serii",
    );
  }
  if (endDate && dateSerial(endDate) < dateSerial(startDate)) {
    throw new SeriesPlanError("Data końca serii jest wcześniejsza niż start");
  }

  const limit = Math.min(occurrences ?? MAX_SERIES_OCCURRENCES, MAX_SERIES_OCCURRENCES);
  const horizonSerial = dateSerial(addLocalDays(startDate, maxAdvanceDays));
  const endSerial = endDate ? dateSerial(endDate) : null;

  // Pierwsze wystąpienie: przesunięcie do najbliższego pasującego dnia
  // tygodnia (0, gdy startDate już nim jest).
  const offset = (weekday - localDateWeekday(startDate) + 7) % 7;
  let cursor = addLocalDays(startDate, offset);

  const planned: PlannedOccurrence[] = [];
  while (planned.length < limit) {
    const serial = dateSerial(cursor);
    if (endSerial !== null && serial > endSerial) break;
    if (serial > horizonSerial) break;

    planned.push({
      index: planned.length + 1,
      date: cursor,
      iso: localDateToIso(cursor),
      // Klucz całej sprawy: konwersja czasu ściennego na instant robiona
      // osobno dla każdego dnia, więc każda wizyta ma tę samą godzinę
      // lokalną również po zmianie czasu.
      startAt: localDayMinutesToUtc(cursor, startMinute, timezone),
    });

    cursor = addLocalDays(cursor, intervalWeeks * 7);
  }

  return planned;
}
