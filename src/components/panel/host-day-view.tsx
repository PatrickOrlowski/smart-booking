"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  HostFloorPlan,
  STATUS_SWATCH,
  TABLE_STATUS_LABELS,
  type HostRoom,
  type TableState,
  type TableStatus,
} from "@/components/panel/host-floor-plan";
import {
  HostBookingList,
  type HostBooking,
} from "@/components/panel/host-booking-list";
import { formatMinutes } from "@/components/panel/format";
import { cn } from "@/lib/utils";

/**
 * Widok hosta „Dziś": lista rezerwacji + plan sali na żywo.
 *
 * Cała arytmetyka czasu dzieje się na minutach od północy czasu lokalu —
 * serwer przeliczył instanty z bazy przez `src/lib/time.ts`, więc przeglądarka
 * nigdy nie dotyka stref czasowych. „Teraz" odświeża się co pół minuty
 * o czas, który upłynął od renderu (bez czytania zegara z dat bazy).
 */

const STATUS_RANK: Record<TableStatus, number> = {
  free: 0,
  reserved: 1,
  cleaning: 2,
  occupied: 3,
};

const DAY_MIN = 24 * 60;

export function HostDayView({
  businessId,
  rooms,
  bookings,
  canManage,
  isToday,
  nowMin,
  openMin,
  closeMin,
  timezone,
}: {
  businessId: string;
  rooms: HostRoom[];
  bookings: HostBooking[];
  canManage: boolean;
  isToday: boolean;
  /** Minuta „teraz" w strefie lokalu w chwili renderu; null dla innego dnia. */
  nowMin: number | null;
  openMin: number;
  closeMin: number;
  timezone: string;
}) {
  // Podgląd: null = „teraz" (tylko dziś), liczba = wybrana godzina.
  const [selected, setSelected] = useState<number | null>(
    isToday ? null : Math.min(Math.max(19 * 60, openMin), closeMin),
  );
  const renderedAtRef = useRef<number | null>(null);
  const [elapsedMin, setElapsedMin] = useState(0);

  // Zegar tylko po stronie efektu — render zostaje czysty (i identyczny
  // z SSR), a „teraz" dogania rzeczywistość co pół minuty.
  useEffect(() => {
    if (nowMin === null) return;
    renderedAtRef.current = Date.now();
    const timer = setInterval(() => {
      const renderedAt = renderedAtRef.current;
      if (renderedAt === null) return;
      setElapsedMin(Math.floor((Date.now() - renderedAt) / 60_000));
    }, 30_000);
    return () => clearInterval(timer);
  }, [nowMin]);

  const liveNowMin =
    nowMin === null ? null : Math.min(nowMin + elapsedMin, DAY_MIN);
  const viewMin =
    selected ?? liveNowMin ?? Math.min(Math.max(19 * 60, openMin), closeMin);
  const viewLabel = formatMinutes(Math.min(viewMin, DAY_MIN - 1));

  const hourPills = useMemo(() => {
    const first = Math.floor(openMin / 60) * 60;
    const pills: number[] = [];
    for (let minute = first; minute <= closeMin; minute += 60) {
      pills.push(minute);
    }
    return pills;
  }, [openMin, closeMin]);

  const states = useMemo(() => {
    const map = new Map<string, TableState>();
    for (const booking of bookings) {
      if (!booking.blocking) continue;
      const range = `${formatMinutes(booking.startMin)}–${formatMinutes(booking.endMin)}`;
      const party =
        booking.partySize !== null ? `${booking.partySize} os.` : "—";
      const detail = `${booking.guestName} · ${party} · ${range}`;

      let candidate: TableState | null = null;
      if (booking.startMin <= viewMin && viewMin < booking.endMin) {
        candidate = {
          status: "occupied",
          detail,
          timeLabel: `do ${formatMinutes(booking.endMin)}`,
        };
      } else if (
        booking.endMin <= viewMin &&
        viewMin < booking.blockedEndMin
      ) {
        candidate = {
          status: "cleaning",
          detail: `${detail} — sprzątanie do ${formatMinutes(booking.blockedEndMin)}`,
          timeLabel: `do ${formatMinutes(booking.blockedEndMin)}`,
        };
      } else if (booking.startMin > viewMin) {
        candidate = {
          status: "reserved",
          detail,
          timeLabel: formatMinutes(booking.startMin),
        };
      }
      if (!candidate) continue;

      for (const tableId of booking.tableIds) {
        const existing = map.get(tableId);
        // Rezerwacje są posortowane po godzinie, więc przy równym statusie
        // wygrywa ta wcześniejsza — host widzi najbliższe zdarzenie.
        if (
          !existing ||
          STATUS_RANK[candidate.status] > STATUS_RANK[existing.status]
        ) {
          map.set(tableId, candidate);
        }
      }
    }
    return map;
  }, [bookings, viewMin]);

  const tableCount = rooms.reduce((sum, room) => sum + room.tables.length, 0);
  const occupiedCount = rooms.reduce(
    (sum, room) =>
      sum +
      room.tables.filter((table) => states.get(table.id)?.status === "occupied")
        .length,
    0,
  );
  const freeCount = tableCount - occupiedCount;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="meta-label">podgląd sali</span>
          <span className="font-mono text-[13px] font-medium">
            {selected === null && isToday ? `teraz · ${viewLabel}` : viewLabel}
          </span>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            {occupiedCount}/{tableCount} zajętych · {freeCount} wolnych
          </span>
        </div>

        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none] sm:-mx-4 sm:px-4 [&::-webkit-scrollbar]:hidden">
          {isToday ? (
            <PillButton
              active={selected === null}
              onClick={() => setSelected(null)}
            >
              teraz
            </PillButton>
          ) : null}
          {hourPills.map((minute) => (
            <PillButton
              key={minute}
              active={selected === minute}
              onClick={() => setSelected(minute)}
            >
              {formatMinutes(minute)}
            </PillButton>
          ))}
        </div>

        <label className="flex items-center gap-3">
          <span className="sr-only">Godzina podglądu planu sali</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {formatMinutes(openMin)}
          </span>
          <input
            type="range"
            min={openMin}
            max={closeMin}
            step={15}
            value={Math.min(Math.max(viewMin, openMin), closeMin)}
            onChange={(event) => setSelected(Number(event.target.value))}
            className="h-11 min-w-0 flex-1 accent-primary lg:h-6"
            aria-label="Godzina podglądu planu sali"
          />
          <span className="font-mono text-[10px] text-muted-foreground">
            {formatMinutes(closeMin)}
          </span>
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] xl:grid-cols-[minmax(340px,0.8fr)_minmax(0,1fr)]">
        <div className="order-2 flex flex-col gap-3 lg:order-1">
          <div className="flex items-baseline gap-2">
            <h2 className="font-display text-[17px] font-extrabold tracking-tight">
              Rezerwacje
            </h2>
            <span className="meta-label">{bookings.length} na liście</span>
          </div>
          <HostBookingList
            businessId={businessId}
            bookings={bookings}
            canManage={canManage}
            isToday={isToday}
            nowMin={liveNowMin}
            viewMin={viewMin}
          />
        </div>

        <div className="order-1 flex flex-col gap-4 lg:order-2 lg:sticky lg:top-4 lg:self-start">
          {/* Na tablecie sale stają obok siebie — inaczej plan spycha listę
              rezerwacji poza pierwszy ekran. */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1">
            {rooms.map((room) => (
              <HostFloorPlan
                key={room.id}
                room={room}
                states={states}
                selectedLabel={
                  selected === null && isToday ? `teraz ${viewLabel}` : viewLabel
                }
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-foreground/70">
            {(
              ["free", "reserved", "occupied", "cleaning"] as TableStatus[]
            ).map((status) => (
              <span key={status} className="flex items-center gap-1.5">
                <span
                  className={cn("size-[11px] rounded-[3px]", STATUS_SWATCH[status])}
                />
                {TABLE_STATUS_LABELS[status]}
              </span>
            ))}
            <span className="ml-auto hidden font-mono text-[11px] text-muted-foreground sm:block">
              godziny w strefie {timezone}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PillButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-11 shrink-0 rounded-full px-3.5 font-mono text-[12px] whitespace-nowrap transition-colors lg:min-h-8",
        active
          ? "bg-primary font-medium text-primary-foreground"
          : "border border-border bg-card text-foreground/80 hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
