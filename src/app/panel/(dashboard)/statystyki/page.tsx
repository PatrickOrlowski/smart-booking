import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";
import { localDayMinutesToUtc, utcToZonedWallClock } from "@/lib/time";
import { getPanelBusiness } from "@/app/panel/data";
import {
  WEEKDAY_SHORT,
  formatPrice,
  shiftDay,
  weekdayOf,
} from "@/components/panel/format";
import { StatSection, StatTile } from "@/components/panel/stats-cards";
import {
  OccupancyList,
  SourcesSplit,
  TopServicesList,
  type OccupancyRow,
  type TopServiceRow,
} from "@/components/panel/stats-bars";
import {
  StatsRevenueChart,
  type RevenuePoint,
} from "@/components/panel/stats-revenue-chart";

/**
 * Statystyki firmy za ostatnie 7/30/90 dni (?okres=), wszystko liczone
 * w strefie czasowej lokalizacji: KPI (przychód z zakończonych wizyt,
 * liczba wizyt, średnia wartość, no-show rate), obłożenie per pracownik,
 * top 5 usług, źródła rezerwacji i przychód dzienny (SVG).
 */

const PERIOD_OPTIONS = [7, 30, 90] as const;
type PeriodDays = (typeof PERIOD_OPTIONS)[number];

function parsePeriod(value: string | undefined): PeriodDays {
  const parsed = Number(value);
  return PERIOD_OPTIONS.find((option) => option === parsed) ?? 30;
}

type CalendarDay = { year: number; month: number; day: number };

