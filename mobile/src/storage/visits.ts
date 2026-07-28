import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Lokalna lista wizyt użytkownika (AsyncStorage). Aplikacja nie ma kont —
 * to jedyna pamięć „moich" rezerwacji: wpis powstaje po udanym POST
 * /api/v1/bookings, a e-mail z wpisu jest przepustką do GET
 * /api/v1/bookings/[id] i do anulowania. Statusy nie są tu trzymane —
 * odświeża je ekran listy pytając API.
 */

const STORAGE_KEY = "planner.visits";

export type StoredVisit = {
  bookingId: string;
  businessSlug: string;
  businessName: string;
  serviceName: string;
  /** ISO 8601 UTC — prezentację w strefie lokalu robi UI. */
  startAt: string;
  /**
   * Strefa czasowa lokalu (IANA) z odpowiedzi POST /bookings — bez niej UI
   * formatowałby godziny w domyślnej strefie, błędnie dla lokali spoza niej.
   * Opcjonalna tylko dla wpisów zapisanych przed jej wprowadzeniem
   * (formatery mają wtedy fallback na DEFAULT_TIMEZONE).
   */
  timezone?: string;
  priceCents: number;
  /** E-mail rezerwującego — wymagany przez API przy odczycie i anulowaniu. */
  email: string;
};

function isStoredVisit(value: unknown): value is StoredVisit {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.bookingId === "string" &&
    typeof v.businessSlug === "string" &&
    typeof v.businessName === "string" &&
    typeof v.serviceName === "string" &&
    typeof v.startAt === "string" &&
    (v.timezone === undefined || typeof v.timezone === "string") &&
    typeof v.priceCents === "number" &&
    typeof v.email === "string"
  );
}

/** Wszystkie zapisane wizyty. Uszkodzony zapis = pusta lista, nie crash. */
export async function listVisits(): Promise<StoredVisit[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredVisit);
  } catch {
    return [];
  }
}

/** Dodaje wizytę; wpis o tym samym bookingId jest nadpisywany. */
export async function addVisit(visit: StoredVisit): Promise<void> {
  const visits = await listVisits();
  const next = [
    ...visits.filter((v) => v.bookingId !== visit.bookingId),
    visit,
  ];
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

/** Usuwa wizytę (np. po anulowaniu) — brak wpisu to też sukces. */
export async function removeVisit(bookingId: string): Promise<void> {
  const visits = await listVisits();
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(visits.filter((v) => v.bookingId !== bookingId)),
  );
}
