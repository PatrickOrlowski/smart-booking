import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isoDateToLocalDate } from "@/lib/availability";
import { getAvailabilityForRange } from "@/lib/availability-data";
import {
  apiError,
  crossTenantError,
  requireApiBusiness,
} from "@/app/api/public/v1/common";

/**
 * GET /api/public/v1/availability?serviceId=&date=YYYY-MM-DD[&resourceId=]
 *
 * Wolne sloty jednego dnia dla usługi firmy właściciela klucza.
 * Czasy w UTC (ISO) + pole timezone do prezentacji.
 */
export async function GET(request: Request) {
  const auth = await requireApiBusiness(request);
  if (!auth.ok) return auth.response;
  const { business } = auth.ctx;

  const { searchParams } = new URL(request.url);
  const serviceId = searchParams.get("serviceId");
  const dateParam = searchParams.get("date");
  const resourceId = searchParams.get("resourceId") ?? undefined;

  if (!serviceId || !dateParam) {
    return apiError(
      400,
      "BAD_REQUEST",
      "Wymagane parametry: serviceId oraz date (YYYY-MM-DD).",
    );
  }
  const date = isoDateToLocalDate(dateParam);
  if (!date) {
    return apiError(400, "BAD_REQUEST", "Nieprawidłowa data (YYYY-MM-DD).");
  }

  // Zakres klucza: usługa musi należeć do firmy klucza. Cudza → 403,
  // nieistniejąca → 404 — bez żadnych danych innej firmy.
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { businessId: true },
  });
  if (!service || service.businessId !== business.id) {
    return crossTenantError(service !== null, "serviceId");
  }

  const availability = await getAvailabilityForRange({
    businessSlug: business.slug,
    serviceId,
    dateFrom: date,
    dateTo: date,
    resourceId,
  });
  if (!availability) {
    return apiError(
      404,
      "NOT_FOUND",
      "Usługa nie jest dostępna do rezerwacji online albo zasób jej nie wykonuje.",
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
