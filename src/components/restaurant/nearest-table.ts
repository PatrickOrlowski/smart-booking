import { addLocalDays, isoDateToLocalDate } from "@/lib/availability";
import {
  getRestaurantLocation,
  getTableAvailabilityRange,
} from "@/lib/restaurant-data";
import { localIsoDate } from "./format";

/**
 * Najbliższy wolny stolik restauracji — pastylka „Stolik dziś od 18:00"
 * na listingach renderowanych dynamicznie.
 *
 * `getNearestSlot` z availability-data.ts liczy dostępność PRACOWNIKÓW
 * (grafiki, usługi) i dla lokalu gastronomicznego zwraca zawsze null — stolik
 * ma inną logikę (turn time, pacing, zestawienia), więc ma własną funkcję.
 */
export async function getNearestTableSlot(
  slug: string,
  options: { partySize?: number; daysAhead?: number } = {},
): Promise<{ startAt: Date; timezone: string } | null> {
  const context = await getRestaurantLocation(slug);
  if (!context) return null;

  const now = new Date();
  const today = isoDateToLocalDate(localIsoDate(now, context.location.timezone));
  if (!today) return null;

  const range = await getTableAvailabilityRange({
    slug,
    context,
    dateFrom: today,
    dateTo: addLocalDays(today, (options.daysAhead ?? 7) - 1),
    partySize: options.partySize ?? 2,
    now,
  });
  const first = range?.days.flatMap((day) => day.slots)[0];
  return first
    ? { startAt: first.startAt, timezone: context.location.timezone }
    : null;
}
