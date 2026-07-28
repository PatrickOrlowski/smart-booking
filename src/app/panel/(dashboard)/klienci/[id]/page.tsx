import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";
import { getPanelBusiness } from "@/app/panel/data";
import { formatPrice, initials } from "@/components/panel/format";
import { CustomerEditDialog } from "@/components/panel/customer-edit-dialog";
import { CustomerBlockControls } from "@/components/panel/customer-block-controls";
import type { BookingStatus } from "@/generated/prisma/enums";

/**
 * Karta klienta (CRM): dane kontaktowe z edycją, statystyki, historia wizyt
 * (czasy w strefie lokalu), blokada rezerwacji online i ślad audytowy.
 * Klient jest zawsze weryfikowany względem firmy z sesji — cudze id → 404.
 */

const HISTORY_LIMIT = 30;

const STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: "Oczekująca",
  CONFIRMED: "Potwierdzona",
  COMPLETED: "Zakończona",
  CANCELLED_BY_CUSTOMER: "Odwołana (klient)",
  CANCELLED_BY_BUSINESS: "Odwołana (firma)",
  NO_SHOW: "Nieobecność",
};

const STATUS_TONES: Record<BookingStatus, string> = {
  PENDING: "bg-warning-soft text-warning-strong",
  CONFIRMED: "bg-success-soft text-primary dark:text-accent-foreground",
  COMPLETED: "bg-muted text-foreground/80",
  CANCELLED_BY_CUSTOMER: "bg-destructive/10 text-destructive",
  CANCELLED_BY_BUSINESS: "bg-destructive/10 text-destructive",
  NO_SHOW: "bg-destructive/10 text-destructive",
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
  CUSTOMER_BLOCKED: "Zablokowany",
  CUSTOMER_UNBLOCKED: "Odblokowany",
  CUSTOMER_UPDATED: "Dane zmienione",
};

