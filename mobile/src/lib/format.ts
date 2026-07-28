import type { BookingStatus } from "@/api/client";

/**
 * Formatowanie dat, cen i statusów po polsku (DESIGN.md „Zasady"):
 * kwoty przez Intl.NumberFormat("pl-PL"), czasy zawsze w strefie lokalu
 * (`timezone` z API), daty w stylu „czw 30.07, 15:30". Lokalna lista wizyt
 * nie zna strefy — wtedy przyjmujemy Europe/Warsaw (wszystkie lokale
 * w bazie są polskie).
 */

export const DEFAULT_TIMEZONE = "Europe/Warsaw";

/** „70 zł" / „89,50 zł" — grosze z bazy, bez ułamków gdy pełne złote. */
export function formatPrice(cents: number, currency = "PLN"): string {
  const wholeAmount = cents % 100 === 0;
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency,
    minimumFractionDigits: wholeAmount ? 0 : 2,
    maximumFractionDigits: wholeAmount ? 0 : 2,
  }).format(cents / 100);
}

/** „15:30" w strefie lokalu. */
export function formatTime(iso: string, timezone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(new Date(iso));
}

/** „czw 30.07" — dzień tygodnia skrócony bez kropki, bez roku. */
export function formatDayShort(
  iso: string,
  timezone = DEFAULT_TIMEZONE,
): string {
  const date = new Date(iso);
  const weekday = new Intl.DateTimeFormat("pl-PL", {
    weekday: "short",
    timeZone: timezone,
  })
    .format(date)
    .replace(/\.$/, "");
  const day = new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
  }).format(date);
  return `${weekday} ${day}`;
}

/** „czwartek 30 lipca 2026" — nagłówek karty szczegółów. */
export function formatDayFull(
  iso: string,
  timezone = DEFAULT_TIMEZONE,
): string {
  return new Intl.DateTimeFormat("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: timezone,
  }).format(new Date(iso));
}

/** „12.06.2026" — daty minionych wizyt. */
export function formatDateNumeric(
  iso: string,
  timezone = DEFAULT_TIMEZONE,
): string {
  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: timezone,
  }).format(new Date(iso));
}

/** Dzień lokalny YYYY-MM-DD w danej strefie — do liczenia „za ile dni". */
function localDaySerial(date: Date, timezone: string): number {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  })
    .format(date)
    .split("-")
    .map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** „dziś" / „jutro" / „za 3 dni" — po dacie lokalnej lokalu; null gdy w przeszłości. */
export function relativeDayLabel(
  iso: string,
  timezone = DEFAULT_TIMEZONE,
  now: Date = new Date(),
): string | null {
  const diff =
    localDaySerial(new Date(iso), timezone) - localDaySerial(now, timezone);
  if (diff < 0) return null;
  if (diff === 0) return "dziś";
  if (diff === 1) return "jutro";
  return `za ${diff} dni`;
}

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: "Oczekująca",
  CONFIRMED: "Potwierdzona",
  COMPLETED: "Zakończona",
  CANCELLED_BY_CUSTOMER: "Odwołana",
  CANCELLED_BY_BUSINESS: "Odwołana przez lokal",
  NO_SHOW: "Nieodbyta",
};

export function isCancelledStatus(status: BookingStatus): boolean {
  return (
    status === "CANCELLED_BY_CUSTOMER" || status === "CANCELLED_BY_BUSINESS"
  );
}
