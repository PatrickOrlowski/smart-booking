import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { localDayMinutesToUtc, utcToZonedWallClock } from "@/lib/time";
import { getPanelBusiness } from "@/app/panel/data";
import {
  DayGrid,
  type DayGridColumn,
} from "@/components/panel/day-grid";
import {
  AddBookingDialog,
  type BookingServiceOption,
  type BookingStaffOption,
} from "@/components/panel/add-booking-dialog";
import {
  TIME_OFF_LABELS,
  formatMinutes,
  formatPrice,
  parseDateParam,
  shiftDay,
  toDateParam,
  weekdayOf,
} from "@/components/panel/format";
import { CalendarViewToggle } from "@/components/panel/view-toggle";
import { Button } from "@/components/ui/button";
import { WeekView } from "./week-view";

/**
 * Kalendarz — widok dnia: kolumny per pracownik (Resource STAFF),
 * oś godzin z OpeningHours lokalizacji, bloki BookingItem w strefie lokalu.
 * `?widok=tydzien` przełącza na widok tygodnia (WeekView).
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string; widok?: string; pracownik?: string }>;
}) {
  const { data, widok, pracownik } = await searchParams;
  const panel = await getPanelBusiness();
  if (!panel) redirect("/panel/nowa");

  const { business, location, isManager } = panel;

  if (!location) {
    return (
      <EmptyState
        title="Brak lokalizacji"
        description="Firma nie ma jeszcze żadnej lokalizacji — bez niej kalendarz nie ma osi godzin."
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
  const day = parseDateParam(data) ?? today;

  if (widok === "tydzien") {
    return (
      <WeekView
        location={{
          id: location.id,
          addressLine1: location.addressLine1,
          city: location.city,
          timezone: tz,
          openWeekdays: [
            ...new Set(location.openingHours.map((block) => block.weekday)),
          ],
        }}
        day={day}
        today={today}
        staffParam={pracownik}
      />
    );
  }

  const isToday = toDateParam(day) === toDateParam(today);
  const weekday = weekdayOf(day);

  const openBlocks = location.openingHours.filter(
    (block) => block.weekday === weekday,
  );
  const isOpen = openBlocks.length > 0;
  const openMin = isOpen
    ? Math.min(...openBlocks.map((block) => block.startMinute))
    : 9 * 60;
  const closeMin = isOpen
    ? Math.max(...openBlocks.map((block) => block.endMinute))
    : 19 * 60;
  const axisStartMin = Math.floor(openMin / 60) * 60;
  const axisEndMin = Math.min(Math.ceil(closeMin / 60) * 60, 24 * 60);

  const dayStartUtc = localDayMinutesToUtc(day, 0, tz);
  const dayEndUtc = localDayMinutesToUtc(shiftDay(day, 1), 0, tz);
  const dayUtcNumber = Date.UTC(day.year, day.month - 1, day.day);

  const [staffResources, services] = await Promise.all([
    prisma.resource.findMany({
      where: { locationId: location.id, type: "STAFF", isActive: true },
      orderBy: { sortOrder: "asc" },
      include: {
        workingHours: true,
        timeOff: {
          where: { startAt: { lt: dayEndUtc }, endAt: { gt: dayStartUtc } },
        },
        bookingItems: {
          where: {
            blockedStartAt: { lt: dayEndUtc },
            blockedEndAt: { gt: dayStartUtc },
          },
          orderBy: { startAt: "asc" },
          include: {
            service: { select: { name: true } },
            booking: {
              select: {
                status: true,
                currency: true,
                guestName: true,
                user: { select: { name: true } },
                customer: { select: { fullName: true } },
              },
            },
          },
        },
      },
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

  /** Instant UTC → minuty czasu ściennego w obrębie wyświetlanego dnia. */
  const minutesInDay = (instant: Date): number => {
    if (instant.getTime() <= dayStartUtc.getTime()) return 0;
    if (instant.getTime() >= dayEndUtc.getTime()) return 24 * 60;
    const wall = utcToZonedWallClock(instant, tz);
    return wall.hour * 60 + wall.minute;
  };

  const columns: DayGridColumn[] = staffResources.map((resource) => {
    const workBlocks = resource.workingHours
      .filter(
        (row) =>
          row.weekday === weekday &&
          (row.validFrom === null || row.validFrom.getTime() <= dayUtcNumber) &&
          (row.validTo === null || row.validTo.getTime() >= dayUtcNumber),
      )
      .sort((a, b) => a.startMinute - b.startMinute)
      .map((row) => ({ startMin: row.startMinute, endMin: row.endMinute }));

    return {
      resourceId: resource.id,
      name: resource.name,
      hoursLabel:
        workBlocks.length > 0
          ? workBlocks
              .map(
                (block) =>
                  `${formatMinutes(block.startMin)}–${formatMinutes(block.endMin)}`,
              )
              .join(" · ")
          : "nie pracuje",
      workBlocks,
      timeOff: resource.timeOff.map((timeOff) => ({
        id: timeOff.id,
        startMin: minutesInDay(timeOff.startAt),
        endMin: minutesInDay(timeOff.endAt),
        label: timeOff.reason
          ? `${TIME_OFF_LABELS[timeOff.type]} · ${timeOff.reason}`
          : TIME_OFF_LABELS[timeOff.type],
      })),
      items: resource.bookingItems.map((item) => ({
        id: item.id,
        startMin: minutesInDay(item.startAt),
        endMin: minutesInDay(item.endAt),
        blockedStartMin: minutesInDay(item.blockedStartAt),
        blockedEndMin: minutesInDay(item.blockedEndAt),
        serviceName: item.service.name,
        clientName:
          item.booking.customer?.fullName ??
          item.booking.user?.name ??
          item.booking.guestName ??
          "Klient",
        status: item.booking.status,
        priceLabel: formatPrice(item.priceCents, item.booking.currency),
      })),
    };
  });

  const staffOptions: BookingStaffOption[] = staffResources.map((resource) => ({
    id: resource.id,
    name: resource.name,
  }));
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

  const titleFormatter = new Intl.DateTimeFormat("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const rawTitle = titleFormatter.format(
    new Date(Date.UTC(day.year, day.month - 1, day.day, 12)),
  );
  const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);

  const nowMin =
    isToday ? todayWall.hour * 60 + todayWall.minute : null;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border px-4 pt-5 pb-4 sm:px-6">
        <div className="min-w-0">
          <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight sm:text-[27px]">
            {title}
          </h1>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
            {location.addressLine1}, {location.city} ·{" "}
            {isOpen
              ? `otwarte ${formatMinutes(openMin)}–${formatMinutes(closeMin)}`
              : "zamknięte"}{" "}
            · {tz}
          </div>
        </div>
        <div className="flex gap-1.5 lg:ml-2">
          <Button
            asChild
            variant="outline"
            size="icon"
            className="size-11 lg:size-8"
            aria-label="Poprzedni dzień"
          >
            <Link href={`/panel?data=${toDateParam(shiftDay(day, -1))}`}>‹</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="default"
            className="h-11 px-4 font-semibold lg:h-8 lg:px-2.5"
          >
            <Link href="/panel">Dziś</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="icon"
            className="size-11 lg:size-8"
            aria-label="Następny dzień"
          >
            <Link href={`/panel?data=${toDateParam(shiftDay(day, 1))}`}>›</Link>
          </Button>
        </div>
        <CalendarViewToggle
          dayHref={`/panel?data=${toDateParam(day)}`}
          weekHref={`/panel?widok=tydzien&data=${toDateParam(day)}`}
          active="dzien"
        />
        <div className="ml-auto max-sm:fixed max-sm:right-4 max-sm:bottom-4 max-sm:z-40">
          {isManager && staffOptions.length > 0 && serviceOptions.length > 0 && (
            <AddBookingDialog
              businessId={business.id}
              staff={staffOptions}
              services={serviceOptions}
              openingHours={location.openingHours.map((block) => ({
                weekday: block.weekday,
                startMinute: block.startMinute,
                endMinute: block.endMinute,
              }))}
              defaultDate={toDateParam(day)}
              granularityMin={location.slotGranularityMin}
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border px-4 py-2.5 text-[11.5px] text-foreground/70 sm:px-6">
        <LegendSwatch className="bg-primary" label="Potwierdzona" />
        <LegendSwatch
          className="border-[1.5px] border-dashed border-warning bg-warning-soft"
          label="Oczekuje"
        />
        <LegendSwatch
          className="border border-destructive/40 bg-destructive/10"
          label="No-show"
        />
        <LegendSwatch className="photo-placeholder" label="Bufor" />
        <LegendSwatch
          className="border border-warning/50 bg-warning-soft"
          label="Urlop / blokada"
        />
        <span className="ml-auto hidden font-mono text-[11px] text-muted-foreground sm:block">
          godziny w strefie {tz}
        </span>
      </div>

      {staffResources.length === 0 ? (
        <EmptyState
          title="Brak pracowników"
          description="Dodaj pierwszą osobę w zakładce Zespół — każda dostaje własną kolumnę w kalendarzu."
          action={
            <Button asChild className="rounded-full px-5 font-semibold">
              <Link href="/panel/zespol">Przejdź do zespołu</Link>
            </Button>
          }
        />
      ) : !isOpen &&
        columns.every((column) => column.items.length === 0) ? (
        <EmptyState
          title="Lokal zamknięty"
          description="W ten dzień nie ma godzin otwarcia ani zaplanowanych wizyt."
        />
      ) : (
        <div className="pt-4">
          <DayGrid
            columns={columns}
            axisStartMin={axisStartMin}
            axisEndMin={axisEndMin}
            nowMin={nowMin}
          />
        </div>
      )}
    </div>
  );
}

function LegendSwatch({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-[11px] rounded-[3px] ${className}`} />
      {label}
    </span>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="max-w-md text-center">
        <h2 className="font-display text-3xl font-extrabold leading-none tracking-tight">
          {title}
        </h2>
        <p className="mt-3 mb-6 text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
        {action}
      </div>
    </div>
  );
}
