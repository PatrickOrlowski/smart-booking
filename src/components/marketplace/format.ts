import { utcToZonedWallClock } from "@/lib/time";

/**
 * Formatowanie prezentacyjne marketplace — wspólne dla server i client
 * components. Czasy zawsze w strefie lokalizacji, nigdy przeglądarki.
 */

export const WEEKDAYS_SHORT = ["pon", "wt", "śr", "czw", "pt", "sob", "ndz"];
export const WEEKDAYS_LONG = [
  "poniedziałek",
  "wtorek",
  "środa",
  "czwartek",
  "piątek",
  "sobota",
  "niedziela",
];

/** Kwoty w groszach → "70 zł" / "70,50 zł" (Intl, pl-PL). */
export function formatPrice(cents: number, currency: string): string {
  const wholeAmount = cents % 100 === 0;
  return new Intl.NumberFormat("pl-PL", {
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
): string {
  switch (priceType) {
    case "FREE":
      return "gratis";
    case "ON_REQUEST":
      return "na zapytanie";
    case "FROM":
      return `od ${formatPrice(priceCents, currency)}`;
    default:
      return formatPrice(priceCents, currency);
  }
}

export const formatDuration = (minutes: number): string => `${minutes} min`;

const pad = (value: number) => String(value).padStart(2, "0");

/** "15:30" w strefie lokalu. */
export function formatTimeInZone(instant: Date, timeZone: string): string {
  const wall = utcToZonedWallClock(instant, timeZone);
  return `${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** "pt 31.07" w strefie lokalu. */
export function formatDayShort(instant: Date, timeZone: string): string {
  const wall = utcToZonedWallClock(instant, timeZone);
  return `${WEEKDAYS_SHORT[wall.weekday]} ${wall.day}.${pad(wall.month)}`;
}

/** "CZWARTEK 30 LIPCA 2026" — nagłówek biletu na ekranie sukcesu. */
export function formatDayFull(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
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
  now: Date = new Date(),
): string {
  const dayDiff =
    (localDaySerial(startAt, timeZone) - localDaySerial(now, timeZone)) /
    (24 * 60 * 60 * 1000);
  const time = formatTimeInZone(startAt, timeZone);
  if (dayDiff === 0) return `dziś ${time}`;
  if (dayDiff === 1) return `jutro ${time}`;
  return `${formatDayShort(startAt, timeZone)}, ${time}`;
}

/** "pt 31.07, 11:00" — pełna etykieta terminu. */
export function formatDateTimeLabel(instant: Date, timeZone: string): string {
  return `${formatDayShort(instant, timeZone)}, ${formatTimeInZone(instant, timeZone)}`;
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
  now: Date = new Date(),
): { label: string; isOpen: boolean } {
  const wall = utcToZonedWallClock(now, timeZone);
  const nowMinutes = wall.hour * 60 + wall.minute;
  const today = openingHours
    .filter((entry) => entry.weekday === wall.weekday)
    .sort((a, b) => a.startMinute - b.startMinute);

  for (const block of today) {
    if (nowMinutes >= block.startMinute && nowMinutes < block.endMinute) {
      return { label: `Otwarte do ${minutesToLabel(block.endMinute)}`, isOpen: true };
    }
    if (nowMinutes < block.startMinute) {
      return {
        label: `Otwiera o ${minutesToLabel(block.startMinute)}`,
        isOpen: false,
      };
    }
  }
  return { label: "Dziś zamknięte", isOpen: false };
}
