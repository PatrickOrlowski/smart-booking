import { prisma } from "@/lib/prisma";
import {
  addLocalDays,
  computeAvailability,
  type AvailabilityResult,
  type Interval,
  type LocalDate,
  type ResourceAvailabilityInput,
} from "@/lib/availability";
import { localDayMinutesToUtc, utcToZonedWallClock } from "@/lib/time";

/**
 * Warstwa danych silnika dostępności: pobiera z Prismy wszystko, czego
 * potrzebuje czysta funkcja computeAvailability, i skleja wynik.
 */

export type ServiceContext = {
  business: { id: string; name: string; slug: string };
  service: {
    id: string;
    name: string;
    durationMin: number;
    bufferBeforeMin: number;
    bufferAfterMin: number;
    priceCents: number;
    priceType: string;
    currency: string;
  };
  location: {
    id: string;
    name: string;
    addressLine1: string;
    city: string;
    timezone: string;
    slotGranularityMin: number;
    minLeadTimeMin: number;
    maxAdvanceDays: number;
    cancellationCutoffHours: number;
    openingHours: { weekday: number; startMinute: number; endMinute: number }[];
  };
  resources: {
    id: string;
    name: string;
    title: string | null;
    durationMinOverride: number | null;
    priceCentsOverride: number | null;
  }[];
};

/**
 * Ładuje usługę wraz z lokalizacją i zasobami, które ją wykonują.
 * Zwraca null, gdy usługa nie istnieje, jest nieaktywna albo firma
 * nie jest aktywna.
 */
export async function loadServiceContext(
  businessSlug: string,
  serviceId: string,
): Promise<ServiceContext | null> {
  const service = await prisma.service.findFirst({
    where: {
      id: serviceId,
      isActive: true,
      onlineBookable: true,
      business: { slug: businessSlug, status: "ACTIVE" },
    },
    include: {
      business: { select: { id: true, name: true, slug: true } },
      resources: {
        where: { resource: { isActive: true } },
        include: {
          resource: {
            select: {
              id: true,
              name: true,
              locationId: true,
              staffProfile: { select: { title: true } },
            },
          },
        },
      },
    },
  });
  if (!service || service.resources.length === 0) return null;

  const location = await prisma.location.findFirst({
    where: { id: service.resources[0].resource.locationId, isActive: true },
    include: {
      openingHours: {
        select: { weekday: true, startMinute: true, endMinute: true },
      },
    },
  });
  if (!location) return null;

  return {
    business: service.business,
    service: {
      id: service.id,
      name: service.name,
      durationMin: service.durationMin,
      bufferBeforeMin: service.bufferBeforeMin,
      bufferAfterMin: service.bufferAfterMin,
      priceCents: service.priceCents,
      priceType: service.priceType,
      currency: service.currency,
    },
    location: {
      id: location.id,
      name: location.name,
      addressLine1: location.addressLine1,
      city: location.city,
      timezone: location.timezone,
      slotGranularityMin: location.slotGranularityMin,
      minLeadTimeMin: location.minLeadTimeMin,
      maxAdvanceDays: location.maxAdvanceDays,
      cancellationCutoffHours: location.cancellationCutoffHours,
      openingHours: location.openingHours,
    },
    resources: service.resources.map((entry) => ({
      id: entry.resource.id,
      name: entry.resource.name,
      title: entry.resource.staffProfile?.title ?? null,
      durationMinOverride: entry.durationMinOverride,
      priceCentsOverride: entry.priceCentsOverride,
    })),
  };
}

export type RangeAvailability = {
  context: ServiceContext;
  result: AvailabilityResult;
};

/**
 * Dostępność usługi w zakresie dni lokalnych. resourceId zawęża do jednego
 * zasobu (musi wykonywać usługę — inaczej null).
 */
