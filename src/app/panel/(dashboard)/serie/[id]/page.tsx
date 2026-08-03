import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { BookingStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";
import { getPanelBusiness } from "@/app/panel/data";
import { utcToZonedWallClock } from "@/lib/time";
import { formatPrice } from "@/components/panel/format";
import {
  SeriesMark,
  SeriesStatusBadge,
  formatSeriesRule,
} from "@/components/panel/series-rule";
import { SeriesEndDialog } from "@/components/panel/series-end-dialog";
import { SeriesVisitCancel } from "@/components/panel/series-visit-cancel";
import {
  formatVisitLabel,
  loadSeriesContext,
  planStoredSeriesVisits,
  timeLabelOf,
} from "../series-data";

/**
 * Szczegóły serii cyklicznej: reguła, licznik wizyt i lista terminów.
 *
 * Lista powstaje z reguły, a nie z samych rezerwacji — dzięki temu termin
 * pominięty przy generowaniu (kolizja z inną wizytą) zostaje widoczny jako
 * luka, zamiast po cichu zniknąć.
 */

const STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: "Oczekuje",
  CONFIRMED: "Potwierdzona",
  COMPLETED: "Zakończona",
  CANCELLED_BY_CUSTOMER: "Odwołana (klient)",
  CANCELLED_BY_BUSINESS: "Odwołana (firma)",
  NO_SHOW: "Nieobecność",
};

const STATUS_CLASSES: Record<BookingStatus, string> = {
  PENDING: "border-warning/40 bg-warning-soft text-warning-strong",
  CONFIRMED:
    "border-success-soft-border bg-success-soft text-primary dark:border-border dark:bg-muted dark:text-foreground",
  COMPLETED: "border-border bg-muted text-muted-foreground",
  CANCELLED_BY_CUSTOMER: "border-destructive/30 bg-destructive/10 text-destructive",
  CANCELLED_BY_BUSINESS: "border-destructive/30 bg-destructive/10 text-destructive",
  NO_SHOW: "border-destructive/30 bg-destructive/10 text-destructive",
};

const CANCELLABLE: BookingStatus[] = ["PENDING", "CONFIRMED"];

