import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";
import { getPanelBusiness } from "@/app/panel/data";
import { formatPrice } from "@/components/panel/format";

/**
 * Dziennik aktywności: ostatnie 50 wpisów AuditLog firmy — akcja po polsku,
 * kto (aktor), kiedy (w strefie lokalizacji) i szczegóły z metadata.
 * Filtr po typie akcji przez searchParam `?typ=` (chipy-linki, zero JS).
 */

const PAGE_SIZE = 50;

/** Słownik znanych akcji → polska etykieta. Nieznane akcje dostają fallback. */
const ACTION_LABELS: Record<string, string> = {
  PAYMENT_PAID: "Płatność opłacona",
  PAYMENT_PAID_AFTER_CANCELLATION: "Wpłata po anulowaniu (zwracana)",
  PAYMENT_REFUNDED: "Zwrot płatności",
  PAYMENT_FAILED: "Płatność nieudana",
  PLAN_CHANGED: "Zmiana planu",
  SUBSCRIPTION_CANCELLED: "Anulowanie subskrypcji",
  BOOKING_CREATED: "Nowa rezerwacja",
  BOOKING_CONFIRMED: "Rezerwacja potwierdzona",
  BOOKING_COMPLETED: "Wizyta zakończona",
  BOOKING_CANCELLED: "Wizyta odwołana",
  BOOKING_NO_SHOW: "Nieobecność klienta",
  CUSTOMER_BLOCKED: "Klient zablokowany",
  CUSTOMER_UNBLOCKED: "Klient odblokowany",
  SERVICE_CREATED: "Usługa dodana",
  SERVICE_UPDATED: "Usługa zmieniona",
  SERVICE_DELETED: "Usługa usunięta",
  STAFF_DEACTIVATED: "Pracownik dezaktywowany",
  DATA_EXPORTED: "Eksport danych",
};

const ENTITY_LABELS: Record<string, string> = {
  Booking: "rezerwacja",
  Payment: "płatność",
  Subscription: "subskrypcja",
  Customer: "klient",
  Service: "usługa",
  Resource: "pracownik",
  Business: "firma",
};

const KIND_LABELS: Record<string, string> = {
  DEPOSIT: "zadatek",
  FULL: "całość",
  NO_SHOW_FEE: "opłata no-show",
};

function actionLabel(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const pretty = action.replaceAll("_", " ").toLowerCase();
  return pretty.charAt(0).toUpperCase() + pretty.slice(1);
}

/** Ton pigułki akcji: negatywne / pozytywne / neutralne. */
function actionTone(action: string): string {
  if (/CANCELLED|NO_SHOW|BLOCKED|DELETED|FAILED/.test(action)) {
    return "bg-destructive/10 text-destructive";
  }
  if (/PAID|CONFIRMED|COMPLETED|CREATED|UNBLOCKED/.test(action)) {
    return "bg-success-soft text-primary dark:text-accent-foreground";
  }
  return "bg-muted text-foreground/80";
}

