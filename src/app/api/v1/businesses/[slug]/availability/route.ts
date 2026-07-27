import { NextResponse } from "next/server";
import { isoDateToLocalDate } from "@/lib/availability";
import { getAvailabilityForRange } from "@/lib/availability-data";

/**
 * GET /api/v1/businesses/[slug]/availability?serviceId=&date=YYYY-MM-DD&resourceId=
 *
 * Wolne sloty na jeden dzień: widok scalony („dowolny pracownik")
 * plus rozbicie per zasób. Czasy w UTC (ISO), prezentację w strefie
 * lokalu robi klient na bazie pola timezone.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const { searchParams } = new URL(request.url);

  const serviceId = searchParams.get("serviceId");
  const dateParam = searchParams.get("date");
  const resourceId = searchParams.get("resourceId") ?? undefined;

  if (!serviceId || !dateParam) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "Wymagane parametry: serviceId oraz date (YYYY-MM-DD)",
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

  const availability = await getAvailabilityForRange({
    businessSlug: slug,
    serviceId,
    dateFrom: date,
    dateTo: date,
    resourceId,
  });

  if (!availability) {
    return NextResponse.json(
      {
        error: "NOT_FOUND",
        message: "Nie znaleziono usługi, firmy albo zasobu",
      },
      { status: 404 },
    );
  }

  const { context, result } = availability;

  return NextResponse.json({
    date: dateParam,
    timezone: context.location.timezone,
    slotGranularityMin: context.location.slotGranularityMin,
    service: {
      id: context.service.id,
      name: context.service.name,
      durationMin: context.service.durationMin,
    },
    slots: result.merged.map((slot) => ({
      startAt: slot.startAt.toISOString(),
      resourceIds: slot.resourceIds,
    })),
    perResource: result.perResource.map((entry) => ({
      resourceId: entry.resourceId,
      slots: entry.slots.map((slot) => ({
        startAt: slot.startAt.toISOString(),
        endAt: slot.endAt.toISOString(),
      })),
    })),
  });
}