export default async function SeriesDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const panel = await getPanelBusiness();
  if (!panel) redirect("/panel/nowa");

  const { business, location, isManager } = panel;

  const series = await prisma.bookingSeries.findFirst({
    where: { id, businessId: business.id },
    select: {
      id: true,
      status: true,
      resourceId: true,
      serviceId: true,
      intervalWeeks: true,
      weekday: true,
      startMinute: true,
      startDate: true,
      endDate: true,
      occurrences: true,
      note: true,
      guestName: true,
      guestPhone: true,
      guestEmail: true,
      createdAt: true,
      service: { select: { name: true, currency: true } },
      resource: { select: { name: true } },
      customer: { select: { id: true, fullName: true } },
      bookings: {
        orderBy: { startAt: "asc" },
        select: {
          id: true,
          status: true,
          startAt: true,
          endAt: true,
          totalPriceCents: true,
          currency: true,
        },
      },
    },
  });
  if (!series) notFound();

  const context = await loadSeriesContext(
    business.id,
    series.resourceId,
    series.serviceId,
  );
  const tz = context?.location.timezone ?? location?.timezone ?? "Europe/Warsaw";
  const planned = context ? planStoredSeriesVisits(series, context) : [];

  // Sklejenie planu z rzeczywistością po instancie startu — wizyty tworzone
  // są dokładnie z tych samych terminów, więc dopasowanie jest jednoznaczne.
  const byStart = new Map(
    series.bookings.map((booking) => [booking.startAt.getTime(), booking]),
  );
  const rows = planned.map((visit) => {
    const booking = byStart.get(visit.startAt.getTime()) ?? null;
    if (booking) byStart.delete(visit.startAt.getTime());
    return { key: visit.iso, index: visit.index, startAt: visit.startAt, booking };
  });
  // Wizyty spoza planu (np. przeniesione ręcznie) też muszą być widoczne.
  for (const booking of byStart.values()) {
    rows.push({
      key: `extra-${booking.id}`,
      index: 0,
      startAt: booking.startAt,
      booking,
    });
  }
  rows.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const now = new Date();
  const upcoming = series.bookings.filter(
    (booking) =>
      CANCELLABLE.includes(booking.status) &&
      booking.startAt.getTime() > now.getTime(),
  );
  const skippedCount = rows.filter((row) => row.booking === null).length;
  const cancelledCount = series.bookings.filter((booking) =>
    booking.status.startsWith("CANCELLED"),
  ).length;

  const clientName = series.customer?.fullName ?? series.guestName ?? "Klient";
  const contact = [series.guestPhone, series.guestEmail]
    .filter(Boolean)
    .join(" · ");
  const dayFormatter = new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <Link
        href="/panel/serie"
        className="font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Serie
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeriesMark className="text-muted-foreground" />
            <h1 className="font-display text-[22px] leading-tight font-extrabold tracking-tight sm:text-[27px]">
              {clientName}
            </h1>
            <SeriesStatusBadge status={series.status} />
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {series.service.name} · {series.resource.name}
            {contact ? ` · ${contact}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {series.customer ? (
            <Link
              href={`/panel/klienci/${series.customer.id}`}
              className="inline-flex min-h-9 items-center rounded-full border border-border bg-card px-4 text-[12.5px] font-semibold transition-colors hover:bg-muted max-lg:min-h-11"
            >
              Profil klienta
            </Link>
          ) : null}
          {isManager && series.status === "ACTIVE" ? (
            <SeriesEndDialog
              businessId={business.id}
              seriesId={series.id}
              upcomingCount={upcoming.length}
              upcomingLabels={upcoming
                .slice(0, 3)
                .map((booking) => formatVisitLabel(booking.startAt, tz))}
            />
          ) : null}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
        <Stat label="Reguła" value={formatSeriesRule(series)} wide />
        <Stat label="Utworzone" value={`${series.bookings.length}`} />
        <Stat label="Nadchodzące" value={`${upcoming.length}`} />
        <Stat
          label="Odwołane"
          value={`${cancelledCount}`}
          tone={cancelledCount > 0 ? "destructive" : undefined}
        />
        <Stat
          label="Pominięte"
          value={`${skippedCount}`}
          tone={skippedCount > 0 ? "warning" : undefined}
        />
        <Stat label="Start" value={dayFormatter.format(series.startDate)} />
        <Stat
          label="Koniec"
          value={
            series.endDate
              ? dayFormatter.format(series.endDate)
              : `po ${series.occurrences ?? series.bookings.length} wiz.`
          }
        />
      </dl>

      {series.note ? (
        <p className="mt-3 rounded-xl border border-dashed border-border bg-card px-3 py-2.5 text-[12.5px] text-foreground/80">
          <span className="meta-label mr-2">Notatka</span>
          {series.note}
        </p>
      ) : null}

      <h2 className="mt-6 mb-2 font-display text-[16px] font-extrabold tracking-tight">
        Terminy serii
      </h2>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-card px-4 py-8 text-center text-[13px] text-muted-foreground">
          Ta seria nie ma żadnych wizyt.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-border bg-card">
          {rows.map((row) => {
            const wall = utcToZonedWallClock(row.startAt, tz);
            const dayHref = `/panel?data=${wall.year}-${String(wall.month).padStart(2, "0")}-${String(wall.day).padStart(2, "0")}`;
            const canCancel =
              isManager &&
              row.booking !== null &&
              CANCELLABLE.includes(row.booking.status) &&
              row.startAt.getTime() > now.getTime();

            return (
              <li
                key={row.key}
                className="flex flex-col gap-2 border-t border-border px-4 py-3 first:border-t-0 sm:px-5 md:flex-row md:items-center md:gap-4"
              >
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {row.index > 0 ? String(row.index).padStart(2, "0") : "—"}
                  </span>
                  <Link
                    href={dayHref}
                    className="font-mono text-[13px] font-semibold underline-offset-4 hover:underline"
                  >
                    {formatVisitLabel(row.startAt, tz)}
                  </Link>
                  {row.booking ? (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      do {timeLabelOf(row.booking.endAt, tz)} ·{" "}
                      {formatPrice(
                        row.booking.totalPriceCents,
                        row.booking.currency,
                      )}
                    </span>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {row.booking ? (
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.06em] uppercase",
                        STATUS_CLASSES[row.booking.status],
                      )}
                    >
                      {STATUS_LABELS[row.booking.status]}
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center rounded-full border border-warning/40 bg-warning-soft px-2 py-0.5 font-mono text-[10px] tracking-[0.06em] text-warning-strong uppercase"
                      title="Termin pominięty przy generowaniu serii — pracownik był zajęty"
                    >
                      Pominięty — brak wizyty
                    </span>
                  )}
                  {canCancel && row.booking ? (
                    <SeriesVisitCancel
                      businessId={business.id}
                      seriesId={series.id}
                      bookingId={row.booking.id}
                      visitLabel={formatVisitLabel(row.startAt, tz)}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {skippedCount > 0 ? (
        <p className="mt-3 text-[12px] text-muted-foreground">
          Terminy oznaczone jako pominięte kolidowały z inną wizytą w chwili
          generowania serii — dodaj je ręcznie z kalendarza w innej godzinie.
        </p>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  wide = false,
  tone,
}: {
  label: string;
  value: string;
  wide?: boolean;
  tone?: "destructive" | "warning";
}) {
  return (
    <div
      className={cn(
        "bg-card px-3.5 py-3",
        wide ? "col-span-2" : undefined,
      )}
    >
      <dt className="meta-label">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 font-mono text-[13px] font-medium",
          tone === "destructive" && "text-destructive",
          tone === "warning" && "text-warning-strong",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
