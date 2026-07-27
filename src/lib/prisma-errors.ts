/**
 * Rozpoznawanie błędów Prismy bez importowania klas runtime'u w kodzie
 * strony/akcji (Prisma 7 generuje klienta do `src/generated`, a `instanceof`
 * po stronie server actions bywa zawodne przy re-eksportach).
 */

/** P2002 — naruszenie unikalnego indeksu (np. jedna opinia na rezerwację). */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}
