import type { RestaurantArea } from "@/generated/prisma/enums";
import { utcToZonedWallClock } from "@/lib/time";
import {
  DEFAULT_LOCALE,
  INTL_LOCALE,
  createPluralTranslator,
  createTranslator,
  type Locale,
} from "@/i18n";
import {
  formatTimeInZone,
  weekdaysShort,
} from "@/components/marketplace/format";

/**
 * Słownik i formatowanie warstwy gościa (marketplace) dla restauracji.
 *
 * Panel ma własne etykiety stref w `app/panel/(dashboard)/sale/plan-utils.ts` —
 * są operacyjne („Taras / ogródek"), a gość widzi krótkie nazwy sal, więc
 * słowniki celowo się nie pokrywają. Wszystkie funkcje z tekstem przyjmują
 * `locale` (domyślnie "pl").
 */

export function guestAreaLabel(
  area: RestaurantArea,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return createTranslator(locale)(`area.${area}`);
}

export function guestAreaHint(
  area: RestaurantArea,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return createTranslator(locale)(`areaHint.${area}`);
}

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

/** „2 osoby" / „1 osoba" / „5 osób" — odmiana przez Intl.PluralRules. */
export function partySizeLabel(
  size: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return createPluralTranslator(locale)("plural.persons", size);
}

/**
 * Dopełniacz do fraz „dla …", „stolika dla …": „1 osoby" / „4 osób".
 * Mianownik z `partySizeLabel` dałby tam „stolika dla 4 osoby".
 * W EN dopełniacz = mianownik.
 */
export function partySizeGenitive(
  size: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return createPluralTranslator(locale)("plural.personsGenitive", size);
}

/**
 * Komunikat „grupa ponad limit online" składany PO STRONIE KLIENTA z danych
 * odpowiedzi 422 — pole `message` z API jest zawsze polskie, a komunikat ma
 * mówić językiem strony.
 */
export function partyTooLargeMessage(
  max: number,
  phone: string | null,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return createTranslator(locale)("lp.tooLargeMsg", {
    max,
    phone: phone ? `: ${phone}` : "",
  });
}

/** Symetrycznie dla dolnej granicy — grupa mniejsza niż najmniejszy stolik. */
export function partyTooSmallMessage(
  min: number,
  phone: string | null,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return createTranslator(locale)("lp.tooSmallMsg", {
    min,
    phone: phone ? `: ${phone}` : "",
  });
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
  locale: Locale = DEFAULT_LOCALE,
  now: Date = new Date(),
): string {
  const t = createTranslator(locale);
  const dayDiff =
    (localDaySerial(instant, timeZone) - localDaySerial(now, timeZone)) /
    (24 * 60 * 60 * 1000);
  if (dayDiff === 0) return t("common.today");
  if (dayDiff === 1) return t("common.tomorrow");
  const wall = utcToZonedWallClock(instant, timeZone);
  return `${weekdaysShort(locale)[wall.weekday]} ${wall.day}.${String(wall.month).padStart(2, "0")}`;
}

/** „Stolik dziś od 18:00" — pastylka restauracji na listingu. */
export function tableSlotLabel(
  startAt: Date,
  timeZone: string,
  locale: Locale = DEFAULT_LOCALE,
  now: Date = new Date(),
): string {
  return createTranslator(locale)("format.tableSlot", {
    day: relativeDayLabel(startAt, timeZone, locale, now),
    time: formatTimeInZone(startAt, timeZone),
  });
}

/**
 * Pora dnia slotu — klucz logiczny (stały, niezależny od języka).
 * Granice są kulinarne, nie kalendarzowe: lunch do 15:00, kolacja od 17:00.
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

/** Etykieta pory dnia w aktywnym języku. */
export function mealPeriodLabel(
  period: (typeof MEAL_PERIODS)[number],
  locale: Locale = DEFAULT_LOCALE,
): string {
  return createTranslator(locale)(`meal.${period}`);
}

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
  locale: Locale = DEFAULT_LOCALE,
): { iso: string; weekday: string; dayNumber: number; isToday: boolean }[] {
  const wall = utcToZonedWallClock(now, timeZone);
  const startSerial = Date.UTC(wall.year, wall.month - 1, wall.day);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(startSerial + index * 86_400_000);
    return {
      iso: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`,
      weekday: weekdaysShort(locale)[(date.getUTCDay() + 6) % 7],
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
export function isoDayLabel(
  iso: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${iso}T12:00:00Z`));
}
