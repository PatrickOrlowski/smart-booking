import type { BookingStatus } from "@/generated/prisma/enums";

/**
 * Wspólne reguły „nadchodzące / minione / można ocenić" dla konta klienta —
 * używa ich zarówno strona (/konto), jak i server actions.
 *
 * COMPLETED ustawia wyłącznie pracownik ręcznie (src/app/pracownik/actions.ts),
 * więc status nie może być jedynym wyznacznikiem historii: nierozliczona
 * wizyta CONFIRMED sprzed tygodnia to dla klienta wizyta minione, a nie
 * rezerwacja, która zniknęła z konta.
 */

/** Statusy końcowe — wizyta jest historią niezależnie od godziny. */
export const TERMINAL_BOOKING_STATUSES = [
  "COMPLETED",
  "NO_SHOW",
  "CANCELLED_BY_CUSTOMER",
  "CANCELLED_BY_BUSINESS",
] as const satisfies readonly BookingStatus[];

/** Statusy „żywe" — wizyta wciąż może się odbyć. */
export const OPEN_BOOKING_STATUSES = [
  "PENDING",
  "CONFIRMED",
] as const satisfies readonly BookingStatus[];

/**
 * Czy wizytę można ocenić: rozliczona ręcznie (COMPLETED) albo potwierdzona
 * i zakończona według zegara.
 */
export function isReviewable(
  booking: { status: BookingStatus; endAt: Date },
  now: Date,
): boolean {
  if (booking.status === "COMPLETED") return true;
  return booking.status === "CONFIRMED" && booking.endAt.getTime() <= now.getTime();
}
