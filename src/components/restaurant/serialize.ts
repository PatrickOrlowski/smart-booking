import type { TableSlot } from "@/lib/table-availability";
import type { RestaurantContext } from "@/lib/restaurant-data";
import type { RestaurantBookingData, RestaurantSlot } from "./types";

/**
 * Most server → client: wynik silnika stolików (obiekty Date) na kształt
 * identyczny z odpowiedzią REST, żeby komponenty kliencie miały jeden typ
 * niezależnie od tego, czy dane przyszły z SSR, czy z fetcha.
 */

export const serializeSlot = (slot: TableSlot): RestaurantSlot => ({
  startAt: slot.startAt.toISOString(),
  endAt: slot.endAt.toISOString(),
  durationMin: slot.durationMin,
  tableIds: slot.tableIds,
  tableNumbers: slot.tableNumbers,
  ...(slot.combinationId ? { combinationId: slot.combinationId } : {}),
  area: slot.area,
  label: slot.label,
});

/** Kontekst restauracji → props flow rezerwacji i widgetu na profilu. */
export function toBookingData(
  context: RestaurantContext,
  user: RestaurantBookingData["user"],
  now: Date = new Date(),
): RestaurantBookingData {
  const { business, location } = context;
  return {
    slug: business.slug,
    name: business.name,
    address: `${location.addressLine1}, ${location.city}`,
    phone: location.phone,
    timezone: location.timezone,
    cancellationCutoffHours: location.cancellationCutoffHours,
    defaultTurnTimeMin: location.defaultTurnTimeMin,
    turnTimeRules: context.turnTimeRules,
    areas: context.areas,
    openingHours: location.openingHours,
    maxAdvanceDays: location.maxAdvanceDays,
    maxPartySizeOnline: location.maxPartySizeOnline,
    maxPartySizeSeatable: context.maxPartySizeSeatable,
    waitlistEnabled: location.waitlistEnabled,
    nowIso: now.toISOString(),
    user,
  };
}
