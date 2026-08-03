import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/admin-auth";
import { BUSINESS_TYPE_LABELS } from "@/components/panel/format";
import {
  BUSINESS_STATUS_ORDER,
  BUSINESS_STATUS_SHORT,
  BUSINESS_STATUS_TONES,
  adminDateFormatter,
  filterHref,
  pageHref,
  pluralize,
} from "@/components/admin/format";
import {
  ChipRow,
  EmptyState,
  FilterChip,
  PageHeading,
  Pagination,
  StatusPill,
} from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BusinessStatus, BusinessType } from "@/generated/prisma/enums";

/**
 * Rejestr firm platformy: filtry (status, typ, miasto, szukanie po nazwie
 * i slugu) plus stronicowanie. Formularz jest zwykłym GET-em — filtry
 * mieszkają w URL-u, więc widok da się zabookmarkować i podesłać dalej.
 */

const PAGE_SIZE = 20;
const BASE_PATH = "/admin/firmy";

const TYPE_VALUES = Object.keys(BUSINESS_TYPE_LABELS) as BusinessType[];

function parseStatus(value: string | undefined): BusinessStatus | undefined {
  return BUSINESS_STATUS_ORDER.includes(value as BusinessStatus)
    ? (value as BusinessStatus)
    : undefined;
}

function parseType(value: string | undefined): BusinessType | undefined {
  return TYPE_VALUES.includes(value as BusinessType)
    ? (value as BusinessType)
    : undefined;
}

