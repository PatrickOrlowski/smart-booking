import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { localDayMinutesToUtc, utcToZonedWallClock } from "@/lib/time";
import {
  WeekGrid,
  type WeekGridDay,
  type WeekGridItem,
} from "@/components/panel/week-grid";
import { StaffFilter } from "@/components/panel/staff-filter";
import { CalendarViewToggle } from "@/components/panel/view-toggle";
import {
  WEEKDAY_SHORT,
  formatMinutes,
  shiftDay,
  toDateParam,
  weekdayOf,
} from "@/components/panel/format";
import { Button } from "@/components/ui/button";

/**
 * Kalendarz — widok tygodnia (pn–nd): kolumna per dzień ze skróconymi
 * kartami wizyt, sumą wizyt i przychodu w stopce, filtrem per pracownik.
 * Renderowany przez stronę kalendarza przy `?widok=tydzien`.
 */

type CalendarDay = { year: number; month: number; day: number };

/** Odwołane wizyty nie liczą się do sumy wizyt ani przychodu. */
const CANCELLED_STATUSES = new Set<string>([
  "CANCELLED_BY_CUSTOMER",
  "CANCELLED_BY_BUSINESS",
]);
/** No-show nie generuje przychodu, ale pozostaje wizytą w stopce. */
const REVENUE_STATUSES = new Set<string>(["PENDING", "CONFIRMED", "COMPLETED"]);

/** Nagłówek zakresu tygodnia, np. "20–26 lipca 2026". */
function weekTitle(start: CalendarDay, end: CalendarDay): string {
  const startDate = new Date(
    Date.UTC(start.year, start.month - 1, start.day, 12),
  );
  const endDate = new Date(Date.UTC(end.year, end.month - 1, end.day, 12));
  const full = new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  if (start.year !== end.year) {
    return `${full.format(startDate)} – ${full.format(endDate)}`;
  }
  if (start.month !== end.month) {
    const dayMonth = new Intl.DateTimeFormat("pl-PL", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    });
    return `${dayMonth.format(startDate)} – ${full.format(endDate)}`;
  }
  return `${start.day}–${full.format(endDate)}`;
}