/** Metadata (JSON) → czytelne pary "etykieta: wartość" do wiersza szczegółów. */
function metadataDetails(metadata: unknown): string[] {
  if (
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    return [];
  }
  const record = metadata as Record<string, unknown>;
  const currency =
    typeof record.currency === "string" ? record.currency : "PLN";
  const details: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined || key === "currency") continue;
    // Surowe identyfikatory (bookingId itp.) to szum — encję pokazuje
    // już kolumna entityType/entityId wpisu.
    if (/Id$/.test(key)) continue;
    if (key.endsWith("Cents") && typeof value === "number") {
      const label =
        key === "amountCents"
          ? "kwota"
          : key === "refundedCents"
            ? "zwrot"
            : key.replace(/Cents$/, "");
      details.push(`${label}: ${formatPrice(value, currency)}`);
      continue;
    }
    if (key === "kind" && typeof value === "string") {
      details.push(`rodzaj: ${KIND_LABELS[value] ?? value.toLowerCase()}`);
      continue;
    }
    if (key === "reason" && typeof value === "string") {
      details.push(`powód: ${value}`);
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const text = String(value);
      details.push(`${key}: ${text.length > 40 ? `${text.slice(0, 40)}…` : text}`);
    }
  }
  return details.slice(0, 5);
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ typ?: string }>;
}) {
  const { typ } = await searchParams;
  const panel = await getPanelBusiness();
  if (!panel) redirect("/panel/nowa");

  const { business, location } = panel;
  const tz = location?.timezone ?? "Europe/Warsaw";

  const [actionGroups, entries] = await Promise.all([
    prisma.auditLog.groupBy({
      by: ["action"],
      where: { businessId: business.id },
      _count: { _all: true },
    }),
    prisma.auditLog.findMany({
      where: {
        businessId: business.id,
        ...(typ ? { action: typ } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
    }),
  ]);

  const actorIds = [
    ...new Set(
      entries
        .map((entry) => entry.actorUserId)
        .filter((id): id is string => id !== null),
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

  const dateFormatter = new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });

  const filters = actionGroups
    .map((group) => ({
      action: group.action,
      count: group._count._all,
    }))
    .sort((a, b) => b.count - a.count);
  const totalCount = filters.reduce((sum, row) => sum + row.count, 0);
  const activeFilter = filters.some((row) => row.action === typ) ? typ : undefined;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-5">
        <h1 className="font-display text-[22px] leading-tight font-extrabold tracking-tight sm:text-[27px]">
          Aktywność
        </h1>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          Dziennik operacji wrażliwych — kto, co i kiedy zmienił. Ostatnie{" "}
          {PAGE_SIZE} wpisów, czasy w strefie {tz}.
        </p>
      </div>

      {totalCount > 0 ? (
        <div className="mb-4 flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <FilterChip href="/panel/aktywnosc" active={!activeFilter}>
            Wszystkie · {totalCount}
          </FilterChip>
          {filters.map((filter) => (
            <FilterChip
              key={filter.action}
              href={`/panel/aktywnosc?typ=${encodeURIComponent(filter.action)}`}
              active={activeFilter === filter.action}
            >
              {actionLabel(filter.action)} · {filter.count}
            </FilterChip>
          ))}
        </div>
      ) : null}

      {entries.length === 0 ? (
        <EmptyState filtered={Boolean(activeFilter)} />
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-border bg-card">
          {entries.map((entry) => {
            const details = metadataDetails(entry.metadata);
            const actor = entry.actorUserId
              ? (actors.get(entry.actorUserId) ?? "Użytkownik")
              : "system";
            return (
              <li
                key={entry.id}
                className="border-t border-border px-4 py-3 first:border-t-0 sm:px-5"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 font-mono text-[10px] font-medium tracking-[0.04em] uppercase",
                      actionTone(entry.action),
                    )}
                  >
                    {actionLabel(entry.action)}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {ENTITY_LABELS[entry.entityType] ?? entry.entityType}{" "}
                    #{entry.entityId.slice(-6)}
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                    {dateFormatter.format(entry.createdAt)}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[13px] font-semibold">{actor}</span>
                  {details.map((detail) => (
                    <span
                      key={detail}
                      className="font-mono text-[11px] text-muted-foreground"
                    >
                      {detail}
                    </span>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-11 shrink-0 items-center rounded-full px-3.5 text-[12px] font-semibold whitespace-nowrap transition-colors md:min-h-8",
        active
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-card text-foreground/80 hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex items-center justify-center rounded-2xl border border-border bg-card px-6 py-20">
      <div className="max-w-md text-center">
        <h2 className="font-display text-2xl font-extrabold tracking-tight">
          {filtered ? "Brak wpisów tego typu" : "Brak aktywności"}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {filtered
            ? "Żaden wpis dziennika nie pasuje do wybranego filtra."
            : "Wpisy pojawią się przy operacjach wrażliwych: anulowaniach, płatnościach, zwrotach, blokadach klientów i eksportach danych."}
        </p>
      </div>
    </div>
  );
}
