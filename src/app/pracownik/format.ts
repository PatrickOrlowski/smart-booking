/**
 * Pomocnicze formatowanie dla panelu pracownika: kwoty, liczebniki,
 * klucze dat i arytmetyka na dacie kalendarzowej (bez stref — strefy
 * obsługuje src/lib/time.ts).
 */

export type CalendarDay = { year: number; month: number; day: number };

const pad = (value: number) => String(value).padStart(2, "0");

/** Kwota w groszach → "90 zł" / "90,50 zł" (Intl, pl-PL). */
export function formatPrice(cents: number, currency: string): string {
  const fractionDigits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(cents / 100);
}

/** Polska liczba mnoga: 1 wizyta, 2 wizyty, 5 wizyt. */
export function pluralPl(
  count: number,
  one: string,
  few: string,
  many: string,
): string {
  if (count === 1) return `${count} ${one}`;
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} ${few}`;
  }
  return `${count} ${many}`;
}

/** "HH:MM" z zegara ściennego. */
export function formatWallTime(wall: { hour: number; minute: number }): string {
  return `${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** Dzień kalendarzowy → "YYYY-MM-DD" (klucz searchParam ?data=). */
export function dayKey(day: CalendarDay): string {
  return `${day.year}-${pad(day.month)}-${pad(day.day)}`;
}

/** "YYYY-MM-DD" → dzień kalendarzowy albo null, gdy niepoprawny. */
export function parseDayKey(raw: string | undefined): CalendarDay | null {
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const day = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  // Odrzuca daty w rodzaju 2026-02-31 — Date.UTC by je "przekręcił".
  const roundTrip = new Date(Date.UTC(day.year, day.month - 1, day.day));
  if (
    roundTrip.getUTCFullYear() !== day.year ||
    roundTrip.getUTCMonth() + 1 !== day.month ||
    roundTrip.getUTCDate() !== day.day
  ) {
    return null;
  }
  return day;
}

/** Przesunięcie dnia kalendarzowego o `delta` dni (normalizacja przez UTC). */
export function shiftDay(day: CalendarDay, delta: number): CalendarDay {
  const shifted = new Date(Date.UTC(day.year, day.month - 1, day.day + delta));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Dzień tygodnia dnia kalendarzowego: 0 = poniedziałek … 6 = niedziela. */
export function calendarWeekday(day: CalendarDay): number {
  const date = new Date(Date.UTC(day.year, day.month - 1, day.day));
  return (date.getUTCDay() + 6) % 7;
}
