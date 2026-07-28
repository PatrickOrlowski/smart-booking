import type { PriceType } from "@/api/client";
import { formatPrice } from "@/lib/format";

/**
 * Pomocnicze przeliczenia czasu i etykiety specyficzne dla flow rezerwacji.
 * Ogólne formatowanie (ceny, daty prezentacyjne) żyje w @/lib/format —
 * tutaj tylko to, czego potrzebują kroki flow: dni lokalne lokalu,
 * grupowanie slotów po porze dnia i licznik blokady.
 */

export const WEEKDAYS_SHORT = [
  "pon",
  "wt",
  "śr",
  "czw",
  "pt",
  "sob",
  "ndz",
] as const;

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Instant UTC → data i godzina ścienna w strefie lokalu (Intl, bez
 * zewnętrznych bibliotek — ten sam algorytm co src/lib/time.ts webu).
 */
export function wallClockInZone(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour % 24,
    minute: values.minute,
  };
}

export type FlowDay = {
  /** YYYY-MM-DD — dokładnie ten format przyjmuje parametr `date` availability. */
  iso: string;
  /** „dziś" dla pierwszego dnia, potem „czw", „pt"… */
  weekdayLabel: string;
  dayNumber: number;
  isToday: boolean;
};

/** 14 kolejnych dni lokalnych lokalu — pasek wyboru dnia (krok „termin"). */
export function buildFlowDays(timezone: string, count = 14): FlowDay[] {
  const wall = wallClockInZone(new Date(), timezone);
  const startSerial = Date.UTC(wall.year, wall.month - 1, wall.day);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(startSerial + index * 86_400_000);
    return {
      iso: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
      weekdayLabel:
        index === 0 ? "dziś" : WEEKDAYS_SHORT[(date.getUTCDay() + 6) % 7],
      dayNumber: date.getUTCDate(),
      isToday: index === 0,
    };
  });
}

/** „CZWARTEK 30 LIPCA" — nagłówek dnia nad siatką slotów (dzień YYYY-MM-DD). */
export function flowDayHeading(iso: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  })
    .format(new Date(`${iso}T12:00:00Z`))
    .toUpperCase();
}

/** „czw 30.07" dla dnia YYYY-MM-DD (bez konwersji stref — dzień jest lokalny). */
export function flowDayShort(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  return `${WEEKDAYS_SHORT[(date.getUTCDay() + 6) % 7]} ${date.getUTCDate()}.${pad(date.getUTCMonth() + 1)}`;
}

export type SlotGroup<T> = { label: string; slots: T[] };

/** Sloty dnia → grupy Rano (<12) / Po południu (<17) / Wieczorem. */
export function groupSlotsByDaypart<T extends { startAt: string }>(
  slots: T[],
  timezone: string,
): SlotGroup<T>[] {
  const rano: T[] = [];
  const popoludniu: T[] = [];
  const wieczorem: T[] = [];
  for (const slot of slots) {
    const hour = wallClockInZone(new Date(slot.startAt), timezone).hour;
    if (hour < 12) rano.push(slot);
    else if (hour < 17) popoludniu.push(slot);
    else wieczorem.push(slot);
  }
  return [
    { label: "Rano", slots: rano },
    { label: "Po południu", slots: popoludniu },
    { label: "Wieczorem", slots: wieczorem },
  ].filter((group) => group.slots.length > 0);
}

/** ms → „09:58" — licznik ważności blokady (DM Mono). */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}`;
}

/** Etykieta ceny wg trybu: stała / „od" / gratis / na zapytanie. */
export function priceLabel(
  priceCents: number,
  priceType: PriceType,
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

/** „6 terminów" / „1 termin" / „3 terminy" — polska liczba mnoga. */
export function slotCountLabel(count: number): string {
  if (count === 1) return "1 termin";
  const lastTwo = count % 100;
  const last = count % 10;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) {
    return `${count} terminy`;
  }
  return `${count} terminów`;
}
