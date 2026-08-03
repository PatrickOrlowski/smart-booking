import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/admin-auth";
import {
  REPORT_STATUS_LABELS,
  REPORT_STATUS_ORDER,
  REPORT_STATUS_TONES,
  REPORT_TARGET_LABELS,
  REPORT_TARGET_ORDER,
  adminDateTimeFormatter,
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
import type { ReportStatus, ReportTargetType } from "@/generated/prisma/enums";

/**
 * Kolejka zgłoszeń nadużyć: filtr po statusie i typie zgłaszanego obiektu.
 * Domyślnie sortowane od najnowszych — najstarsze otwarte sprawy znajdzie
 * filtr statusu, a nie ukryty porządek listy.
 */

const PAGE_SIZE = 20;
const BASE_PATH = "/admin/zgloszenia";

function parseStatus(value: string | undefined): ReportStatus | undefined {
  return REPORT_STATUS_ORDER.includes(value as ReportStatus)
    ? (value as ReportStatus)
    : undefined;
}

function parseTarget(value: string | undefined): ReportTargetType | undefined {
  return REPORT_TARGET_ORDER.includes(value as ReportTargetType)
    ? (value as ReportTargetType)
    : undefined;
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; typ?: string; strona?: string }>;
}) {
  await requirePlatformAdmin();

  const params = await searchParams;
  const status = parseStatus(params.status);
  const targetType = parseTarget(params.typ);
  const page = Math.max(1, Number.parseInt(params.strona ?? "1", 10) || 1);

  const current = { status, typ: targetType };

  const where = {
    ...(status ? { status } : {}),
    ...(targetType ? { targetType } : {}),
  };

  const [total, statusGroups, targetGroups, reports] = await Promise.all([
    prisma.abuseReport.count({ where }),
    prisma.abuseReport.groupBy({
      by: ["status"],
      where: targetType ? { targetType } : {},
      _count: { _all: true },
    }),
    prisma.abuseReport.groupBy({
      by: ["targetType"],
      where: status ? { status } : {},
      _count: { _all: true },
    }),
    prisma.abuseReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        targetType: true,
        targetId: true,
        reason: true,
        details: true,
        status: true,
        createdAt: true,
        reporterEmail: true,
        reporter: { select: { name: true, email: true } },
      },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const formatter = adminDateTimeFormatter();
  const statusCount = (value: ReportStatus) =>
    statusGroups.find((row) => row.status === value)?._count._all ?? 0;
  const targetCount = (value: ReportTargetType) =>
    targetGroups.find((row) => row.targetType === value)?._count._all ?? 0;
  const allStatusCount = statusGroups.reduce(
    (sum, row) => sum + row._count._all,
    0,
  );
  const allTargetCount = targetGroups.reduce(
    (sum, row) => sum + row._count._all,
    0,
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <PageHeading
        title="Zgłoszenia nadużyć"
        description="Sprawy zgłoszone przez użytkowników i gości: firmy, opinie i konta. Każda decyzja wymaga notatki."
      />

      <div className="mb-2">
        <ChipRow label="Status">
          <FilterChip
            href={filterHref(BASE_PATH, current, { status: undefined })}
            active={!status}
          >
            Wszystkie · {allStatusCount}
          </FilterChip>
          {REPORT_STATUS_ORDER.map((value) => (
            <FilterChip
              key={value}
              href={filterHref(BASE_PATH, current, { status: value })}
              active={status === value}
            >
              {REPORT_STATUS_LABELS[value]} · {statusCount(value)}
            </FilterChip>
          ))}
        </ChipRow>
      </div>

      <div className="mb-4">
        <ChipRow label="Cel">
          <FilterChip
            href={filterHref(BASE_PATH, current, { typ: undefined })}
            active={!targetType}
          >
            Wszystkie · {allTargetCount}
          </FilterChip>
          {REPORT_TARGET_ORDER.map((value) => (
            <FilterChip
              key={value}
              href={filterHref(BASE_PATH, current, { typ: value })}
              active={targetType === value}
            >
              {REPORT_TARGET_LABELS[value]} · {targetCount(value)}
            </FilterChip>
          ))}
        </ChipRow>
      </div>

      {reports.length === 0 ? (
        <EmptyState
          title="Brak zgłoszeń"
          description="Żadne zgłoszenie nie pasuje do wybranych filtrów. Zmień filtr albo wróć do wszystkich spraw."
        />
      ) : (
        <>
          <p className="mb-2 font-mono text-[11px] text-muted-foreground">
            {pluralize(total, "zgłoszenie", "zgłoszenia", "zgłoszeń")} · najnowsze u góry
          </p>
          <ul className="overflow-hidden rounded-2xl border border-border bg-card">
            {reports.map((report) => {
              const reporter =
                report.reporter?.email ??
                report.reporter?.name ??
                report.reporterEmail ??
                "zgłoszenie anonimowe";
              return (
                <li
                  key={report.id}
                  className="border-t border-border first:border-t-0"
                >
                  <Link
                    href={`${BASE_PATH}/${report.id}`}
                    className="block px-4 py-3.5 transition-colors hover:bg-muted/40 sm:px-5"
                  >
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                      <StatusPill tone={REPORT_STATUS_TONES[report.status]}>
                        {REPORT_STATUS_LABELS[report.status]}
                      </StatusPill>
                      <StatusPill tone="bg-muted text-foreground/80">
                        {REPORT_TARGET_LABELS[report.targetType]}
                      </StatusPill>
                      <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                        {formatter.format(report.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[14px] font-semibold">
                      {report.reason}
                    </p>
                    {report.details ? (
                      <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-muted-foreground">
                        {report.details}
                      </p>
                    ) : null}
                    <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      zgłosił: {reporter}
                    </p>
                  </Link>
                </li>
              );
            })}
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
