import type { RestaurantArea } from "@/generated/prisma/enums";
import { utcToZonedWallClock } from "@/lib/time";
import {
  WEEKDAYS_SHORT,
  formatTimeInZone,
} from "@/components/marketplace/format";

/**
 * Słownik i formatowanie warstwy gościa (marketplace) dla restauracji.
 *
 * Panel ma własne etykiety stref w `app/panel/(dashboard)/sale/plan-utils.ts` —
 * są operacyjne („Taras / ogródek"), a gość widzi krótkie nazwy sal, więc
 * słowniki celowo się nie pokrywają.
 */

export const GUEST_AREA_LABELS: Record<RestaurantArea, string> = {
  INDOOR: "Sala",
  OUTDOOR: "Taras",
  BAR: "Bar",
  PRIVATE: "Sala prywatna",
};

export const GUEST_AREA_HINTS: Record<RestaurantArea, string> = {
  INDOOR: "Główna sala restauracji",
  OUTDOOR: "Stoliki na zewnątrz, sezonowo",
  BAR: "Wysokie stoliki przy barze",
  PRIVATE: "Osobne pomieszczenie dla grup",
};

/** Kolejność prezentacji stref — ta sama co w silniku dostępności. */
export const AREA_ORDER: RestaurantArea[] = [
  "INDOOR",
  "OUTDOOR",
  "BAR",
  "PRIVATE",
];

/** Minuty → „1 h 30 min" / „2 h" / „45 min" (czas zajęcia stolika). */
export function turnTimeLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** „2 osoby" / „1 osoba" / „5 osób" — polska odmiana liczebnika. */
export function partySizeLabel(size: number): string {
  if (size === 1) return "1 osoba";
  const mod10 = size % 10;
  const mod100 = size % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${size} osoby`;
  }
  return `${size} osób`;
}

/**
 * Dopełniacz do fraz „dla …", „stolika dla …": „1 osoby" / „4 osób".
 * Mianownik z `partySizeLabel` dałby tam „stolika dla 4 osoby".
 */
export function partySizeGenitive(size: number): string {
  return size === 1 ? "1 osoby" : `${size} osób`;
}

/** Czy lokal jest w tym dniu zamknięty (brak reguł godzin otwarcia). */
export function isClosedOnDay(
  openingHours: { weekday: number }[],
  iso: string,
): boolean {
  const weekday = (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
  return !openingHours.some((entry) => entry.weekday === weekday);
}

const localDaySerial = (instant: Date, timeZone: string): number => {
  const wall = utcToZonedWallClock(instant, timeZone);
  return Date.UTC(wall.year, wall.month - 1, wall.day);
};

/**
 * „dziś", „jutro", „pt 31.07" — nazwa dnia względem „teraz" w strefie lokalu.
 * Używane w etykietach kart i podpowiedzi najbliższego wolnego dnia.
 */
export function relativeDayLabel(
  instant: Date,
  timeZone: string,
  now: Date = new Date(),
): string {
  const dayDiff =
    (localDaySerial(instant, timeZone) - localDaySerial(now, timeZone)) /
    (24 * 60 * 60 * 1000);
  if (dayDiff === 0) return "dziś";
  if (dayDiff === 1) return "jutro";
  const wall = utcToZonedWallClock(instant, timeZone);
  return `${WEEKDAYS_SHORT[wall.weekday]} ${wall.day}.${String(wall.month).padStart(2, "0")}`;
}

/** „Stolik dziś od 18:00" — pastylka restauracji na listingu. */
export function tableSlotLabel(
  startAt: Date,
  timeZone: string,
  now: Date = new Date(),
): string {
  return `Stolik ${relativeDayLabel(startAt, timeZone, now)} od ${formatTimeInZone(startAt, timeZone)}`;
}

/**
 * Pora dnia slotu — nagłówki siatki godzin. Granice są kulinarne, nie
 * kalendarzowe: lunch do 15:00, kolacja od 17:00.
 */
export function mealPeriod(
  instant: Date,
  timeZone: string,
): "Lunch" | "Popołudnie" | "Kolacja" {
  const { hour } = utcToZonedWallClock(instant, timeZone);
  if (hour < 15) return "Lunch";
  if (hour < 17) return "Popołudnie";
  return "Kolacja";
}

export const MEAL_PERIODS = ["Lunch", "Popołudnie", "Kolacja"] as const;

/** Dzień lokalny lokalu jako „YYYY-MM-DD" — klucz dla API dostępności. */
export function localIsoDate(instant: Date, timeZone: string): string {
  const wall = utcToZonedWallClock(instant, timeZone);
  return `${wall.year}-${String(wall.month).padStart(2, "0")}-${String(wall.day).padStart(2, "0")}`;
}

/** Kolejne dni lokalne od dziś — pasek wyboru daty (14 pozycji). */
export function nextLocalDays(
  timeZone: string,
  count: number,
  now: Date = new Date(),
): { iso: string; weekday: string; dayNumber: number; isToday: boolean }[] {
  const wall = utcToZonedWallClock(now, timeZone);
  const startSerial = Date.UTC(wall.year, wall.month - 1, wall.day);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(startSerial + index * 86_400_000);
    return {
      iso: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`,
      weekday: WEEKDAYS_SHORT[(date.getUTCDay() + 6) % 7],
      dayNumber: date.getUTCDate(),
      isToday: index === 0,
    };
  });
}

/**
 * Pierwsza litera wielka. Używane tam, gdzie nazwa dnia zaczyna zdanie —
 * dzięki temu unikamy odmiany po przyimku („na niedziela" / „w środa").
 */
export const capitalizeFirst = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1);

/** „środa, 1 sierpnia" — nagłówek wybranego dnia (data bez strefy, w UTC). */
export function isoDayLabel(iso: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${iso}T12:00:00Z`));
}
