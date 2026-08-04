/**
 * Wspólna walidacja współrzędnych z URL-a (?lat=&lng=) — ta sama reguła po
 * stronie serwera (src/app/page.tsx) i klienta (useGeolocation, DistanceChip).
 * Dzięki temu UI nigdy nie pokazuje aktywnego trybu „w pobliżu", którego
 * serwer właśnie odrzucił (np. stary link z ?lat=999).
 */

/** "52.2245" z URL-a → liczba w zakresie ±max albo null (bez crasha). */
export const parseCoordinate = (
  raw: string | null | undefined,
  max: number,
): number | null => {
  const trimmed = raw?.trim();
  // Number("") i Number(" ") to 0 — pusta wartość nie może udawać równika.
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && Math.abs(value) <= max ? value : null;
};

/** Czy parametry zawierają poprawną parę lat/lng — obie muszą się parsować. */
export const hasValidGeoParams = (params: {
  get(name: string): string | null;
}): boolean =>
  parseCoordinate(params.get("lat"), 90) !== null &&
  parseCoordinate(params.get("lng"), 180) !== null;
