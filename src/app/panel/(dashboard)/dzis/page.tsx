import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPanelBusiness } from "@/app/panel/data";
import { localDayMinutesToUtc, utcToZonedWallClock } from "@/lib/time";
import { Button } from "@/components/ui/button";
import {
  formatMinutes,
  parseDateParam,
  shiftDay,
  toDateParam,
  weekdayOf,
} from "@/components/panel/format";
import {
  HostDayView,
} from "@/components/panel/host-day-view";
import type { HostBooking } from "@/components/panel/host-booking-list";
import type { HostRoom } from "@/components/panel/host-floor-plan";
import {
  HostWalkInDialog,
  type TurnTimeRuleView,
  type WalkInTableOption,
} from "@/components/panel/host-walkin-dialog";
import {
  WaitlistBoard,
  type WaitlistEntryView,
} from "@/components/panel/waitlist-board";
import type {
  ConvertTableOption,
  TableOccupancy,
} from "@/components/panel/waitlist-convert-dialog";

/**
 * Widok hosta restauracji — „Dziś".
 *
 * Lewa kolumna: rezerwacje dnia z akcjami (potwierdź / posadź / nie przyszli /
 * odwołaj). Prawa: plan sali ze statusem każdego stolika w wybranej chwili.
 * Niżej lista oczekujących. Salon (firma niebędąca restauracją) wraca
 * do kalendarza — ten widok nie ma dla niego sensu.
 *
 * Wszystkie instanty z bazy (UTC) przeliczamy tu raz na minuty czasu ściennego
 * lokalu przez `src/lib/time.ts`; komponenty klienckie dostają już liczby.
 */

const DAY_MIN = 24 * 60;

