import Link from "next/link";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { localDayMinutesToUtc, utcToZonedWallClock } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { markBookingCompleted, markBookingNoShow } from "./actions";
import {
  calendarWeekday,
  dayKey,
  formatPrice,
  formatWallTime,
  parseDayKey,
  pluralPl,
  shiftDay,
  type CalendarDay,
} from "./format";
import { getStaffContext } from "./staff-context";

type BookingLifecycleStatus = "PENDING" | "CONFIRMED" | "COMPLETED" | "NO_SHOW";

const statusBadge: Record<BookingLifecycleStatus, { label: string; className: string }> = {
  PENDING: { label: "OCZEKUJE", className: "bg-warning-soft text-warning-strong" },
  CONFIRMED: { label: "POTWIERDZONA", className: "bg-secondary text-foreground/70" },
  COMPLETED: { label: "ZAKOŃCZONA", className: "bg-success-soft text-success" },
  NO_SHOW: { label: "NIEOBECNOŚĆ", className: "bg-destructive/10 text-destructive" },
};

/**
 * Akcje wiersza wizyty ("Zakończona" / "Nie przyszedł").
 * Układ nadaje rodzic: na telefonie pełnowymiarowe przyciski ≥44px
 * pod treścią, od md pionowa kolumna po prawej.
 */
function BookingActions({ bookingId }: { bookingId: string }) {
  return (
    <>
      <form action={markBookingCompleted}>
        <input type="hidden" name="bookingId" value={bookingId} />
        <button
          type="submit"
          className="flex min-h-11 w-full cursor-pointer items-center justify-center rounded-[10px] bg-primary px-3 text-[13px] font-bold text-primary-foreground transition-colors hover:bg-primary/80"
        >
          Zakończona
        </button>
      </form>
      <form action={markBookingNoShow}>
        <input type="hidden" name="bookingId" value={bookingId} />
        <button
          type="submit"
          className="flex min-h-11 w-full cursor-pointer items-center justify-center rounded-[10px] border border-destructive/30 bg-card px-3 text-[12.5px] font-semibold text-destructive transition-colors hover:bg-destructive/10"
        >
          Nie przyszedł
        </button>
      </form>
    </>
  );
}

function headlineSecondLine(
  isToday: boolean,
  total: number,
  remaining: number,
): string {
  if (total === 0) return "Żadnych wizyt.";
  if (!isToday) return `${pluralPl(total, "wizyta", "wizyty", "wizyt")} w grafiku.`;
  if (remaining === 0) return "Wszystko odhaczone.";
  const verb = remaining === 1 ? "Została" : remaining % 10 >= 2 && remaining % 10 <= 4 && (remaining % 100 < 12 || remaining % 100 > 14) ? "Zostały" : "Zostało";
  return `${verb} ${pluralPl(remaining, "wizyta", "wizyty", "wizyt")}.`;
}