export async function WeekView({
  location,
  day,
  today,
  staffParam,
}: {
  location: {
    id: string;
    addressLine1: string;
    city: string;
    timezone: string;
    /** Dni tygodnia (0 = pn) z godzinami otwarcia — reszta to „zamknięte". */
    openWeekdays: number[];
  };
  day: CalendarDay;
  today: CalendarDay;
  staffParam: string | undefined;
}) {
  const tz = location.timezone;
  const weekStart = shiftDay(day, -weekdayOf(day));
  const weekDays = Array.from({ length: 7 }, (_, index) =>
    shiftDay(weekStart, index),
  );
  const weekStartUtc = localDayMinutesToUtc(weekStart, 0, tz);
  const weekEndUtc = localDayMinutesToUtc(shiftDay(weekStart, 7), 0, tz);

  const staff = await prisma.resource.findMany({
    where: { locationId: location.id, type: "STAFF", isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });
  // Filtr z URL weryfikowany względem zespołu — obcy id działa jak "wszyscy".
  const staffId = staff.some((member) => member.id === staffParam)
    ? staffParam!
    : null;

  const items = await prisma.bookingItem.findMany({
    where: {
      // `isActive` jak w widoku dnia — inaczej tydzień liczy wizyty
      // pracownika, którego dzień w ogóle nie renderuje.
      resource: { locationId: location.id, type: "STAFF", isActive: true },
      ...(staffId ? { resourceId: staffId } : {}),
      // Zakres po indeksowanej parze blocked* (jak w widoku dnia) — kolumna
      // `start_at` nie ma indeksu, więc filtr po niej skanował całą historię.
      blockedStartAt: { lt: weekEndUtc },
      blockedEndAt: { gt: weekStartUtc },
    },
    orderBy: { startAt: "asc" },
    include: {
      service: { select: { name: true } },
      resource: { select: { name: true } },
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
  });

  /** Rezerwacja (nie pozycja!) w kolumnie dnia — jedna karta na wizytę. */
  type DayBooking = {
    bookingId: string;
    timeLabel: string;
    clientName: string;
    status: WeekGridItem["status"];
    services: string[];
    resources: string[];
  };

  // Rezerwacja z dwiema usługami to nadal jedna wizyta: grupujemy pozycje
  // po `bookingId`, inaczej stopka pokazywała „2 wizyty", a kolumna dwie
  // karty tego samego klienta.
  const grouped = new Map<
    string,
    { bookings: Map<string, DayBooking>; revenueByCurrency: Map<string, number> }
  >();
  for (const item of items) {
    const wall = utcToZonedWallClock(item.startAt, tz);
    const key = toDateParam(wall);
    let bucket = grouped.get(key);
    if (!bucket) {
      bucket = { bookings: new Map(), revenueByCurrency: new Map() };
      grouped.set(key, bucket);
    }
    const clientName =
      item.booking.customer?.fullName ??
      item.booking.user?.name ??
      item.booking.guestName ??
      "Klient";

    const existing = bucket.bookings.get(item.bookingId);
    if (existing) {
      // Pozycje idą po `startAt` rosnąco — pierwsza wyznacza godzinę karty.
      if (!existing.services.includes(item.service.name)) {
        existing.services.push(item.service.name);
      }
      if (!existing.resources.includes(item.resource.name)) {
        existing.resources.push(item.resource.name);
      }
    } else {
      bucket.bookings.set(item.bookingId, {
        bookingId: item.bookingId,
        timeLabel: formatMinutes(wall.hour * 60 + wall.minute),
        clientName,
        status: item.booking.status,
        services: [item.service.name],
        resources: [item.resource.name],
      });
    }

    if (REVENUE_STATUSES.has(item.booking.status)) {
      const currency = item.booking.currency;
      bucket.revenueByCurrency.set(
        currency,
        (bucket.revenueByCurrency.get(currency) ?? 0) + item.priceCents,
      );
    }
  }

  const todayParam = toDateParam(today);
  const openWeekdays = new Set(location.openWeekdays);
  const days: WeekGridDay[] = weekDays.map((weekDay, index) => {
    const key = toDateParam(weekDay);
    const bucket = grouped.get(key);
    const bookings = [...(bucket?.bookings.values() ?? [])];
    return {
      dateParam: key,
      weekdayLabel: WEEKDAY_SHORT[index]!,
      dateLabel: `${String(weekDay.day).padStart(2, "0")}.${String(weekDay.month).padStart(2, "0")}`,
      isToday: key === todayParam,
      isClosed: !openWeekdays.has(index),
      items: bookings.map((booking) => ({
        id: booking.bookingId,
        timeLabel: booking.timeLabel,
        clientName: booking.clientName,
        serviceName: booking.services.join(" + "),
        status: booking.status,
        tooltip: `${booking.clientName} · ${booking.services.join(" + ")} · ${booking.resources.join(", ")}`,
      })),
      visitsCount: bookings.filter(
        (booking) => !CANCELLED_STATUSES.has(booking.status),
      ).length,
      // Waluta per rezerwacja — sumowanie groszy z różnych walut pod jedną
      // etykietą dawało „300,00 €" dla 100 EUR + 200 PLN.
      revenue: [...(bucket?.revenueByCurrency ?? new Map())]
        .filter(([, cents]) => cents > 0)
        .map(([currency, cents]) => ({ currency, cents })),
    };
  });

  const weekHref = (target: CalendarDay) => {
    const params = new URLSearchParams({
      widok: "tydzien",
      data: toDateParam(target),
    });
    if (staffId) params.set("pracownik", staffId);
    return `/panel?${params.toString()}`;
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border px-4 pt-5 pb-4 sm:px-6">
        <div className="min-w-0">
          <h1 className="font-display text-[22px] leading-tight font-extrabold tracking-tight sm:text-[27px]">
            {weekTitle(weekDays[0]!, weekDays[6]!)}
          </h1>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
            {location.addressLine1}, {location.city} · {tz}
          </div>
        </div>
        <div className="flex gap-1.5 lg:ml-2">
          <Button
            asChild
            variant="outline"
            size="icon"
            className="size-11 lg:size-8"
            aria-label="Poprzedni tydzień"
          >
            <Link href={weekHref(shiftDay(day, -7))}>‹</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="default"
            className="h-11 px-4 font-semibold lg:h-8 lg:px-2.5"
          >
            <Link href={weekHref(today)}>Dziś</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="icon"
            className="size-11 lg:size-8"
            aria-label="Następny tydzień"
          >
            <Link href={weekHref(shiftDay(day, 7))}>›</Link>
          </Button>
        </div>
        <div className="ml-auto">
          <CalendarViewToggle
            dayHref={`/panel?data=${toDateParam(day)}`}
            weekHref={weekHref(day)}
            active="tydzien"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5 sm:px-6">
        <span className="meta-label">Pracownik</span>
        <StaffFilter
          staff={staff}
          value={staffId ?? "all"}
          dateParam={toDateParam(day)}
        />
        <span className="ml-auto hidden font-mono text-[11px] text-muted-foreground sm:block">
          godziny w strefie {tz}
        </span>
      </div>

      <div className="pt-4">
        <WeekGrid days={days} />
      </div>
    </div>
  );
}
