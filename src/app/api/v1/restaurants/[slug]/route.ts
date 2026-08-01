import { NextResponse } from "next/server";
import { getRestaurantLocation } from "@/lib/restaurant-data";

/**
 * GET /api/v1/restaurants/[slug]
 *
 * Publiczna konfiguracja restauracji: lokal, godziny otwarcia, sale z planem
 * stolików, strefy do wyboru i limity rezerwacji online. Wszystko, czego
 * potrzebuje ekran „zarezerwuj stolik", jednym zapytaniem.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const context = await getRestaurantLocation(slug);
  if (!context) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "Nie znaleziono restauracji" },
      { status: 404 },
    );
  }

  const { business, location, rooms, combinations } = context;

  return NextResponse.json({
    restaurant: {
      id: business.id,
      slug: business.slug,
      name: business.name,
      description: business.description,
      location: {
        id: location.id,
        name: location.name,
        addressLine1: location.addressLine1,
        addressLine2: location.addressLine2,
        city: location.city,
        postalCode: location.postalCode,
        phone: location.phone,
        latitude: location.latitude,
        longitude: location.longitude,
        timezone: location.timezone,
        openingHours: location.openingHours,
        slotGranularityMin: location.slotGranularityMin,
        minLeadTimeMin: location.minLeadTimeMin,
        maxAdvanceDays: location.maxAdvanceDays,
        cancellationCutoffHours: location.cancellationCutoffHours,
        defaultTurnTimeMin: location.defaultTurnTimeMin,
        tableBufferMin: location.tableBufferMin,
      },
      /** Limity rezerwacji online — powyżej maxPartySizeOnline trzeba dzwonić. */
      maxPartySizeOnline: location.maxPartySizeOnline,
      maxPartySizeSeatable: context.maxPartySizeSeatable,
      waitlistEnabled: location.waitlistEnabled,
      areas: context.areas,
      turnTimeRules: context.turnTimeRules,
      rooms: rooms.map((room) => ({
        id: room.id,
        name: room.name,
        sortOrder: room.sortOrder,
        gridWidth: room.gridWidth,
        gridHeight: room.gridHeight,
        tables: room.tables.map((table) => ({
          id: table.id,
          name: table.name,
          tableNumber: table.tableNumber,
          area: table.area,
          shape: table.shape,
          capacityMin: table.capacityMin,
          capacityMax: table.capacityMax,
          posX: table.posX,
          posY: table.posY,
          spanX: table.spanX,
          spanY: table.spanY,
          combinable: table.combinable,
          sortOrder: table.sortOrder,
        })),
      })),
      combinations: combinations.map((combination) => ({
        id: combination.id,
        name: combination.name,
        capacityMin: combination.capacityMin,
        capacityMax: combination.capacityMax,
        tableIds: combination.tableIds,
      })),
    },
  });
}
