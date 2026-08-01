import { NextResponse } from "next/server";
import { RestaurantArea } from "@/generated/prisma/enums";
import { addLocalDays, isoDateToLocalDate } from "@/lib/availability";
import {
  getRestaurantLocation,
  getTableAvailabilityRange,
  partyTooLargeMessage,
} from "@/lib/restaurant-data";
import type { TableSlot } from "@/lib/table-availability";

/**
 * GET /api/v1/restaurants/[slug]/availability?date=YYYY-MM-DD&partySize=2&area=OUTDOOR&days=1
 *
 * Wolne godziny na stolik dla podanej liczby osób. Czas trwania rezerwacji
 * wynika z liczby osób (TurnTimeRule), więc dwójka i szóstka dostają różne
 * siatki godzin. Czasy w UTC (ISO) — prezentację w strefie lokalu robi klient
 * na podstawie pola `timezone`.
 */

const MAX_DAYS = 14;

const isArea = (value: string): value is RestaurantArea =>
  Object.values(RestaurantArea).includes(value as RestaurantArea);

const serializeSlot = (slot: TableSlot) => ({
  startAt: slot.startAt.toISOString(),
  endAt: slot.endAt.toISOString(),
  durationMin: slot.durationMin,
  tableIds: slot.tableIds,
  tableNumbers: slot.tableNumbers,
  ...(slot.combinationId ? { combinationId: slot.combinationId } : {}),
  area: slot.area,
  label: slot.label,
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const { searchParams } = new URL(request.url);

  const dateParam = searchParams.get("date");
  const partySizeParam = searchParams.get("partySize");
  const areaParam = searchParams.get("area");
  const daysParam = searchParams.get("days");

  if (!dateParam || !partySizeParam) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "Wymagane parametry: date (YYYY-MM-DD) oraz partySize",
      },
      { status: 400 },
    );
  }

  const date = isoDateToLocalDate(dateParam);
  if (!date) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "Nieprawidłowa data (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  const partySize = Number(partySizeParam);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 200) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "Nieprawidłowa liczba osób" },
      { status: 400 },
    );
  }

  if (areaParam && !isArea(areaParam)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "Nieprawidłowa strefa" },
      { status: 400 },
    );
  }

  const days = daysParam ? Number(daysParam) : 1;
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: `Parametr days musi być liczbą od 1 do ${MAX_DAYS}`,
      },
      { status: 400 },
    );
  }

  const context = await getRestaurantLocation(slug);
  if (!context) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "Nie znaleziono restauracji" },
      { status: 404 },
    );
  }

  // Grupy ponad limit online kierujemy do telefonu — ten sam komunikat co
  // przy próbie zapisu rezerwacji.
  const maxOnline = context.location.maxPartySizeOnline;
  if (maxOnline !== null && partySize > maxOnline) {
    return NextResponse.json(
      {
        error: "PARTY_TOO_LARGE",
        message: partyTooLargeMessage(context),
        maxPartySizeOnline: maxOnline,
        waitlistEnabled: context.location.waitlistEnabled,
        phone: context.location.phone,
      },
      { status: 422 },
    );
  }

  const availability = await getTableAvailabilityRange({
    slug,
    context,
    dateFrom: date,
    dateTo: addLocalDays(date, days - 1),
    partySize,
    area: areaParam && isArea(areaParam) ? areaParam : null,
  });
  if (!availability) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "Nie znaleziono restauracji" },
      { status: 404 },
    );
  }

  const first = availability.days[0];

  return NextResponse.json({
    date: dateParam,
    partySize,
    area: areaParam ?? null,
    timezone: context.location.timezone,
    slotGranularityMin: context.location.slotGranularityMin,
    /** Czas zajęcia stolika dla tej liczby osób. */
    durationMin: first?.durationMin ?? context.location.defaultTurnTimeMin,
    maxPartySizeOnline: maxOnline,
    waitlistEnabled: context.location.waitlistEnabled,
    areas: context.areas,
    slots: (first?.slots ?? []).map(serializeSlot),
    // Kolejne dni tylko wtedy, gdy klient o nie poprosił (days > 1) —
    // przy domyślnym zapytaniu byłaby to kopia pola `slots`.
    ...(days > 1
      ? {
          days: availability.days.map((day) => ({
            date: day.date,
            durationMin: day.durationMin,
            slots: day.slots.map(serializeSlot),
          })),
        }
      : {}),
  });
}
