import Link from "next/link";
import type { BookingStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { STATUS_BLOCK_CLASSES, STATUS_TAGS } from "@/components/panel/day-grid";
import { formatPrice } from "@/components/panel/format";

/**
 * Siatka tygodnia — 7 kolumn dni (pn–nd) ze skróconymi kartami wizyt,
 * bez osi godzinowej. Widoczne max MAX_VISIBLE kart, reszta zwinięta
 * w link "+N więcej" do widoku dnia; klik nagłówka dnia też prowadzi
 * do widoku dnia. Poniżej `lg` kolumny (min 150px) przewijają się
 * poziomo we własnym kontenerze — strona nie scrolluje poziomo;
 * od `lg` 7 równych kolumn mieszczących się w kadrze.
 */

const MAX_VISIBLE = 4;

/** Jedna karta = jedna rezerwacja (nie pozycja), stąd `id` = bookingId. */
export type WeekGridItem = {
  id: string;
  timeLabel: string;
  clientName: string;
  serviceName: string;
  status: BookingStatus;
  tooltip: string;
};

export type WeekGridDay = {
  dateParam: string;
  weekdayLabel: string;
  dateLabel: string;
  isToday: boolean;
  /** Dzień bez godzin otwarcia lokalu. */
  isClosed: boolean;
  items: WeekGridItem[];
  /** Wizyty liczone do stopki — bez odwołanych. */
  visitsCount: number;
  /** Przychód w rozbiciu na waluty rezerwacji. */
  revenue: { currency: string; cents: number }[];
};

/** Odwołane nie mogą wypychać realnych wizyt za „+N więcej". */
const CANCELLED_STATUSES = new Set<BookingStatus>([
  "CANCELLED_BY_CUSTOMER",
  "CANCELLED_BY_BUSINESS",
]);

/** "3 wizyty" z polską odmianą liczebnika. */
function visitsLabel(count: number): string {
  if (count === 1) return "1 wizyta";
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} wizyty`;
  }
  return `${count} wizyt`;
}

export function WeekGrid({ days }: { days: WeekGridDay[] }) {
  return (
    <div className="overflow-x-auto pb-6">
      <div className="grid min-w-fit gap-2 px-4 [grid-template-columns:repeat(7,minmax(150px,1fr))] sm:px-6 lg:min-w-0 lg:[grid-template-columns:repeat(7,minmax(0,1fr))]">
        {days.map((day) => {
          // Najpierw wizyty, które faktycznie się odbędą (i które liczy
          // stopka) — dzień z czterema odwołaniami i jedną potwierdzoną
          // wizytą pokazywał same odwołania i „+1 więcej".
          const ordered = [...day.items].sort((a, b) => {
            const aCancelled = CANCELLED_STATUSES.has(a.status) ? 1 : 0;
            const bCancelled = CANCELLED_STATUSES.has(b.status) ? 1 : 0;
            return aCancelled - bCancelled;
          });
          const visible = ordered.slice(0, MAX_VISIBLE);
          const hiddenCount = ordered.length - visible.length;
          const dayHref = `/panel?data=${day.dateParam}`;

          return (
            <div
              key={day.dateParam}
              className={cn(
                "flex min-w-0 flex-col overflow-hidden rounded-xl",
                day.isClosed ? "bg-muted/40" : "bg-card",
                day.isToday
                  ? "border-[1.5px] border-border-strong"
                  : "border border-border",
              )}
            >
              <Link
                href={dayHref}
                title="Przejdź do widoku dnia"
                className={cn(
                  "flex items-baseline justify-between gap-2 border-b px-2.5 py-2 transition-colors",
                  day.isToday
                    ? "border-border-strong bg-primary text-primary-foreground"
                    : "border-border hover:bg-muted/60",
                )}
              >
                <span
                  className={cn(
                    "font-mono text-[10px] tracking-[0.1em] uppercase",
                    day.isToday
                      ? "text-primary-foreground/80"
                      : "text-muted-foreground",
                  )}
                >
                  {day.weekdayLabel}
                </span>
                <span className="font-display text-[15px] font-bold tracking-tight">
                  {day.dateLabel}
                </span>
              </Link>

              <div className="flex flex-1 flex-col gap-1.5 p-1.5">
                {visible.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center py-5 font-mono text-[10px] text-muted-foreground/60">
                    {day.isClosed ? "zamknięte" : "brak wizyt"}
                  </div>
                ) : (
                  visible.map((item) => (
                    <div
                      key={item.id}
                      title={item.tooltip}
                      className={cn(
                        "rounded-lg px-2 py-1.5",
                        STATUS_BLOCK_CLASSES[item.status] ??
                          STATUS_BLOCK_CLASSES.CONFIRMED,
                      )}
                    >
                      <div className="truncate font-mono text-[10px] opacity-80">
                        {item.timeLabel}
                        {STATUS_TAGS[item.status]
                          ? ` · ${STATUS_TAGS[item.status]}`
                          : ""}
                      </div>
                      <div className="truncate text-[11.5px] font-semibold">
                        {item.clientName}
                      </div>
                      <div className="truncate text-[10.5px] opacity-80">
                        {item.serviceName}
                      </div>
                    </div>
                  ))
                )}
                {hiddenCount > 0 && (
                  <Link
                    href={dayHref}
                    className="rounded-lg px-2 py-1.5 text-center text-[11px] font-semibold text-primary transition-colors hover:bg-accent"
                  >
                    +{hiddenCount} więcej
                  </Link>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-border px-2.5 py-2 font-mono text-[10px] text-muted-foreground">
                <span>
                  {day.visitsCount === 0 ? "—" : visitsLabel(day.visitsCount)}
                </span>
                {day.revenue.length > 0 && (
                  <span className="truncate font-medium text-foreground">
                    {day.revenue
                      .map((entry) => formatPrice(entry.cents, entry.currency))
                      .join(" + ")}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
