import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPanelBusiness } from "@/app/panel/data";
import { utcToZonedWallClock } from "@/lib/time";
import {
  SeriesStatusBadge,
  formatSeriesRule,
} from "@/components/panel/series-rule";
import { SeriesCreateDialog } from "@/components/panel/series-create-dialog";
import { toDateParam } from "@/components/panel/format";
import type {
  BookingServiceOption,
  BookingStaffOption,
} from "@/components/panel/add-booking-dialog";

/**
 * Rezerwacje cykliczne firmy: lista serii z regułą powtarzania, licznikiem
 * wizyt i statusem. Tworzenie serii siedzi w dialogu (podgląd terminów przed
 * zapisem), szczegóły i akcje — na stronie serii.
 */

const ACTIVE_STATUSES = ["PENDING", "CONFIRMED"] as const;

export default async function SeriesPage() {
  const panel = await getPanelBusiness();
  if (!panel) redirect("/panel/nowa");

  const { business, location, isManager } = panel;

  if (!location) {
    return (
      <EmptyShell
        title="Brak lokalizacji"
        description="Seria potrzebuje lokalizacji — bez niej nie ma strefy czasowej ani grafiku."
      />
    );
  }

  const tz = location.timezone;
  const todayWall = utcToZonedWallClock(new Date(), tz);
  const today = {
    year: todayWall.year,
    month: todayWall.month,
    day: todayWall.day,
  };

  const [seriesRows, staffResources, services] = await Promise.all([
    prisma.bookingSeries.findMany({
      where: { businessId: business.id },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        status: true,
        intervalWeeks: true,
        weekday: true,
        startMinute: true,
        startDate: true,
        endDate: true,
        occurrences: true,
        guestName: true,
        service: { select: { name: true } },
        resource: { select: { name: true } },
        customer: { select: { fullName: true } },
      },
    }),
    prisma.resource.findMany({
      where: { locationId: location.id, type: "STAFF", isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    prisma.service.findMany({
      where: { businessId: business.id, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        resources: {
          select: {
            resourceId: true,
            durationMinOverride: true,
            priceCentsOverride: true,
          },
        },
      },
    }),
  ]);

  const ids = seriesRows.map((row) => row.id);
  const bookings = ids.length
    ? await prisma.booking.findMany({
        where: { businessId: business.id, seriesId: { in: ids } },
        select: { seriesId: true, status: true, startAt: true },
      })
    : [];

  const now = new Date();
  const stats = new Map<
    string,
    { total: number; upcoming: number; nextAt: Date | null }
  >();
  for (const booking of bookings) {
    if (!booking.seriesId) continue;
    const entry = stats.get(booking.seriesId) ?? {
      total: 0,
      upcoming: 0,
      nextAt: null,
    };
    entry.total += 1;
    const isActive = (ACTIVE_STATUSES as readonly string[]).includes(
      booking.status,
    );
    if (isActive && booking.startAt.getTime() > now.getTime()) {
      entry.upcoming += 1;
      if (!entry.nextAt || booking.startAt < entry.nextAt) {
        entry.nextAt = booking.startAt;
      }
    }
    stats.set(booking.seriesId, entry);
  }

  const staff: BookingStaffOption[] = staffResources;
  const serviceOptions: BookingServiceOption[] = services.map((service) => ({
    id: service.id,
    name: service.name,
    durationMin: service.durationMin,
    priceCents: service.priceCents,
    priceType: service.priceType,
    currency: service.currency,
    overrides: service.resources.map((entry) => ({
      resourceId: entry.resourceId,
      durationMin: entry.durationMinOverride,
      priceCents: entry.priceCentsOverride,
    })),
  }));

  const dateFormatter = new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: tz,
  });
  /** Kolumny @db.Date trzymają północ UTC — formatujemy je bez strefy lokalu. */
  const dayFormatter = new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });

  const canCreate = isManager && staff.length > 0 && serviceOptions.length > 0;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[22px] leading-tight font-extrabold tracking-tight sm:text-[27px]">
            Serie
          </h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Rezerwacje cykliczne — ten sam klient, ten sam termin co kilka
            tygodni. Godzina trzyma się czasu lokalnego również po zmianie
            czasu.
          </p>
        </div>
        {canCreate ? (
          <SeriesCreateDialog
            businessId={business.id}
            staff={staff}
            services={serviceOptions}
            openingHours={location.openingHours.map((block) => ({
              weekday: block.weekday,
              startMinute: block.startMinute,
              endMinute: block.endMinute,
            }))}
            defaultDate={toDateParam(today)}
            granularityMin={location.slotGranularityMin}
          />
        ) : null}
      </div>

      {seriesRows.length === 0 ? (
        <EmptyState canCreate={canCreate} isManager={isManager} />
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-border bg-card">
          {seriesRows.map((row) => {
            const entry = stats.get(row.id);
            const total = entry?.total ?? 0;
            const upcoming = entry?.upcoming ?? 0;
            const planned = row.occurrences ?? total;
            const clientName =
              row.customer?.fullName ?? row.guestName ?? "Klient";

            return (
              <li key={row.id} className="border-t border-border first:border-t-0">
                <Link
                  href={`/panel/serie/${row.id}`}
                  className="flex flex-col gap-2 px-4 py-3.5 transition-colors hover:bg-muted/40 sm:px-5 md:flex-row md:items-center md:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[14.5px] font-semibold">
                        {clientName}
                      </span>
                      <SeriesStatusBadge status={row.status} />
                    </div>
                    <div className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
                      {row.service.name} · {row.resource.name}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-foreground/80">
                      {formatSeriesRule(row)}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground md:flex-col md:items-end md:gap-0.5">
                    <span className="font-semibold text-foreground">
                      {total} z {planned} wizyt
                    </span>
                    <span>
                      {upcoming > 0
                        ? `${upcoming} nadchodzących`
                        : "brak nadchodzących"}
                    </span>
                    <span>
                      {entry?.nextAt
                        ? `najbliższa ${dateFormatter.format(entry.nextAt)}`
                        : `start ${dayFormatter.format(row.startDate)}`}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EmptyState({
  canCreate,
  isManager,
}: {
  canCreate: boolean;
  isManager: boolean;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
      <h2 className="font-display text-[20px] font-extrabold tracking-tight">
        Brak serii cyklicznych
      </h2>
      <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-muted-foreground">
        {canCreate
          ? "Stały klient co 4 tygodnie o tej samej godzinie? Utwórz serię — wizyty powstaną od razu, a kolidujące terminy zostaną pominięte i wypisane."
          : isManager
            ? "Najpierw dodaj pracownika i usługę — bez nich nie ma czego powtarzać."
            : "Serie zakłada właściciel albo menedżer firmy."}
      </p>
    </div>
  );
}

function EmptyShell({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
        <h2 className="font-display text-[20px] font-extrabold tracking-tight">
          {title}
        </h2>
        <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}
