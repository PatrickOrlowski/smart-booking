import { utcToZonedWallClock } from "@/lib/time";
import {
  DEFAULT_LOCALE,
  INTL_LOCALE,
  createTranslator,
  type Locale,
} from "@/i18n";

/**
 * Formatowanie prezentacyjne marketplace — wspólne dla server i client
 * components. Czasy zawsze w strefie lokalizacji, nigdy przeglądarki.
 *
 * Wszystkie funkcje z tekstem/nazwami dni przyjmują `locale` (domyślnie
 * "pl", więc panel firmy — który zostaje po polsku — może ich używać bez
 * zmian). Waluta idzie ZAWSZE z danych firmy (Business.currency), locale
 * decyduje tylko o zapisie kwoty.
 */

const WEEKDAYS_SHORT_BY_LOCALE: Record<Locale, string[]> = {
  pl: ["pon", "wt", "śr", "czw", "pt", "sob", "ndz"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};

const WEEKDAYS_LONG_BY_LOCALE: Record<Locale, string[]> = {
  pl: [
    "poniedziałek",
    "wtorek",
    "środa",
    "czwartek",
    "piątek",
    "sobota",
    "niedziela",
  ],
  en: [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ],
};

/** Zgodność wsteczna (panel/pracownik zostają po polsku). */
export const WEEKDAYS_SHORT = WEEKDAYS_SHORT_BY_LOCALE.pl;
export const WEEKDAYS_LONG = WEEKDAYS_LONG_BY_LOCALE.pl;

export const weekdaysShort = (locale: Locale): string[] =>
  WEEKDAYS_SHORT_BY_LOCALE[locale];
export const weekdaysLong = (locale: Locale): string[] =>
  WEEKDAYS_LONG_BY_LOCALE[locale];

/** Kwoty w groszach → "70 zł" / "PLN 70.50" (Intl, waluta z danych firmy). */
export function formatPrice(
  cents: number,
  currency: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const wholeAmount = cents % 100 === 0;
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: "currency",
    currency,
    minimumFractionDigits: wholeAmount ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Etykieta ceny wg trybu: stała / „od" / gratis / na zapytanie. */
export function priceLabel(
  priceCents: number,
  priceType: string,
  currency: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const t = createTranslator(locale);
  switch (priceType) {
    case "FREE":
      return t("format.priceFree");
    case "ON_REQUEST":
      return t("format.priceOnRequest");
    case "FROM":
      return t("format.priceFrom", {
        price: formatPrice(priceCents, currency, locale),
      });
    default:
      return formatPrice(priceCents, currency, locale);
  }
}

export const formatDuration = (minutes: number): string => `${minutes} min`;

const pad = (value: number) => String(value).padStart(2, "0");

/** "15:30" w strefie lokalu (24 h w obu językach — konwencja europejska). */
export function formatTimeInZone(instant: Date, timeZone: string): string {
  const wall = utcToZonedWallClock(instant, timeZone);
  return `${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** "pt 31.07" / "Fri 31.07" w strefie lokalu. */
export function formatDayShort(
  instant: Date,
  timeZone: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const wall = utcToZonedWallClock(instant, timeZone);
  return `${weekdaysShort(locale)[wall.weekday]} ${wall.day}.${pad(wall.month)}`;
}

/** "CZWARTEK 30 LIPCA 2026" / "THURSDAY 30 JULY 2026" — nagłówek biletu. */
export function formatDayFull(
  instant: Date,
  timeZone: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
    .format(instant)
    .toUpperCase();
}

const localDaySerial = (instant: Date, timeZone: string): number => {
  const wall = utcToZonedWallClock(instant, timeZone);
  return Date.UTC(wall.year, wall.month - 1, wall.day);
};

/**
 * "dziś 15:30" / "jutro 11:00" / "pt 31.07, 11:00" — pastylka najbliższego
 * wolnego terminu.
 */
export function nearestSlotLabel(
  startAt: Date,
  timeZone: string,
  locale: Locale = DEFAULT_LOCALE,
  now: Date = new Date(),
): string {
  const t = createTranslator(locale);
  const dayDiff =
    (localDaySerial(startAt, timeZone) - localDaySerial(now, timeZone)) /
    (24 * 60 * 60 * 1000);
  const time = formatTimeInZone(startAt, timeZone);
  if (dayDiff === 0) return `${t("common.today")} ${time}`;
  if (dayDiff === 1) return `${t("common.tomorrow")} ${time}`;
  return `${formatDayShort(startAt, timeZone, locale)}, ${time}`;
}

/** "pt 31.07, 11:00" — pełna etykieta terminu. */
export function formatDateTimeLabel(
  instant: Date,
  timeZone: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return `${formatDayShort(instant, timeZone, locale)}, ${formatTimeInZone(instant, timeZone)}`;
}

/** Minuty od północy → "9:00". */
export function minutesToLabel(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
}

/**
 * Status otwarcia lokalu teraz: "Otwarte do 19:00" / "Dziś zamknięte" /
 * "Otwiera o 9:00".
 */
export function openStatus(
  openingHours: { weekday: number; startMinute: number; endMinute: number }[],
  timeZone: string,
  locale: Locale = DEFAULT_LOCALE,
  now: Date = new Date(),
): { label: string; isOpen: boolean } {
  const t = createTranslator(locale);
  const wall = utcToZonedWallClock(now, timeZone);
  const nowMinutes = wall.hour * 60 + wall.minute;
  const today = openingHours
    .filter((entry) => entry.weekday === wall.weekday)
    .sort((a, b) => a.startMinute - b.startMinute);

  for (const block of today) {
    if (nowMinutes >= block.startMinute && nowMinutes < block.endMinute) {
      return {
        label: t("format.openUntil", { time: minutesToLabel(block.endMinute) }),
        isOpen: true,
      };
    }
    if (nowMinutes < block.startMinute) {
      return {
        label: t("format.opensAt", { time: minutesToLabel(block.startMinute) }),
        isOpen: false,
      };
    }
  }
  return { label: t("format.closedToday"), isOpen: false };
}
