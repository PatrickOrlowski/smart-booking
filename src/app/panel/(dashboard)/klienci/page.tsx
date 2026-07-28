import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";
import { getPanelBusiness } from "@/app/panel/data";
import { formatPrice } from "@/components/panel/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * CRM — lista klientów firmy: kontakt, liczba wizyt, wydatki (zakończone
 * wizyty, z pozycji rezerwacji), nieobecności, tagi i status blokady.
 * Wyszukiwarka po imieniu/telefonie/e-mailu przez `?q=` (formularz GET,
 * zero JS), sortowanie po ostatniej wizycie.
 */

const LIST_LIMIT = 200;

/** "5 wizyt" z polską odmianą liczebnika. */
function visitsLabel(count: number): string {
  if (count === 1) return "1 wizyta";
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} wizyty`;
  }
  return `${count} wizyt`;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q: rawQuery } = await searchParams;
  const q = (rawQuery ?? "").trim();

  const panel = await getPanelBusiness();
  if (!panel) redirect("/panel/nowa");

  const { business, location } = panel;
  const tz = location?.timezone ?? "Europe/Warsaw";

  const customers = await prisma.customer.findMany({
    where: {
      businessId: business.id,
      ...(q
        ? {
            OR: [
              { fullName: { contains: q, mode: "insensitive" as const } },
              { phone: { contains: q, mode: "insensitive" as const } },
              { email: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      tags: true,
      isBlocked: true,
    },
    take: LIST_LIMIT,
  });

  const ids = customers.map((customer) => customer.id);

  // Agregaty per klient: liczba wizyt + ostatnia wizyta, liczba NO_SHOW
  // oraz suma wydatków z pozycji zakończonych rezerwacji.
  const [totals, noShows, completedItems] = ids.length
    ? await Promise.all([
        prisma.booking.groupBy({
          by: ["customerId"],
          where: { businessId: business.id, customerId: { in: ids } },
          _count: { _all: true },
          _max: { startAt: true },
        }),
        prisma.booking.groupBy({
          by: ["customerId"],
          where: {
            businessId: business.id,
            customerId: { in: ids },
            status: "NO_SHOW",
          },
          _count: { _all: true },
        }),
        prisma.bookingItem.findMany({
          where: {
            booking: {
              businessId: business.id,
              customerId: { in: ids },
              status: "COMPLETED",
            },
          },
          select: {
            priceCents: true,
            booking: { select: { customerId: true } },
          },
        }),
      ])
    : [[], [], []];

  const totalByCustomer = new Map(
    totals.map((row) => [
      row.customerId,
      { count: row._count._all, lastVisitAt: row._max.startAt },
    ]),
  );
  const noShowByCustomer = new Map(
    noShows.map((row) => [row.customerId, row._count._all]),
  );
  const spentByCustomer = new Map<string, number>();
  for (const item of completedItems) {
    const customerId = item.booking.customerId;
    if (!customerId) continue;
    spentByCustomer.set(
      customerId,
      (spentByCustomer.get(customerId) ?? 0) + item.priceCents,
    );
  }

  const dateFormatter = new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: tz,
  });

  const rows = customers
    .map((customer) => {
      const total = totalByCustomer.get(customer.id);
      return {
        ...customer,
        visits: total?.count ?? 0,
        lastVisitAt: total?.lastVisitAt ?? null,
        noShowCount: noShowByCustomer.get(customer.id) ?? 0,
        spentCents: spentByCustomer.get(customer.id) ?? 0,
      };
    })
    .sort(
      (a, b) =>
        (b.lastVisitAt?.getTime() ?? 0) - (a.lastVisitAt?.getTime() ?? 0) ||
        a.fullName.localeCompare(b.fullName, "pl"),
    );

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-5">
        <h1 className="font-display text-[22px] leading-tight font-extrabold tracking-tight sm:text-[27px]">
          Klienci
        </h1>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          Profile CRM twoich klientów — historia wizyt, wydatki, nieobecności
          i blokady rezerwacji online.
        </p>
      </div>

      <form
        action="/panel/klienci"
        method="get"
        className="mb-4 flex items-center gap-2"
      >
        <Input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Szukaj po imieniu, telefonie lub e-mailu…"
          aria-label="Szukaj klienta"
          className="h-11 flex-1 rounded-full bg-card px-4 md:h-9"
        />
        <Button
          type="submit"
          className="h-11 shrink-0 rounded-full px-5 font-semibold md:h-9 md:px-4"
        >
          Szukaj
        </Button>
        {q ? (
          <Button
            asChild
            variant="outline"
            className="h-11 shrink-0 rounded-full px-4 md:h-9"
          >
            <Link href="/panel/klienci">Wyczyść</Link>
          </Button>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <EmptyState searched={q.length > 0} />
      ) : (
        <>
          <p className="mb-2 font-mono text-[11px] text-muted-foreground">
            {q ? `wyniki dla „${q}": ` : ""}
            {rows.length}
            {rows.length === LIST_LIMIT ? "+" : ""} klientów · sortowanie po
            ostatniej wizycie
          </p>
          <ul className="overflow-hidden rounded-2xl border border-border bg-card">
            <li
              aria-hidden
              className="hidden grid-cols-[minmax(0,1fr)_56px_88px_72px_92px] gap-3 border-b border-border px-5 py-2.5 font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase md:grid"
            >
              <span>Klient</span>
              <span className="text-right">Wizyty</span>
              <span className="text-right">Wydatki</span>
              <span className="text-right">No-show</span>
              <span className="text-right">Ostatnia</span>
            </li>
            {rows.map((row) => {
              const contact =
                [row.phone, row.email].filter(Boolean).join(" · ") ||
                "brak danych kontaktowych";
              const lastLabel = row.lastVisitAt
                ? dateFormatter.format(row.lastVisitAt)
                : "—";
              return (
                <li
                  key={row.id}
                  className="border-t border-border first:border-t-0"
                >
                  <Link
                    href={`/panel/klienci/${row.id}`}
                    className="grid grid-cols-1 gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-muted/40 sm:px-5 md:grid-cols-[minmax(0,1fr)_56px_88px_72px_92px] md:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[14px] font-semibold">
                          {row.fullName}
                        </span>
                        {row.isBlocked ? <BlockedBadge /> : null}
                        {row.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                        {contact}
                      </div>
                    </div>

                    {/* Telefon/tablet: statystyki w jednej linii meta. */}
                    <div className="flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-muted-foreground md:hidden">
                      <span>{visitsLabel(row.visits)}</span>
                      <span aria-hidden>·</span>
                      <span>{formatPrice(row.spentCents)}</span>
                      {row.noShowCount > 0 ? (
                        <>
                          <span aria-hidden>·</span>
                          <span className="font-semibold text-destructive">
                            {row.noShowCount} no-show
                          </span>
                        </>
                      ) : null}
                      {row.lastVisitAt ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>ost. {lastLabel}</span>
                        </>
                      ) : null}
                    </div>

                    {/* Desktop: kolumny tabeli. */}
                    <span className="hidden text-right font-mono text-[12px] md:block">
                      {row.visits}
                    </span>
                    <span className="hidden text-right font-mono text-[12px] md:block">
                      {formatPrice(row.spentCents)}
                    </span>
                    <span
                      className={cn(
                        "hidden text-right font-mono text-[12px] md:block",
                        row.noShowCount > 0
                          ? "font-semibold text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      {row.noShowCount}
                    </span>
                    <span className="hidden text-right font-mono text-[11px] text-muted-foreground md:block">
                      {lastLabel}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function BlockedBadge() {
  return (
    <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-mono text-[10px] font-medium tracking-[0.04em] text-destructive uppercase">
      Zablokowany
    </span>
  );
}

function EmptyState({ searched }: { searched: boolean }) {
  return (
    <div className="flex items-center justify-center rounded-2xl border border-border bg-card px-6 py-20">
      <div className="max-w-md text-center">
        <h2 className="font-display text-2xl font-extrabold tracking-tight">
          {searched ? "Brak wyników" : "Brak klientów"}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {searched
            ? "Żaden klient nie pasuje do wyszukiwania. Spróbuj innego imienia, numeru telefonu lub adresu e-mail."
            : "Profile klientów powstają automatycznie przy rezerwacjach online oraz przy ręcznych wizytach z podanym telefonem lub e-mailem."}
        </p>
      </div>
    </div>
  );
}
