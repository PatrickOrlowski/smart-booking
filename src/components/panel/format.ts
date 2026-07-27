import type {
  BusinessType,
  PriceType,
  StaffRole,
  TimeOffType,
} from "@/generated/prisma/enums";

/**
 * Wspólne formatowanie i słowniki etykiet panelu firmy.
 * Moduł bez zależności serwerowych — bezpieczny w komponentach klienckich.
 */

export const WEEKDAY_LABELS = [
  "Poniedziałek",
  "Wtorek",
  "Środa",
  "Czwartek",
  "Piątek",
  "Sobota",
  "Niedziela",
] as const;

export const WEEKDAY_SHORT = ["pn", "wt", "śr", "cz", "pt", "sb", "nd"] as const;

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  BARBER: "Barber shop",
  HAIR_SALON: "Salon fryzjerski",
  BEAUTY: "Salon urody",
  NAILS: "Stylizacja paznokci",
  SPA: "SPA i masaż",
  TATTOO: "Studio tatuażu",
  FITNESS: "Fitness i trening",
  AUTO_SERVICE: "Warsztat / detailing",
  MEDICAL: "Gabinet medyczny",
  RESTAURANT: "Restauracja",
  OTHER: "Inna działalność",
};

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  OWNER: "Właściciel",
  MANAGER: "Menedżer",
  EMPLOYEE: "Pracownik",
};

export const TIME_OFF_LABELS: Record<TimeOffType, string> = {
  VACATION: "Urlop",
  SICK_LEAVE: "Zwolnienie lekarskie",
  BREAK: "Przerwa",
  HOLIDAY: "Święto",
  BLOCKED: "Blokada",
};

export const PRICE_TYPE_LABELS: Record<PriceType, string> = {
  FIXED: "Stała",
  FROM: "Od",
  FREE: "Bezpłatna",
  ON_REQUEST: "Na zapytanie",
};

/** Minuty od północy → "09:30". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Cena w groszach → "70 zł" / "od 90 zł" / "bezpłatnie" / "na zapytanie". */
export function formatPrice(
  priceCents: number,
  currency: string = "PLN",
  priceType: PriceType = "FIXED",
): string {
  if (priceType === "FREE") return "bezpłatnie";
  if (priceType === "ON_REQUEST") return "na zapytanie";
  const formatted = new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency,
    minimumFractionDigits: priceCents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(priceCents / 100);
  return priceType === "FROM" ? `od ${formatted}` : formatted;
}

/** Inicjały do awatara: "Adam Nowak" → "AN". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/** Lista opcji czasu co `step` minut w przedziale [startMin, endMin]. */
export function timeOptions(
  startMin: number,
  endMin: number,
  step: number,
): number[] {
  const options: number[] = [];
  for (let minute = startMin; minute <= endMin; minute += step) {
    options.push(minute);
  }
  return options;
}

/** "2026-07-30" → { year, month, day } albo null, gdy format się nie zgadza. */
export function parseDateParam(
  value: string | undefined,
): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** { year, month, day } → "2026-07-30". */
export function toDateParam(day: {
  year: number;
  month: number;
  day: number;
}): string {
  return `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
}

/** Dzień kalendarzowy przesunięty o `days` (arytmetyka w UTC — bez DST). */
export function shiftDay(
  day: { year: number; month: number; day: number },
  days: number,
): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(day.year, day.month - 1, day.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

/** Dzień tygodnia dnia kalendarzowego: 0 = poniedziałek … 6 = niedziela. */
export function weekdayOf(day: {
  year: number;
  month: number;
  day: number;
}): number {
  return (new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay() + 6) % 7;
}