export default async function AdminBusinessesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    typ?: string;
    miasto?: string;
    q?: string;
    strona?: string;
  }>;
}) {
  await requirePlatformAdmin();

  const params = await searchParams;
  const status = parseStatus(params.status);
  const type = parseType(params.typ);
  const q = (params.q ?? "").trim();
  const page = Math.max(1, Number.parseInt(params.strona ?? "1", 10) || 1);

  // Lista miast do filtra — z lokalizacji WSZYSTKICH firm, także zawieszonych
  // i szkiców; admin musi je znaleźć, choć na marketplace ich nie ma.
  const cityRows = await prisma.location.findMany({
    distinct: ["city"],
    orderBy: { city: "asc" },
    select: { city: true },
  });
  const cities = cityRows.map((row) => row.city);
  const city = params.miasto && cities.includes(params.miasto) ? params.miasto : undefined;

  const current = {
    status: status ?? undefined,
    typ: type ?? undefined,
    miasto: city,
    q: q || undefined,
  };

  // Filtry poza statusem — na nich liczą się liczniki chipów statusu.
  const baseWhere = {
    ...(type ? { type } : {}),
    ...(city ? { locations: { some: { city } } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { slug: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const where = { ...baseWhere, ...(status ? { status } : {}) };

  const [total, statusGroups, businesses] = await Promise.all([
    prisma.business.count({ where }),
    // Liczniki na chipach liczą się przy pozostałych filtrach, ale bez
    // filtra statusu — inaczej każdy chip pokazywałby własną wartość albo zero.
    prisma.business.groupBy({
      by: ["status"],
      where: baseWhere,
      _count: { _all: true },
    }),
    prisma.business.findMany({
      where,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        status: true,
        createdAt: true,
        verifiedAt: true,
        owner: { select: { name: true, email: true } },
        locations: {
          take: 1,
          orderBy: { createdAt: "asc" },
          select: { city: true },
        },
        _count: { select: { bookings: true, locations: true } },
      },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const dateFormatter = adminDateFormatter();
  const countFor = (value: BusinessStatus) =>
    statusGroups.find((row) => row.status === value)?._count._all ?? 0;
  const allCount = statusGroups.reduce((sum, row) => sum + row._count._all, 0);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <PageHeading
        title="Firmy"
        description="Wszystkie firmy platformy — łącznie ze szkicami i zawieszonymi, których nie widać na marketplace."
      />

      <form action={BASE_PATH} method="get" className="mb-3 flex flex-wrap gap-2">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        {/* Telefon: pole szukania na całą szerokość, selecty po pół wiersza,
            akcje w ostatnim wierszu. Od `md` wszystko wraca do jednej linii. */}
        <Input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Szukaj po nazwie lub slugu…"
          aria-label="Szukaj firmy"
          className="h-11 w-full rounded-full bg-card px-4 md:h-9 md:w-auto md:min-w-[12rem] md:flex-1"
        />
        <select
          name="typ"
          defaultValue={type ?? ""}
          aria-label="Typ firmy"
          className="h-11 min-w-0 flex-1 rounded-full border border-border bg-card px-4 text-[13px] md:h-9 md:flex-none"
        >
          <option value="">Każdy typ</option>
          {TYPE_VALUES.map((value) => (
            <option key={value} value={value}>
              {BUSINESS_TYPE_LABELS[value]}
            </option>
          ))}
        </select>
        <select
          name="miasto"
          defaultValue={city ?? ""}
          aria-label="Miasto"
          className="h-11 min-w-0 flex-1 rounded-full border border-border bg-card px-4 text-[13px] md:h-9 md:flex-none"
        >
          <option value="">Każde miasto</option>
          {cities.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <Button
          type="submit"
          className="h-11 flex-1 rounded-full px-5 font-semibold md:h-9 md:flex-none md:px-4"
        >
          Filtruj
        </Button>
        {q || type || city || status ? (
          <Button
            asChild
            variant="outline"
            className="h-11 flex-1 rounded-full px-4 md:h-9 md:flex-none"
          >
            <Link href={BASE_PATH}>Wyczyść</Link>
          </Button>
        ) : null}
      </form>

      <div className="mb-4">
        <ChipRow label="Status">
          <FilterChip
            href={filterHref(BASE_PATH, current, { status: undefined })}
            active={!status}
          >
            Wszystkie · {allCount}
          </FilterChip>
          {BUSINESS_STATUS_ORDER.map((value) => (
            <FilterChip
              key={value}
              href={filterHref(BASE_PATH, current, { status: value })}
              active={status === value}
            >
              {BUSINESS_STATUS_SHORT[value]} · {countFor(value)}
            </FilterChip>
          ))}
        </ChipRow>
      </div>

      {businesses.length === 0 ? (
        <EmptyState
          title="Brak wyników"
          description="Żadna firma nie pasuje do wybranych filtrów. Wyczyść filtry albo spróbuj innej frazy."
        />
      ) : (
        <>
          <p className="mb-2 font-mono text-[11px] text-muted-foreground">
            {pluralize(total, "firma", "firmy", "firm")}
            {q ? ` dla „${q}"` : ""} · sortowanie: status, potem najnowsze
          </p>
          <ul className="overflow-hidden rounded-2xl border border-border bg-card">
            <li
              aria-hidden
              className="hidden grid-cols-[minmax(0,1fr)_150px_120px_92px_92px] gap-3 border-b border-border px-5 py-2.5 font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase lg:grid"
            >
              <span>Firma</span>
              <span>Typ</span>
              <span>Miasto</span>
              <span className="text-right">Rezerwacje</span>
              <span className="text-right">Dodana</span>
            </li>
            {businesses.map((business) => (
              <li
                key={business.id}
                className="border-t border-border first:border-t-0"
              >
                <Link
                  href={`/admin/firmy/${business.id}`}
                  className="grid grid-cols-1 gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-muted/40 sm:px-5 lg:grid-cols-[minmax(0,1fr)_150px_120px_92px_92px] lg:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[14px] font-semibold">
                        {business.name}
                      </span>
                      <StatusPill tone={BUSINESS_STATUS_TONES[business.status]}>
                        {BUSINESS_STATUS_SHORT[business.status]}
                      </StatusPill>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      /{business.slug} ·{" "}
                      {business.owner.email ?? business.owner.name ?? "brak właściciela"}
                    </div>
                  </div>

                  {/* Telefon i tablet: metryki w jednej linii meta. */}
                  <div className="flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-muted-foreground lg:hidden">
                    <span>{BUSINESS_TYPE_LABELS[business.type]}</span>
                    {business.locations[0] ? (
                      <>
                        <span aria-hidden>·</span>
                        <span>{business.locations[0].city}</span>
                      </>
                    ) : null}
                    <span aria-hidden>·</span>
                    <span>{business._count.bookings} rez.</span>
                    <span aria-hidden>·</span>
                    <span>{dateFormatter.format(business.createdAt)}</span>
                  </div>

                  <span className="hidden truncate text-[12.5px] lg:block">
                    {BUSINESS_TYPE_LABELS[business.type]}
                  </span>
                  <span className="hidden truncate font-mono text-[12px] text-muted-foreground lg:block">
                    {business.locations[0]?.city ?? "—"}
                    {business._count.locations > 1
                      ? ` +${business._count.locations - 1}`
                      : ""}
                  </span>
                  <span className="hidden text-right font-mono text-[12px] lg:block">
                    {business._count.bookings}
                  </span>
                  <span className="hidden text-right font-mono text-[11px] text-muted-foreground lg:block">
                    {dateFormatter.format(business.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination
            page={page}
            pageCount={pageCount}
            hrefFor={(target) => pageHref(BASE_PATH, current, target)}
          />
        </>
      )}
    </div>
  );
}