export async function getAvailabilityForRange(options: {
  businessSlug: string;
  serviceId: string;
  dateFrom: LocalDate;
  dateTo: LocalDate;
  resourceId?: string;
  now?: Date;
  /**
   * Hold pomijany przy liczeniu zajętości — właściciel blokady checkoutu
   * musi widzieć swój własny slot jako wolny (inaczej sam by się zablokował).
   */
  ignoreHoldToken?: string;
  /** Pozwala uniknąć drugiego zapytania, gdy kontekst jest już załadowany. */
  context?: ServiceContext;
}): Promise<RangeAvailability | null> {
  const now = options.now ?? new Date();
  const context =
    options.context ??
    (await loadServiceContext(options.businessSlug, options.serviceId));
  if (!context) return null;

  const resources = options.resourceId
    ? context.resources.filter((r) => r.id === options.resourceId)
    : context.resources;
  if (resources.length === 0) return null;

  const timezone = context.location.timezone;
  const rangeStart = localDayMinutesToUtc(options.dateFrom, 0, timezone);
  const rangeEnd = localDayMinutesToUtc(
    addLocalDays(options.dateTo, 1),
    0,
    timezone,
  );
  const resourceIds = resources.map((r) => r.id);

  const [workingHours, busyItems, holds, timeOff] = await Promise.all([
    prisma.workingHours.findMany({
      where: { resourceId: { in: resourceIds } },
      select: {
        resourceId: true,
        weekday: true,
        startMinute: true,
        endMinute: true,
        validFrom: true,
        validTo: true,
      },
    }),
    prisma.bookingItem.findMany({
      where: {
        resourceId: { in: resourceIds },
        isBlocking: true,
        blockedStartAt: { lt: rangeEnd },
        blockedEndAt: { gt: rangeStart },
      },
      select: { resourceId: true, blockedStartAt: true, blockedEndAt: true },
    }),
    prisma.hold.findMany({
      where: {
        resourceId: { in: resourceIds },
        // Wygasłe holdy nie blokują grafiku, nawet zanim je posprzątamy.
        expiresAt: { gt: now },
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
        ...(options.ignoreHoldToken
          ? { token: { not: options.ignoreHoldToken } }
          : {}),
      },
      select: { resourceId: true, startAt: true, endAt: true },
    }),
    prisma.timeOff.findMany({
      where: {
        OR: [
          { resourceId: { in: resourceIds } },
          { locationId: context.location.id },
        ],
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
      },
      select: {
        resourceId: true,
        locationId: true,
        startAt: true,
        endAt: true,
      },
    }),
  ]);

  const locationTimeOff: Interval[] = timeOff
    .filter((off) => !off.resourceId)
    .map((off) => ({ start: off.startAt, end: off.endAt }));

  const engineResources: ResourceAvailabilityInput[] = resources.map(
    (resource) => ({
      id: resource.id,
      durationMinOverride: resource.durationMinOverride,
      workingHours: workingHours.filter(
        (rule) => rule.resourceId === resource.id,
      ),
      busy: busyItems
        .filter((item) => item.resourceId === resource.id)
        .map((item) => ({ start: item.blockedStartAt, end: item.blockedEndAt })),
      holds: holds
        .filter((hold) => hold.resourceId === resource.id)
        .map((hold) => ({ start: hold.startAt, end: hold.endAt })),
      timeOff: timeOff
        .filter((off) => off.resourceId === resource.id)
        .map((off) => ({ start: off.startAt, end: off.endAt })),
    }),
  );

  const result = computeAvailability({
    resources: engineResources,
    openingHours: context.location.openingHours,
    locationTimeOff,
    config: {
      timezone,
      slotGranularityMin: context.location.slotGranularityMin,
      minLeadTimeMin: context.location.minLeadTimeMin,
      maxAdvanceDays: context.location.maxAdvanceDays,
    },
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    serviceDurationMin: context.service.durationMin,
    bufferBeforeMin: context.service.bufferBeforeMin,
    bufferAfterMin: context.service.bufferAfterMin,
    now,
  });

  return { context, result };
}

/**
 * Najbliższy wolny termin firmy (dowolny pracownik, najkrótsza usługa) —
 * pastylka na liście wyników wyszukiwarki.
 */
export async function getNearestSlot(
  businessSlug: string,
  daysAhead = 7,
): Promise<{ startAt: Date; timezone: string } | null> {
  const shortestService = await prisma.service.findFirst({
    where: {
      isActive: true,
      onlineBookable: true,
      priceType: { not: "ON_REQUEST" },
      business: { slug: businessSlug, status: "ACTIVE" },
    },
    orderBy: { durationMin: "asc" },
    select: { id: true },
  });
  if (!shortestService) return null;

  const context = await loadServiceContext(businessSlug, shortestService.id);
  if (!context) return null;

  const now = new Date();
  const todayWall = utcToZonedWallClock(now, context.location.timezone);
  const today: LocalDate = {
    year: todayWall.year,
    month: todayWall.month,
    day: todayWall.day,
  };

  const availability = await getAvailabilityForRange({
    businessSlug,
    serviceId: shortestService.id,
    dateFrom: today,
    dateTo: addLocalDays(today, daysAhead - 1),
    now,
    context,
  });
  const first = availability?.result.merged[0];
  if (!first) return null;
  return { startAt: first.startAt, timezone: context.location.timezone };
}