export default async function HostTodayPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string }>;
}) {
  const { data } = await searchParams;
  const panel = await getPanelBusiness();
  if (!panel) redirect("/panel/nowa");

  const { business, location, isManager } = panel;
  if (business.type !== "RESTAURANT") redirect("/panel");

  if (!location) {
    return (
      <EmptyState
        title="Brak lokalizacji"
        description="Widok hosta potrzebuje lokalu z godzinami otwarcia i planem sali."
      />
    );
  }

  const tz = location.timezone;
  const nowWall = utcToZonedWallClock(new Date(), tz);
  const today = {
    year: nowWall.year,
    month: nowWall.month,
    day: nowWall.day,
  };
  const day = parseDateParam(data) ?? today;
  const isToday = toDateParam(day) === toDateParam(today);
  const nowMin = isToday ? nowWall.hour * 60 + nowWall.minute : null;

  const weekday = weekdayOf(day);
  const openBlocks = location.openingHours.filter(
    (block) => block.weekday === weekday,
  );
  const isOpen = openBlocks.length > 0;
  const openMin = isOpen
    ? Math.min(...openBlocks.map((block) => block.startMinute))
    : 12 * 60;
  const closeMin = isOpen
    ? Math.max(...openBlocks.map((block) => block.endMinute))
    : 22 * 60;

  const dayStartUtc = localDayMinutesToUtc(day, 0, tz);
  const dayEndUtc = localDayMinutesToUtc(shiftDay(day, 1), 0, tz);

  const [rooms, orphanTables, bookingRows, waitlistRows, turnTimeRows] =
    await Promise.all([
      prisma.room.findMany({
        where: { locationId: location.id, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          tables: {
            where: { type: "TABLE", isActive: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      }),
      prisma.resource.findMany({
        where: {
          locationId: location.id,
          type: "TABLE",
          isActive: true,
          roomId: null,
        },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.booking.findMany({
        where: {
          locationId: location.id,
          startAt: { lt: dayEndUtc },
          endAt: { gt: dayStartUtc },
          status: { in: ["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW"] },
        },
        orderBy: { startAt: "asc" },
        include: {
          items: {
            orderBy: { startAt: "asc" },
            include: {
              resource: {
                select: {
                  id: true,
                  type: true,
                  name: true,
                  tableNumber: true,
                },
              },
            },
          },
          customer: { select: { fullName: true, phone: true } },
          user: { select: { name: true } },
        },
      }),
      prisma.waitlistEntry.findMany({
        where: {
          locationId: location.id,
          status: { in: ["WAITING", "NOTIFIED"] },
          requestedAt: { gte: dayStartUtc, lt: dayEndUtc },
        },
        orderBy: { requestedAt: "asc" },
        include: {
          customer: { select: { fullName: true, phone: true, email: true } },
          user: { select: { name: true, email: true } },
        },
      }),
      prisma.turnTimeRule.findMany({
        where: { locationId: location.id },
        orderBy: { partySizeMin: "asc" },
        select: {
          partySizeMin: true,
          partySizeMax: true,
          durationMin: true,
        },
      }),
    ]);

  // Godzina posadzenia gości mieszka w audycie (schemat nie ma pola seatedAt).
  const seatedLogs =
    bookingRows.length > 0
      ? await prisma.auditLog.findMany({
          where: {
            businessId: business.id,
            action: "BOOKING_SEATED",
            entityType: "Booking",
            entityId: { in: bookingRows.map((booking) => booking.id) },
          },
          orderBy: { createdAt: "asc" },
          select: { entityId: true, createdAt: true },
        })
      : [];
  const seatedAtByBooking = new Map<string, Date>();
  for (const log of seatedLogs) seatedAtByBooking.set(log.entityId, log.createdAt);

  /** Instant UTC → minuty czasu ściennego w obrębie wyświetlanego dnia. */
  const minutesInDay = (instant: Date): number => {
    if (instant.getTime() <= dayStartUtc.getTime()) return 0;
    if (instant.getTime() >= dayEndUtc.getTime()) return DAY_MIN;
    const wall = utcToZonedWallClock(instant, tz);
    return wall.hour * 60 + wall.minute;
  };

  const hostRooms: HostRoom[] = [
    ...rooms.map((room) => ({
      id: room.id,
      name: room.name,
      gridWidth: room.gridWidth,
      gridHeight: room.gridHeight,
      tables: room.tables.map((table) => ({
        id: table.id,
        number: table.tableNumber ?? table.name,
        name: table.name,
        capacityMin: table.capacityMin,
        capacityMax: table.capacityMax,
        area: table.area,
        shape: table.shape,
        posX: table.posX,
        posY: table.posY,
        spanX: table.spanX ?? 2,
        spanY: table.spanY ?? 2,
      })),
    })),
    ...(orphanTables.length > 0
      ? [
          {
            id: "bez-sali",
            name: "Bez sali",
            gridWidth: 20,
            gridHeight: 14,
            tables: orphanTables.map((table) => ({
              id: table.id,
              number: table.tableNumber ?? table.name,
              name: table.name,
              capacityMin: table.capacityMin,
              capacityMax: table.capacityMax,
              area: table.area,
              shape: table.shape,
              posX: table.posX,
              posY: table.posY,
              spanX: table.spanX ?? 2,
              spanY: table.spanY ?? 2,
            })),
          },
        ]
      : []),
  ];

  const bookings: HostBooking[] = bookingRows.map((booking) => {
    const tableItems = booking.items.filter(
      (item) => item.resource.type === "TABLE",
    );
    const items = tableItems.length > 0 ? tableItems : booking.items;
    const startMin = minutesInDay(booking.startAt);
    const endMin = Math.max(
      startMin,
      ...items.map((item) => minutesInDay(item.endAt)),
      minutesInDay(booking.endAt),
    );
    const blockedEndMin = Math.max(
      endMin,
      ...items.map((item) => minutesInDay(item.blockedEndAt)),
    );
    const seatedAt = seatedAtByBooking.get(booking.id) ?? null;

    return {
      id: booking.id,
      startMin,
      endMin,
      blockedEndMin,
      tableIds: tableItems.map((item) => item.resource.id),
      tablesLabel: tableItems
        .map((item) => `stolik ${item.resource.tableNumber ?? item.resource.name}`)
        .join(" + "),
      guestName:
        booking.customer?.fullName ??
        booking.user?.name ??
        booking.guestName ??
        "Gość",
      guestPhone: booking.guestPhone ?? booking.customer?.phone ?? null,
      partySize: booking.partySize,
      status: booking.status,
      source: booking.source,
      customerNote: booking.customerNote,
      internalNote: booking.internalNote,
      blocking:
        booking.status === "PENDING" ||
        booking.status === "CONFIRMED" ||
        booking.status === "COMPLETED",
      // Etykieta opisuje stan bieżący, nie historię: gdy rezerwacja wróciła
      // do PENDING/CONFIRMED, „posadzeni" byłoby kłamstwem.
      seatedAtLabel:
        seatedAt && booking.status === "COMPLETED"
          ? formatMinutes(minutesInDay(seatedAt))
          : null,
    };
  });

  const occupancy: TableOccupancy[] = bookings
    .filter((booking) => booking.blocking)
    .flatMap((booking) =>
      booking.tableIds.map((tableId) => ({
        tableId,
        startMin: booking.startMin,
        blockedEndMin: booking.blockedEndMin,
      })),
    );

  const flatTables = hostRooms.flatMap((room) =>
    room.tables.map((table) => ({ ...table, roomName: room.name })),
  );

  const convertTables: ConvertTableOption[] = flatTables.map((table) => ({
    id: table.id,
    number: table.number,
    roomName: table.roomName,
    capacityMin: table.capacityMin,
    capacityMax: table.capacityMax,
  }));

  // Stan stolików „teraz" na potrzeby dialogu walk-in (podgląd godziny
  // w planie sali przestawia wyłącznie widok, nie tę listę).
  const walkInTables: WalkInTableOption[] = flatTables.map((table) => {
    const minute = nowMin ?? -1;
    const conflict = bookings.find(
      (booking) =>
        booking.blocking &&
        booking.tableIds.includes(table.id) &&
        booking.startMin <= minute &&
        minute < booking.blockedEndMin,
    );
    return {
      id: table.id,
      number: table.number,
      roomName: table.roomName,
      capacityMin: table.capacityMin,
      capacityMax: table.capacityMax,
      busy: conflict !== undefined,
      busyLabel: conflict
        ? conflict.endMin <= minute
          ? `sprzątanie do ${formatMinutes(conflict.blockedEndMin)}`
          : `zajęty do ${formatMinutes(conflict.endMin)}`
        : null,
    };
  });

  const now = new Date();
  const waitlist: WaitlistEntryView[] = waitlistRows.map((entry) => {
    const expired =
      entry.status === "NOTIFIED" &&
      entry.holdUntil !== null &&
      entry.holdUntil.getTime() <= now.getTime();
    return {
      id: entry.id,
      guestName:
        entry.guestName ??
        entry.customer?.fullName ??
        entry.user?.name ??
        "Gość",
      partySize: entry.partySize,
      requestedMin: minutesInDay(entry.requestedAt),
      flexMin: entry.flexMin,
      phone: entry.guestPhone ?? entry.customer?.phone ?? null,
      email: entry.guestEmail ?? entry.customer?.email ?? entry.user?.email ?? null,
      note: entry.note,
      view: expired
        ? "expired"
        : entry.status === "NOTIFIED"
          ? "notified"
          : "waiting",
      holdUntilLabel: entry.holdUntil
        ? formatMinutes(minutesInDay(entry.holdUntil))
        : null,
    };
  });

  const turnTimeRules: TurnTimeRuleView[] = turnTimeRows;

  const covers = bookings
    .filter((booking) => booking.status !== "NO_SHOW")
    .reduce((sum, booking) => sum + (booking.partySize ?? 0), 0);
  const pendingCount = bookings.filter(
    (booking) => booking.status === "PENDING",
  ).length;

  const titleFormatter = new Intl.DateTimeFormat("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const rawTitle = titleFormatter.format(
    new Date(Date.UTC(day.year, day.month - 1, day.day, 12)),
  );
  const dayTitle = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);

  const walkInOpen =
    isToday && isOpen && nowMin !== null && nowMin < closeMin;
  const walkInStartLabel =
    nowMin !== null && nowMin >= openMin
      ? `teraz (${formatMinutes(nowMin)})`
      : `od otwarcia (${formatMinutes(openMin)})`;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border px-4 pt-5 pb-4 sm:px-6">
        <div className="min-w-0">
          <h1 className="font-display text-[22px] leading-tight font-extrabold tracking-tight sm:text-[27px]">
            {isToday ? "Dziś" : dayTitle}
          </h1>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
            {isToday ? `${dayTitle} · ` : ""}
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
            <Link href={`/panel/dzis?data=${toDateParam(shiftDay(day, -1))}`}>
              ‹
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="h-11 px-4 font-semibold lg:h-8 lg:px-2.5"
          >
            <Link href="/panel/dzis">Dziś</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="icon"
            className="size-11 lg:size-8"
            aria-label="Następny dzień"
          >
            <Link href={`/panel/dzis?data=${toDateParam(shiftDay(day, 1))}`}>
              ›
            </Link>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
          <Stat value={bookings.length} label="rezerwacji" />
          <Stat value={covers} label="gości" />
          <Stat value={pendingCount} label="do potwierdzenia" />
          <Stat value={waitlist.length} label="w kolejce" />
        </div>

        {isManager && walkInTables.length > 0 ? (
          <div className="ml-auto max-sm:fixed max-sm:right-4 max-sm:bottom-4 max-sm:z-40">
            <HostWalkInDialog
              businessId={business.id}
              tables={walkInTables}
              turnTimeRules={turnTimeRules}
              defaultTurnTimeMin={location.defaultTurnTimeMin}
              startLabel={walkInStartLabel}
              disabled={!walkInOpen}
            />
          </div>
        ) : null}
      </div>

      {hostRooms.length === 0 ? (
        <EmptyState
          title="Brak stolików"
          description="Ten lokal nie ma jeszcze planu sali — dodaj sale i stoliki, żeby widok hosta pokazał zajętość."
        />
      ) : (
        /* pb-24 na telefonie: pływający przycisk „Gość z ulicy" nie może
           zasłaniać akcji ostatniej karty listy oczekujących. */
        <div className="flex flex-col gap-6 px-4 py-5 pb-24 sm:px-6 sm:pb-5">
          <HostDayView
            businessId={business.id}
            rooms={hostRooms}
            bookings={bookings}
            canManage={isManager}
            isToday={isToday}
            nowMin={nowMin}
            openMin={openMin}
            closeMin={closeMin}
            timezone={tz}
          />

          <WaitlistBoard
            businessId={business.id}
            entries={waitlist}
            tables={convertTables}
            occupancy={occupancy}
            turnTimeRules={turnTimeRules}
            defaultTurnTimeMin={location.defaultTurnTimeMin}
            tableBufferMin={location.tableBufferMin}
            openMin={openMin}
            closeMin={closeMin}
            canManage={isManager}
          />
        </div>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="font-display text-[17px] font-extrabold tracking-tight text-foreground">
        {value}
      </span>
      {label}
    </span>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="max-w-md text-center">
        <h2 className="font-display text-3xl leading-none font-extrabold tracking-tight">
          {title}
        </h2>
        <p className="mt-3 mb-6 text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}
