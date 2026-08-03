import type { RestaurantArea } from "@/generated/prisma/enums";

/**
 * Kontrakt serwer → klient dla ekranów restauracji.
 *
 * Wszystko jest serializowalne (daty jako ISO), bo te dane przechodzą przez
 * granicę RSC. Kształt celowo odpowiada odpowiedziom
 * `/api/v1/restaurants/[slug]` i `.../availability`, żeby klient obsługiwał
 * jeden typ slotu niezależnie od źródła (SSR czy fetch).
 */

export type RestaurantSlot = {
  startAt: string;
  endAt: string;
  durationMin: number;
  tableIds: string[];
  tableNumbers: string[];
  combinationId?: string;
  area: RestaurantArea | null;
  label: string;
};

export type RestaurantBookingData = {
  slug: string;
  name: string;
  address: string;
  phone: string | null;
  timezone: string;
  cancellationCutoffHours: number;
  defaultTurnTimeMin: number;
  /** Reguły turn time — klient liczy „stolik na X h" bez odpytywania API. */
  turnTimeRules: {
    partySizeMin: number;
    partySizeMax: number;
    durationMin: number;
  }[];
  /** Strefy, w których faktycznie stoją stoliki. */
  areas: RestaurantArea[];
  /** Godziny otwarcia (minuty czasu ściennego) — siatka godzin waitlisty. */
  openingHours: { weekday: number; startMinute: number; endMinute: number }[];
  /** Horyzont rezerwacji w dniach — ogranicza pasek dni i zapis na listę. */
  maxAdvanceDays: number;
  maxPartySizeOnline: number | null;
  maxPartySizeSeatable: number;
  /**
   * Najmniejsza grupa, jaką lokal w ogóle sadza (najniższe `capacityMin`).
   * Poniżej tej wartości silnik nigdy nie zwróci slotu — UI musi powiedzieć
   * „nie sadzamy pojedynczych gości", a nie „brak wolnych stolików".
   */
  minPartySizeSeatable: number;
  waitlistEnabled: boolean;
  /**
   * „Teraz" z zegara serwera (ISO). Komponenty kliencie nie wolno czytać
   * `Date.now()` w renderze (musi być czysty i zgodny z SSR), a to i tak
   * właściwy zegar — dostępności pilnuje serwer.
   */
  nowIso: string;
  /** Zalogowany gość — formularz danych wypełnia się sam. */
  user: { name: string | null; email: string | null; phone: string | null } | null;
};

/** Odpowiedź GET /api/v1/restaurants/[slug]/availability. */
export type AvailabilityResponse = {
  date: string;
  partySize: number;
  timezone: string;
  durationMin: number;
  maxPartySizeOnline: number | null;
  waitlistEnabled: boolean;
  areas: RestaurantArea[];
  slots: RestaurantSlot[];
  days?: { date: string; durationMin: number; slots: RestaurantSlot[] }[];
};

/** Odpowiedź 422 PARTY_TOO_LARGE — grupa ponad limit rezerwacji online. */
export type PartyTooLargeResponse = {
  error: "PARTY_TOO_LARGE";
  message: string;
  maxPartySizeOnline: number;
  waitlistEnabled: boolean;
  phone: string | null;
};

/** Odpowiedź 422 PARTY_TOO_SMALL — grupa mniejsza niż najmniejszy stolik. */
export type PartyTooSmallResponse = {
  error: "PARTY_TOO_SMALL";
  message: string;
  minPartySizeSeatable: number;
  phone: string | null;
};

/** Rezerwacja zwrócona przez POST /api/v1/restaurants/[slug]/bookings. */
export type TableBookingResult = {
  id: string;
  status: string;
  startAt: string;
  endAt: string;
  durationMin: number;
  partySize: number;
  tableIds: string[];
  tableNumbers: string[];
  tableLabel: string;
  combinationId?: string;
  area: RestaurantArea | null;
  restaurantName: string;
  address: string;
  timezone: string;
  cancellationCutoffHours: number;
  cancellationDeadline: string;
};

/**
 * Czas zajęcia stolika dla liczby osób — ta sama reguła co w silniku
 * (`turnTimeForPartySize` w src/lib/table-availability.ts), łącznie z tym, że
 * grupa większa od najwyższej reguły dostaje JEJ czas, a nie wartość domyślną.
 */
export function turnTimeFor(
  rules: RestaurantBookingData["turnTimeRules"],
  partySize: number,
  fallbackMin: number,
): number {
  const rule = rules.find(
    (candidate) =>
      partySize >= candidate.partySizeMin && partySize <= candidate.partySizeMax,
  );
  if (rule) return rule.durationMin;

  const highest = rules.reduce<RestaurantBookingData["turnTimeRules"][number] | null>(
    (best, candidate) =>
      best === null || candidate.partySizeMax > best.partySizeMax
        ? candidate
        : best,
    null,
  );
  if (highest && partySize > highest.partySizeMax) return highest.durationMin;
  return fallbackMin;
}