export default async function PracownikPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string | string[] }>;
}) {
  const { sessionUser, profile } = await getStaffContext();
  if (!sessionUser) redirect("/login");
  // Stan "konto bez grafiku" renderuje layout.
  if (!profile) return null;

  const timezone = profile.resource.location.timezone;
  const currency = "PLN";
  const now = new Date();
  const todayWall = utcToZonedWallClock(now, timezone);
  const today: CalendarDay = {
    year: todayWall.year,
    month: todayWall.month,
    day: todayWall.day,
  };

  const params = await searchParams;
  const rawDay = typeof params.data === "string" ? params.data : undefined;
  const selected = parseDayKey(rawDay) ?? today;
  const isToday = dayKey(selected) === dayKey(today);

  // Granice dnia w UTC — liczone z zegara ściennego lokalizacji.
  const dayStart = localDayMinutesToUtc(selected, 0, timezone);
  const dayEnd = localDayMinutesToUtc(shiftDay(selected, 1), 0, timezone);
  const weekday = calendarWeekday(selected);
  const selectedDate = new Date(
    Date.UTC(selected.year, selected.month - 1, selected.day),
  );

  const [items, workingHours] = await Promise.all([
    prisma.bookingItem.findMany({
      where: {
        resourceId: profile.resourceId,
        startAt: { gte: dayStart, lt: dayEnd },
        booking: {
          status: {
            notIn: ["CANCELLED_BY_CUSTOMER", "CANCELLED_BY_BUSINESS"],
          },
        },
      },
      include: {
        service: { select: { name: true } },
        booking: {
          include: {
            customer: { select: { fullName: true, phone: true } },
            user: { select: { name: true, phone: true } },
          },
        },
      },
      orderBy: { startAt: "asc" },
    }),
    prisma.workingHours.findMany({
      where: {
        resourceId: profile.resourceId,
        weekday,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: selectedDate } }] },
          { OR: [{ validTo: null }, { validTo: { gte: selectedDate } }] },
        ],
      },
      select: { startMinute: true, endMinute: true },
    }),
  ]);

  // Podsumowanie dnia: liczba wizyt, przychód (bez nieobecności), obłożenie.
  const revenueCents = items
    .filter((item) => item.booking.status !== "NO_SHOW")
    .reduce((sum, item) => sum + item.priceCents, 0);
  const bookedMinutes = items.reduce((sum, item) => sum + item.durationMin, 0);
  const workMinutes = workingHours.reduce(
    (sum, block) => sum + (block.endMinute - block.startMinute),
    0,
  );
  const occupancy =
    workMinutes > 0
      ? Math.min(100, Math.round((bookedMinutes / workMinutes) * 100))
      : null;
  const remaining = items.filter(
    (item) =>
      (item.booking.status === "PENDING" ||
        item.booking.status === "CONFIRMED") &&
      item.endAt.getTime() > now.getTime(),
  ).length;

  const dateLabel = new Intl.DateTimeFormat("pl-PL", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  })
    .format(dayStart)
    .replace(",", "")
    .toUpperCase();

  const firstName = (sessionUser.name ?? profile.resource.name).split(" ")[0];

  const navPill =
    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border bg-card px-4 text-[13px] font-semibold transition-colors hover:bg-muted";

  return (
    <div>
      {/* Telefon/tablet: nagłówek nad statystykami; od lg obok siebie. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-5">
        <div>
          <div className="meta-label">
            {dateLabel}
            {isToday ? " · DZIŚ" : ""}
          </div>
          <h1 className="mt-1.5 font-display text-[28px] leading-none font-extrabold tracking-tight md:text-[34px]">
            Cześć, {firstName}.
            <br />
            {headlineSecondLine(isToday, items.length, remaining)}
          </h1>
          <nav aria-label="Wybór dnia" className="mt-4 flex items-center gap-2">
            <Link
              href={`/pracownik?data=${dayKey(shiftDay(selected, -1))}`}
              aria-label="Poprzedni dzień"
              className={navPill}
            >
              ←
            </Link>
            <Link
              href="/pracownik"
              className={cn(
                navPill,
                isToday &&
                  "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
              )}
            >
              Dziś
            </Link>
            <Link
              href={`/pracownik?data=${dayKey(shiftDay(selected, 1))}`}
              aria-label="Następny dzień"
              className={navPill}
            >
              →
            </Link>
          </nav>
        </div>

        {/* Statystyki dnia: 3 małe karty w wierszu na telefonie/tablecie,
            od lg zwarty wiersz przy prawej krawędzi. */}
        <div className="grid flex-none grid-cols-3 gap-2 sm:gap-2.5 lg:flex">
          <div className="min-w-0 rounded-xl border border-border bg-card px-3 py-2.5 sm:px-4 sm:py-3 lg:min-w-[104px]">
            <div className="font-display text-[20px] leading-none font-extrabold tracking-tight sm:text-[26px]">
              {items.length}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground sm:text-[11.5px]">
              {items.length === 1
                ? "wizyta"
                : items.length % 10 >= 2 &&
                    items.length % 10 <= 4 &&
                    (items.length % 100 < 12 || items.length % 100 > 14)
                  ? "wizyty"
                  : "wizyt"}{" "}
              {isToday ? "dziś" : "w grafiku"}
            </div>
          </div>
          <div className="min-w-0 rounded-xl border border-border bg-card px-3 py-2.5 sm:px-4 sm:py-3 lg:min-w-[104px]">
            <div className="font-display text-[20px] leading-none font-extrabold tracking-tight sm:text-[26px]">
              {formatPrice(revenueCents, currency)}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground sm:text-[11.5px]">
              przychód dnia
            </div>
          </div>
          <div className="min-w-0 rounded-xl bg-ink px-3 py-2.5 text-ink-foreground sm:px-4 sm:py-3 lg:min-w-[104px]">
            <div className="font-display text-[20px] leading-none font-extrabold tracking-tight sm:text-[26px]">
              {occupancy === null ? "—" : `${occupancy}%`}
            </div>
            <div className="mt-1 text-[11px] text-ink-foreground/60 sm:text-[11.5px]">
              obłożenie grafiku
            </div>
          </div>
        </div>
      </div>

      <div className="mt-7 flex flex-col gap-2.5">
        {items.length === 0 ? (
          <div className="mx-auto w-full max-w-md rounded-2xl border border-border bg-card px-6 py-14 text-center sm:py-16">
            <h2 className="font-display text-[24px] font-extrabold tracking-tight sm:text-[27px]">
              Wolne. Żadnych wizyt.
            </h2>
            <p className="mt-2 text-[13px] text-muted-foreground">
              {isToday
                ? "Na dziś nie masz nic w grafiku."
                : "W tym dniu nie masz nic w grafiku."}
            </p>
            {!isToday ? (
              <Link
                href="/pracownik"
                className="mt-5 inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/80"
              >
                Wróć do dziś
              </Link>
            ) : null}
          </div>
        ) : (
          items.map((item) => {
            const booking = item.booking;
            const status = booking.status as BookingLifecycleStatus;
            const badge = statusBadge[status];
            const isSettled = status === "COMPLETED" || status === "NO_SHOW";
            const isPendingRow = status === "PENDING";
            const isOngoing =
              !isSettled &&
              item.startAt.getTime() <= now.getTime() &&
              now.getTime() < item.endAt.getTime();
            const isActionable =
              !isSettled && booking.startAt.getTime() <= now.getTime();

            const clientName =
              booking.guestName ??
              booking.customer?.fullName ??
              booking.user?.name ??
              "Klient";
            const phone =
              booking.guestPhone ??
              booking.customer?.phone ??
              booking.user?.phone ??
              null;
            const startTime = formatWallTime(
              utcToZonedWallClock(item.startAt, timezone),
            );

            const badgeClassName = cn(
              "h-auto flex-none rounded-md px-2 py-1 font-mono text-[10px] font-normal tracking-wide",
              badge.className,
            );

            return (
              <article
                key={item.id}
                className={cn(
                  "rounded-[14px] border border-border bg-card p-4 md:flex md:items-center md:gap-4 md:py-3.5",
                  isSettled && "opacity-60",
                  isPendingRow &&
                    "border-[1.5px] border-dashed border-warning bg-warning-soft",
                  isOngoing && !isPendingRow &&
                    "border-[1.5px] border-border-strong",
                )}
              >
                {/* Telefon: wiersz 1 = godzina + status; od md wąska
                    kolumna godziny po lewej. */}
                <div className="flex items-center justify-between gap-3 md:block md:w-16 md:flex-none">
                  <div className="flex items-baseline gap-2 md:block">
                    <span
                      className={cn(
                        "font-mono text-[15px] font-medium",
                        isPendingRow && "text-warning-strong",
                      )}
                    >
                      {startTime}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[11px] text-muted-foreground md:block",
                        isPendingRow && "text-warning-strong/70",
                      )}
                    >
                      {item.durationMin} min
                    </span>
                  </div>
                  <Badge className={cn(badgeClassName, "md:hidden")}>
                    {badge.label}
                  </Badge>
                </div>

                <div className="mt-2 min-w-0 flex-1 md:mt-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "truncate text-[14px] font-semibold",
                        isPendingRow && "font-bold text-warning-strong",
                      )}
                    >
                      {clientName}
                    </span>
                    {isOngoing ? (
                      <span className="flex-none rounded-[5px] bg-ink px-1.5 py-0.5 font-mono text-[9.5px] text-ink-foreground">
                        TRWA
                      </span>
                    ) : null}
                  </div>
                  <div
                    className={cn(
                      "mt-0.5 text-[12px] text-muted-foreground md:truncate",
                      isPendingRow && "text-warning-strong/80",
                    )}
                  >
                    {item.service.name} · {formatPrice(item.priceCents, currency)}
                  </div>
                  {phone ? (
                    <a
                      href={`tel:${phone.replace(/[\s-]/g, "")}`}
                      className={cn(
                        "mt-1 inline-flex items-center font-mono text-[12px] text-muted-foreground underline decoration-border-strong underline-offset-4 transition-colors hover:text-foreground",
                        isPendingRow &&
                          "text-warning-strong/80 decoration-warning/50 hover:text-warning-strong",
                      )}
                    >
                      {phone}
                    </a>
                  ) : null}
                </div>

                {/* Od md: status + akcje w prawej kolumnie. */}
                <div className="hidden md:flex md:flex-none md:flex-col md:items-end md:gap-2">
                  <Badge className={badgeClassName}>{badge.label}</Badge>
                  {isActionable ? (
                    <div className="flex w-[150px] flex-col gap-1.5">
                      <BookingActions bookingId={booking.id} />
                    </div>
                  ) : null}
                </div>

                {/* Telefon: pełnowymiarowe przyciski akcji pod treścią. */}
                {isActionable ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 md:hidden">
                    <BookingActions bookingId={booking.id} />
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