/** Data + godzina w strefie lokalu, np. "12.06.2026, 14:30". */
function formatInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const panel = await getPanelBusiness();
  if (!panel) redirect("/panel/nowa");

  const { business, location, isManager } = panel;
  const tz = location?.timezone ?? "Europe/Warsaw";

  // Multi-tenant: klient musi należeć do firmy z sesji.
  const customer = await prisma.customer.findFirst({
    where: { id, businessId: business.id },
  });
  if (!customer) notFound();

  const [bookings, statusGroups, spentAgg, auditEntries] = await Promise.all([
    prisma.booking.findMany({
      where: { businessId: business.id, customerId: customer.id },
      orderBy: { startAt: "desc" },
      take: HISTORY_LIMIT,
      select: {
        id: true,
        status: true,
        startAt: true,
        totalPriceCents: true,
        currency: true,
        location: { select: { timezone: true } },
        items: {
          orderBy: { sortOrder: "asc" },
          select: {
            service: { select: { name: true } },
            resource: { select: { name: true } },
          },
        },
      },
    }),
    prisma.booking.groupBy({
      by: ["status"],
      where: { businessId: business.id, customerId: customer.id },
      _count: { _all: true },
    }),
    prisma.bookingItem.aggregate({
      _sum: { priceCents: true },
      where: {
        booking: {
          businessId: business.id,
          customerId: customer.id,
          status: "COMPLETED",
        },
      },
    }),
    prisma.auditLog.findMany({
      where: {
        businessId: business.id,
        entityType: "Customer",
        entityId: customer.id,
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  const countOf = (status: BookingStatus) =>
    statusGroups.find((row) => row.status === status)?._count._all ?? 0;
  const totalVisits = statusGroups.reduce(
    (sum, row) => sum + row._count._all,
    0,
  );
  const completedCount = countOf("COMPLETED");
  const noShowCount = countOf("NO_SHOW");
  const spentCents = spentAgg._sum.priceCents ?? 0;

  const actorIds = [
    ...new Set(
      auditEntries
        .map((entry) => entry.actorUserId)
        .filter((actorId): actorId is string => actorId !== null),
    ),
  ];
  const actors = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, email: true },
      })
    ).map((user) => [user.id, user.name ?? user.email ?? "Użytkownik"]),
  );

  const contact = [customer.phone, customer.email].filter(Boolean).join(" · ");

  const stats: { label: string; value: string; tone?: "destructive" }[] = [
    { label: "Wizyty", value: String(totalVisits) },
    { label: "Zakończone", value: String(completedCount) },
    { label: "Wydatki", value: formatPrice(spentCents) },
    {
      label: `Nieobecności · limit ${business.noShowLimit}`,
      value: String(noShowCount),
      tone: noShowCount > 0 ? "destructive" : undefined,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <Link
        href="/panel/klienci"
        className="font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        ‹ Wszyscy klienci
      </Link>

      <div className="mt-3 mb-5 flex flex-wrap items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary font-display text-[15px] font-extrabold text-primary-foreground">
          {initials(customer.fullName)}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-[22px] leading-tight font-extrabold tracking-tight sm:text-[27px]">
              {customer.fullName}
            </h1>
            {customer.isBlocked ? (
              <span className="rounded-full bg-destructive/10 px-2.5 py-1 font-mono text-[10px] font-medium tracking-[0.04em] text-destructive uppercase">
                Zablokowany
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">
            {contact || "brak danych kontaktowych"}
          </p>
        </div>
        {isManager ? (
          <div className="ml-auto">
            <CustomerEditDialog
              businessId={business.id}
              customer={{
                id: customer.id,
                fullName: customer.fullName,
                phone: customer.phone,
                email: customer.email,
                notes: customer.notes,
                tags: customer.tags,
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-border bg-card px-4 py-3.5"
          >
            <div className="font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
              {stat.label}
            </div>
            <div
              className={cn(
                "mt-1.5 font-display text-[26px] leading-none font-extrabold tracking-tight",
                stat.tone === "destructive" && "text-destructive",
              )}
            >
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-2xl border border-border bg-card lg:order-1">
          <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
            <h2 className="text-[14px] font-bold tracking-tight">
              Historia wizyt
            </h2>
            <span className="font-mono text-[11px] text-muted-foreground">
              {bookings.length === HISTORY_LIMIT
                ? `ostatnie ${HISTORY_LIMIT}`
                : visitsCountLabel(bookings.length)}
            </span>
          </div>
          {bookings.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-muted-foreground sm:px-5">
              Ten klient nie ma jeszcze żadnych wizyt.
            </p>
          ) : (
            <ul>
              {bookings.map((booking) => {
                const services =
                  booking.items
                    .map((item) => item.service.name)
                    .join(" + ") || "—";
                const staffNames =
                  [
                    ...new Set(booking.items.map((item) => item.resource.name)),
                  ].join(", ") || "—";
                return (
                  <li
                    key={booking.id}
                    className="border-t border-border px-4 py-3 first:border-t-0 sm:px-5"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-mono text-[12px] font-medium">
                        {formatInZone(
                          booking.startAt,
                          booking.location.timezone,
                        )}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 font-mono text-[10px] font-medium tracking-[0.04em] uppercase",
                          STATUS_TONES[booking.status],
                        )}
                      >
                        {STATUS_LABELS[booking.status]}
                      </span>
                      <span className="ml-auto font-mono text-[12px]">
                        {formatPrice(booking.totalPriceCents, booking.currency)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className="text-[13px] font-semibold">
                        {services}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {staffNames}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="flex flex-col gap-4 lg:order-2">
          <section className="rounded-2xl border border-border bg-card px-4 py-4 sm:px-5">
            <h2 className="text-[14px] font-bold tracking-tight">
              Notatki i tagi
            </h2>
            {customer.tags.length > 0 ? (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {customer.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-muted px-2.5 py-1 font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
            <p
              className={cn(
                "mt-2.5 text-[13px] leading-relaxed whitespace-pre-wrap",
                customer.notes ? "text-foreground/90" : "text-muted-foreground",
              )}
            >
              {customer.notes ??
                (customer.tags.length > 0
                  ? "Brak notatek."
                  : "Brak notatek i tagów — dodasz je przez „Edytuj dane”.")}
            </p>
          </section>

          <CustomerBlockControls
            businessId={business.id}
            customerId={customer.id}
            customerName={customer.fullName}
            isBlocked={customer.isBlocked}
            blockedReason={customer.blockedReason}
            blockedAtLabel={
              customer.blockedAt ? formatInZone(customer.blockedAt, tz) : null
            }
            canManage={isManager}
          />

          <section className="rounded-2xl border border-border bg-card px-4 py-4 sm:px-5">
            <h2 className="text-[14px] font-bold tracking-tight">
              Ostatnie zdarzenia
            </h2>
            {auditEntries.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted-foreground">
                Brak wpisów audytu dla tego klienta.
              </p>
            ) : (
              <ul className="mt-2.5 flex flex-col gap-3">
                {auditEntries.map((entry) => {
                  const metadata =
                    entry.metadata &&
                    typeof entry.metadata === "object" &&
                    !Array.isArray(entry.metadata)
                      ? (entry.metadata as Record<string, unknown>)
                      : {};
                  const reason =
                    typeof metadata.reason === "string"
                      ? metadata.reason
                      : typeof metadata.previousReason === "string"
                        ? `poprzedni powód: ${metadata.previousReason}`
                        : typeof metadata.fields === "string"
                          ? `pola: ${metadata.fields}`
                          : null;
                  const actor = entry.actorUserId
                    ? (actors.get(entry.actorUserId) ?? "Użytkownik")
                    : "system";
                  const negative = entry.action === "CUSTOMER_BLOCKED";
                  return (
                    <li key={entry.id} className="text-[12px]">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 font-mono text-[10px] font-medium tracking-[0.04em] uppercase",
                            negative
                              ? "bg-destructive/10 text-destructive"
                              : "bg-muted text-foreground/80",
                          )}
                        >
                          {AUDIT_ACTION_LABELS[entry.action] ?? entry.action}
                        </span>
                        <span className="font-mono text-[10.5px] text-muted-foreground">
                          {formatInZone(entry.createdAt, tz)}
                        </span>
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        <span className="font-semibold text-foreground">
                          {actor}
                        </span>
                        {reason ? ` — ${reason}` : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

/** "3 wizyty" z polską odmianą liczebnika. */
function visitsCountLabel(count: number): string {
  if (count === 1) return "1 wizyta";
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} wizyty`;
  }
  return `${count} wizyt`;
}