/** Suma minut grafiku (WorkingHours) zasobu w oknie dni lokalnych. */
function workingMinutesInPeriod(
  rows: {
    weekday: number;
    startMinute: number;
    endMinute: number;
    validFrom: Date | null;
    validTo: Date | null;
  }[],
  startDay: CalendarDay,
  days: number,
): number {
  let total = 0;
  for (let i = 0; i < days; i++) {
    const day = shiftDay(startDay, i);
    const weekday = weekdayOf(day);
    const dayUtc = Date.UTC(day.year, day.month - 1, day.day);
    for (const row of rows) {
      if (row.weekday !== weekday) continue;
      if (row.validFrom && row.validFrom.getTime() > dayUtc) continue;
      if (row.validTo && row.validTo.getTime() < dayUtc) continue;
      total += row.endMinute - row.startMinute;
    }
  }
  return total;
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ okres?: string }>;
}) {
  const { okres } = await searchParams;
  const panel = await getPanelBusiness();
  if (!panel) redirect("/panel/nowa");
  // Przychód firmy i obłożenie całego zespołu to dane zarządcze — szeregowy
  // pracownik widzi wyłącznie swój grafik (patrz requireBusinessManager).
  if (!panel.isManager) redirect("/panel");

  const { business, location } = panel;
  const tz = location?.timezone ?? "Europe/Warsaw";
  const days = parsePeriod(okres);

  const todayWall = utcToZonedWallClock(new Date(), tz);
  const today: CalendarDay = {
    year: todayWall.year,
    month: todayWall.month,
    day: todayWall.day,
  };
  const startDay = shiftDay(today, -(days - 1));
  const startUtc = localDayMinutesToUtc(startDay, 0, tz);
  const endUtc = localDayMinutesToUtc(shiftDay(today, 1), 0, tz);

  const inPeriod = { gte: startUtc, lt: endUtc };

  const [statusGroups, sourceGroups, completedBookings, topServiceGroups, staffResources, bookedGroups] =
    await Promise.all([
      prisma.booking.groupBy({
        by: ["status"],
        where: { businessId: business.id, startAt: inPeriod },
        _count: { _all: true },
      }),
      prisma.booking.groupBy({
        by: ["source"],
        where: { businessId: business.id, startAt: inPeriod },
        _count: { _all: true },
      }),
      prisma.booking.findMany({
        where: { businessId: business.id, status: "COMPLETED", startAt: inPeriod },
        select: {
          startAt: true,
          currency: true,
          items: { select: { priceCents: true } },
        },
      }),
      prisma.bookingItem.groupBy({
        by: ["serviceId"],
        where: {
          booking: {
            businessId: business.id,
            status: "COMPLETED",
            startAt: inPeriod,
          },
        },
        _count: { _all: true },
        _sum: { priceCents: true },
        orderBy: { _sum: { priceCents: "desc" } },
        take: 5,
      }),
      prisma.resource.findMany({
        where: {
          type: "STAFF",
          isActive: true,
          location: { businessId: business.id },
        },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          workingHours: {
            select: {
              weekday: true,
              startMinute: true,
              endMinute: true,
              validFrom: true,
              validTo: true,
            },
          },
        },
      }),
      prisma.bookingItem.groupBy({
        by: ["resourceId"],
        where: {
          startAt: inPeriod,
          booking: {
            businessId: business.id,
            status: { in: ["COMPLETED", "CONFIRMED"] },
          },
        },
        _sum: { durationMin: true },
      }),
    ]);

  // --- KPI -----------------------------------------------------------------
  const countOf = (status: string) =>
    statusGroups.find((row) => row.status === status)?._count._all ?? 0;
  const completedCount = countOf("COMPLETED");
  const noShowCount = countOf("NO_SHOW");
  const cancelledCount =
    countOf("CANCELLED_BY_CUSTOMER") + countOf("CANCELLED_BY_BUSINESS");
  const visitsCount =
    statusGroups.reduce((sum, row) => sum + row._count._all, 0) -
    cancelledCount;

  const currency = completedBookings[0]?.currency ?? "PLN";
  const revenueCents = completedBookings.reduce(
    (sum, booking) =>
      sum + booking.items.reduce((s, item) => s + item.priceCents, 0),
    0,
  );
  const avgCents =
    completedCount > 0 ? Math.round(revenueCents / completedCount) : 0;
  const finishedCount = completedCount + noShowCount;
  const noShowRate =
    finishedCount > 0 ? (noShowCount / finishedCount) * 100 : 0;

  // --- Przychód per dzień --------------------------------------------------
  const revenueByDay = new Map<string, number>();
  for (const booking of completedBookings) {
    const wall = utcToZonedWallClock(booking.startAt, tz);
    const key = `${wall.year}-${wall.month}-${wall.day}`;
    const value = booking.items.reduce((s, item) => s + item.priceCents, 0);
    revenueByDay.set(key, (revenueByDay.get(key) ?? 0) + value);
  }
  const revenuePoints: RevenuePoint[] = Array.from(
    { length: days },
    (_, i) => {
      const day = shiftDay(startDay, i);
      const shortLabel = `${String(day.day).padStart(2, "0")}.${String(day.month).padStart(2, "0")}`;
      return {
        key: `${day.year}-${day.month}-${day.day}`,
        shortLabel,
        fullLabel: `${WEEKDAY_SHORT[weekdayOf(day)]} ${shortLabel}`,
        valueCents: revenueByDay.get(`${day.year}-${day.month}-${day.day}`) ?? 0,
      };
    },
  );

  // --- Obłożenie -----------------------------------------------------------
  const bookedByResource = new Map(
    bookedGroups.map((row) => [row.resourceId, row._sum.durationMin ?? 0]),
  );
  const occupancyRows: OccupancyRow[] = staffResources
    .map((resource) => ({
      resourceId: resource.id,
      name: resource.name,
      bookedMinutes: bookedByResource.get(resource.id) ?? 0,
      workMinutes: workingMinutesInPeriod(resource.workingHours, startDay, days),
    }))
    .sort(
      (a, b) =>
        b.bookedMinutes / Math.max(b.workMinutes, 1) -
        a.bookedMinutes / Math.max(a.workMinutes, 1),
    );

  // --- Top 5 usług ---------------------------------------------------------
  const serviceNames = new Map(
    (
      await prisma.service.findMany({
        where: { id: { in: topServiceGroups.map((row) => row.serviceId) } },
        select: { id: true, name: true },
      })
    ).map((service) => [service.id, service.name]),
  );
  const topServices: TopServiceRow[] = topServiceGroups.map((row) => ({
    serviceId: row.serviceId,
    name: serviceNames.get(row.serviceId) ?? "Usługa",
    count: row._count._all,
    revenueCents: row._sum.priceCents ?? 0,
  }));

  // --- Źródła --------------------------------------------------------------
  const manualCount =
    sourceGroups.find((row) => row.source === "MANUAL_STAFF")?._count._all ?? 0;
  const marketplaceCount =
    sourceGroups.reduce((sum, row) => sum + row._count._all, 0) - manualCount;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-[22px] leading-tight font-extrabold tracking-tight sm:text-[27px]">
            Statystyki
          </h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Przychód, obłożenie i źródła rezerwacji — ostatnie {days} dni
            w strefie {tz}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-full border border-border bg-card p-1">
            {PERIOD_OPTIONS.map((option) => (
              <Link
                key={option}
                href={option === 30 ? "/panel/statystyki" : `/panel/statystyki?okres=${option}`}
                aria-current={option === days ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center rounded-full px-3.5 text-[12px] font-semibold whitespace-nowrap transition-colors lg:h-6 lg:px-3",
                  option === days
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground/70 hover:text-foreground",
                )}
              >
                {option} dni
              </Link>
            ))}
          </div>
          <a
            href={`/panel/statystyki/export?okres=${days}`}
            download
            className="flex h-11 items-center rounded-full border-[1.5px] border-border-strong bg-card px-4 text-[13px] font-semibold transition-colors hover:bg-muted lg:h-8"
          >
            Eksportuj CSV
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Przychód"
          value={formatPrice(revenueCents, currency)}
          sub="zakończone wizyty"
        />
        <StatTile
          label="Wizyty"
          value={visitsCount.toLocaleString("pl-PL")}
          sub={`odwołane: ${cancelledCount.toLocaleString("pl-PL")}`}
        />
        <StatTile
          label="Średnia wartość"
          value={completedCount > 0 ? formatPrice(avgCents, currency) : "—"}
          sub="na zakończoną wizytę"
        />
        <StatTile
          label="No-show rate"
          value={
            finishedCount > 0
              ? `${noShowRate.toLocaleString("pl-PL", { maximumFractionDigits: 1 })}%`
              : "—"
          }
          sub={
            finishedCount > 0
              ? `${noShowCount} z ${finishedCount} odbytych`
              : "brak odbytych wizyt"
          }
        />
      </div>

      <StatSection
        title="Przychód dzienny"
        aside={`suma: ${formatPrice(revenueCents, currency)}`}
        className="mt-4"
      >
        <StatsRevenueChart points={revenuePoints} currency={currency} />
      </StatSection>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <StatSection title="Obłożenie zespołu" aside="COMPLETED + CONFIRMED">
          <OccupancyList rows={occupancyRows} />
        </StatSection>
        <StatSection title="Top 5 usług" aside="wg przychodu">
          <TopServicesList rows={topServices} currency={currency} />
        </StatSection>
      </div>

      <StatSection
        title="Źródła rezerwacji"
        aside={`łącznie: ${marketplaceCount + manualCount}`}
        className="mt-4"
      >
        <SourcesSplit
          split={{ marketplace: marketplaceCount, manual: manualCount }}
        />
      </StatSection>
    </div>
  );
}
