import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/admin-auth";
import {
  USER_ROLE_LABELS,
  USER_ROLE_ORDER,
  USER_ROLE_SHORT,
  USER_ROLE_TONES,
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
import type { UserRole } from "@/generated/prisma/enums";

/**
 * Konta platformy: rola, kontakt, data rejestracji i liczba rezerwacji.
 * Szukanie po imieniu, e-mailu i telefonie (formularz GET, zero JS).
 */

const PAGE_SIZE = 25;
const BASE_PATH = "/admin/uzytkownicy";

function parseRole(value: string | undefined): UserRole | undefined {
  return USER_ROLE_ORDER.includes(value as UserRole)
    ? (value as UserRole)
    : undefined;
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; rola?: string; strona?: string }>;
}) {
  await requirePlatformAdmin();

  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const role = parseRole(params.rola);
  const page = Math.max(1, Number.parseInt(params.strona ?? "1", 10) || 1);

  const current = { q: q || undefined, rola: role };

  const searchWhere = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};
  const where = { ...searchWhere, ...(role ? { role } : {}) };

  const [total, roleGroups, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.groupBy({
      by: ["role"],
      where: searchWhere,
      _count: { _all: true },
    }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
        _count: { select: { bookings: true, ownedBusinesses: true } },
      },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const dateFormatter = adminDateFormatter();
  const roleCount = (value: UserRole) =>
    roleGroups.find((row) => row.role === value)?._count._all ?? 0;
  const allCount = roleGroups.reduce((sum, row) => sum + row._count._all, 0);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <PageHeading
        title="Użytkownicy"
        description="Wszystkie konta platformy — klienci, właściciele, pracownicy i administratorzy."
      />

      <form action={BASE_PATH} method="get" className="mb-3 flex flex-wrap gap-2">
        {role ? <input type="hidden" name="rola" value={role} /> : null}
        <Input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Szukaj po imieniu, e-mailu lub telefonie…"
          aria-label="Szukaj użytkownika"
          className="h-11 w-full rounded-full bg-card px-4 md:h-9 md:w-auto md:min-w-[12rem] md:flex-1"
        />
        <Button
          type="submit"
          className="h-11 flex-1 rounded-full px-5 font-semibold md:h-9 md:flex-none md:px-4"
        >
          Szukaj
        </Button>
        {q || role ? (
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
        <ChipRow label="Rola">
          <FilterChip
            href={filterHref(BASE_PATH, current, { rola: undefined })}
            active={!role}
          >
            Wszyscy · {allCount}
          </FilterChip>
          {USER_ROLE_ORDER.map((value) => (
            <FilterChip
              key={value}
              href={filterHref(BASE_PATH, current, { rola: value })}
              active={role === value}
            >
              {USER_ROLE_LABELS[value]} · {roleCount(value)}
            </FilterChip>
          ))}
        </ChipRow>
      </div>

      {users.length === 0 ? (
        <EmptyState
          title="Brak wyników"
          description="Żadne konto nie pasuje do wyszukiwania. Spróbuj innego adresu e-mail, imienia albo numeru telefonu."
        />
      ) : (
        <>
          <p className="mb-2 font-mono text-[11px] text-muted-foreground">
            {pluralize(total, "konto", "konta", "kont")}
            {q ? ` dla „${q}"` : ""} · najnowsze u góry
          </p>
          <ul className="overflow-hidden rounded-2xl border border-border bg-card">
            <li
              aria-hidden
              className="hidden grid-cols-[minmax(0,1fr)_160px_92px_92px] gap-3 border-b border-border px-5 py-2.5 font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase md:grid"
            >
              <span>Konto</span>
              <span>Rola</span>
              <span className="text-right">Rezerwacje</span>
              <span className="text-right">Rejestracja</span>
            </li>
            {users.map((user) => (
              <li key={user.id} className="border-t border-border first:border-t-0">
                <Link
                  href={`${BASE_PATH}/${user.id}`}
                  className="grid grid-cols-1 gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-muted/40 sm:px-5 md:grid-cols-[minmax(0,1fr)_160px_92px_92px] md:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[14px] font-semibold">
                        {user.name ?? "Konto bez imienia"}
                      </span>
                      {user._count.ownedBusinesses > 0 ? (
                        <StatusPill tone="bg-accent text-accent-foreground">
                          {pluralize(
                            user._count.ownedBusinesses,
                            "firma",
                            "firmy",
                            "firm",
                          )}
                        </StatusPill>
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {user.email ?? "brak e-maila"}
                      {user.phone ? ` · ${user.phone}` : ""}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 md:hidden">
                    <StatusPill tone={USER_ROLE_TONES[user.role]}>
                      {USER_ROLE_SHORT[user.role]}
                    </StatusPill>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {user._count.bookings} rez. ·{" "}
                      {dateFormatter.format(user.createdAt)}
                    </span>
                  </div>

                  <span className="hidden md:block">
                    <StatusPill tone={USER_ROLE_TONES[user.role]}>
                      {USER_ROLE_SHORT[user.role]}
                    </StatusPill>
                  </span>
                  <span className="hidden text-right font-mono text-[12px] md:block">
                    {user._count.bookings}
                  </span>
                  <span className="hidden text-right font-mono text-[11px] text-muted-foreground md:block">
                    {dateFormatter.format(user.createdAt)}
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
