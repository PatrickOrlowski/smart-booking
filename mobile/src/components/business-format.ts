import type { BusinessType } from "@/api/client";
import { wallClockInZone } from "@/components/booking-format";

/**
 * Formatowanie specyficzne dla przeglądania firm (lista + profil):
 * etykiety typów, polskie liczebniki wyników/opinii i status otwarcia
 * liczony w strefie lokalu (weekday 0 = poniedziałek — konwencja bazy).
 * Ogólne formatowanie cen/dat żyje w @/lib/format.
 */

/** Etykiety typów firm — spójne z webem (src/app/k/kategorie.ts). */
export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  BARBER: "Barber",
  HAIR_SALON: "Fryzjer",
  BEAUTY: "Uroda",
  NAILS: "Paznokcie",
  SPA: "SPA",
  TATTOO: "Tatuaż",
  FITNESS: "Fitness",
  AUTO_SERVICE: "Moto",
  MEDICAL: "Zdrowie",
  RESTAURANT: "Restauracja",
  OTHER: "Inne",
};

export const WEEKDAYS_LONG = [
  "poniedziałek",
  "wtorek",
  "środa",
  "czwartek",
  "piątek",
  "sobota",
  "niedziela",
] as const;

/** „4,9" — średnia ocena z przecinkiem (DM Mono w UI). */
export function ratingValueLabel(average: number): string {
  return average.toFixed(1).replace(".", ",");
}

function pluralPl(count: number, one: string, few: string, many: string) {
  if (count === 1) return one;
  const lastTwo = count % 100;
  const last = count % 10;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
}

/** „1 wynik" / „24 wyniki" / „12 wyników". */
export function resultsCountLabel(count: number): string {
  return `${count} ${pluralPl(count, "wynik", "wyniki", "wyników")}`;
}

/** „1 opinia" / „3 opinie" / „312 opinii". */
export function reviewsCountLabel(count: number): string {
  return `${count} ${pluralPl(count, "opinia", "opinie", "opinii")}`;
}

/** Minuty od północy → „9:00" (godziny otwarcia). */
export function minutesToLabel(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

export type OpeningBlock = {
  weekday: number;
  startMinute: number;
  endMinute: number;
};

/** Dzień tygodnia (0 = pon) i minuty od północy „teraz" w strefie lokalu. */
export function zonedWeekdayMinutes(
  timezone: string,
  now: Date = new Date(),
): { weekday: number; minutes: number } {
  const wall = wallClockInZone(now, timezone);
  const weekday =
    (new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay() + 6) %
    7;
  return { weekday, minutes: wall.hour * 60 + wall.minute };
}

/**
 * Status otwarcia lokalu: „Otwarte do 19:00" / „Otwiera o 9:00" /
 * „Dziś zamknięte" — ten sam algorytm co web
 * (src/components/marketplace/format.ts).
 */
export function openStatus(
  openingHours: OpeningBlock[],
  timezone: string,
  now: Date = new Date(),
): { label: string; isOpen: boolean } {
  const { weekday, minutes } = zonedWeekdayMinutes(timezone, now);
  const today = openingHours
    .filter((block) => block.weekday === weekday)
    .sort((a, b) => a.startMinute - b.startMinute);

  for (const block of today) {
    if (minutes >= block.startMinute && minutes < block.endMinute) {
      return {
        label: `Otwarte do ${minutesToLabel(block.endMinute)}`,
        isOpen: true,
      };
    }
    if (minutes < block.startMinute) {
      return {
        label: `Otwiera o ${minutesToLabel(block.startMinute)}`,
        isOpen: false,
      };
    }
  }
  return { label: "Dziś zamknięte", isOpen: false };
}

/** „9:00–17:00, 18:00–20:00" albo „nieczynne" — wiersz godzin otwarcia. */
export function dayHoursLabel(
  openingHours: OpeningBlock[],
  weekday: number,
): string | null {
  const blocks = openingHours
    .filter((block) => block.weekday === weekday)
    .sort((a, b) => a.startMinute - b.startMinute);
  if (blocks.length === 0) return null;
  return blocks
    .map(
      (block) =>
        `${minutesToLabel(block.startMinute)}–${minutesToLabel(block.endMinute)}`,
    )
    .join(", ");
}
