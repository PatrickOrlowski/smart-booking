import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/admin-auth";
import {
  OPEN_REPORT_STATUSES,
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
} from "@/components/admin/ui";
import { AdminReviewCard, type AdminReview } from "@/components/admin/review-card";

/**
 * Moderacja opinii: wszystkie / zgłoszone / ukryte, opcjonalnie zawężone
 * do jednej firmy (`?firma=` — link z karty firmy).
 *
 * „Zgłoszone" = opinie z co najmniej jednym NIEROZPATRZONYM zgłoszeniem
 * nadużycia (OPEN albo IN_REVIEW). Po zamknięciu zgłoszenia opinia znika
 * z kolejki — inaczej lista rosłaby w nieskończoność i przestałaby być
 * kolejką pracy.
 */

const PAGE_SIZE = 20;
const BASE_PATH = "/admin/opinie";

type Filter = "zgloszone" | "ukryte" | undefined;

function parseFilter(value: string | undefined): Filter {
  return value === "zgloszone" || value === "ukryte" ? value : undefined;
}

export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ filtr?: string; firma?: string; strona?: string }>;
}) {
  await requirePlatformAdmin();

  const params = await searchParams;
  const filter = parseFilter(params.filtr);
  const page = Math.max(1, Number.parseInt(params.strona ?? "1", 10) || 1);

  const business = params.firma
    ? await prisma.business.findUnique({
        where: { id: params.firma },
        select: { id: true, name: true },
      })
    : null;

  // Zgłoszenia opinii są zjawiskiem rzadkim (rzędu dziesiątek), więc komplet
  // otwartych zgłoszeń mieści się w pamięci — jedno zapytanie zasila i filtr,
  // i pigułki „N zgłoszeń" przy poszczególnych opiniach.
  const reportGroups = await prisma.abuseReport.groupBy({
    by: ["targetId"],
    where: {
      targetType: "REVIEW",
      status: { in: [...OPEN_REPORT_STATUSES] },
    },
    _count: { _all: true },
  });
  const reportCounts = new Map(
    reportGroups.map((row) => [row.targetId, row._count._all]),
  );
  const reportedIds = [...reportCounts.keys()];

  const businessWhere = business ? { businessId: business.id } : {};
  const where = {
    ...businessWhere,
    ...(filter === "ukryte" ? { isPublished: false } : {}),
    ...(filter === "zgloszone" ? { id: { in: reportedIds } } : {}),
  };

  const current = {
    filtr: filter,
    firma: business?.id,
  };

  const [total, allCount, hiddenCount, reportedCount, reviews] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.count({ where: businessWhere }),
    prisma.review.count({ where: { ...businessWhere, isPublished: false } }),
    prisma.review.count({ where: { ...businessWhere, id: { in: reportedIds } } }),
    prisma.review.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        rating: true,
        comment: true,
        reply: true,
        isPublished: true,
        createdAt: true,
        businessId: true,
        author: { select: { name: true, email: true } },
        business: { select: { name: true, slug: true } },
      },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const dateFormatter = adminDateFormatter();

  const rows: AdminReview[] = reviews.map((review) => ({
    id: review.id,
    rating: review.rating,
    comment: review.comment,
    reply: review.reply,
    isPublished: review.isPublished,
    dateLabel: dateFormatter.format(review.createdAt),
    authorName: review.author.name ?? "Klient",
    authorEmail: review.author.email,
    businessId: review.businessId,
    businessName: review.business.name,
    businessSlug: review.business.slug,
    openReports: reportCounts.get(review.id) ?? 0,
  }));

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <PageHeading
        title="Opinie"
        description="Moderacja opinii w całym marketplace. Ukrycie zdejmuje opinię z profilu firmy i z jej oceny."
      />

      {business ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5">
          <span className="meta-label">Filtr firmy</span>
          <Link
            href={`/admin/firmy/${business.id}`}
            className="text-[13px] font-semibold underline underline-offset-2"
          >
            {business.name}
          </Link>
          <Link
            href={filterHref(BASE_PATH, current, { firma: undefined })}
            className="ml-auto font-mono text-[11px] text-muted-foreground hover:text-foreground"
          >
            usuń filtr ✕
          </Link>
        </div>
      ) : null}

      <div className="mb-4">
        <ChipRow>
          <FilterChip
            href={filterHref(BASE_PATH, current, { filtr: undefined })}
            active={!filter}
          >
            Wszystkie · {allCount}
          </FilterChip>
          <FilterChip
            href={filterHref(BASE_PATH, current, { filtr: "zgloszone" })}
            active={filter === "zgloszone"}
          >
            Zgłoszone · {reportedCount}
          </FilterChip>
          <FilterChip
            href={filterHref(BASE_PATH, current, { filtr: "ukryte" })}
            active={filter === "ukryte"}
          >
            Ukryte · {hiddenCount}
          </FilterChip>
        </ChipRow>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={filter ? "Pusto w tej kolejce" : "Brak opinii"}
          description={
            filter === "zgloszone"
              ? "Żadna opinia nie ma otwartego zgłoszenia nadużycia. To dobra wiadomość."
              : filter === "ukryte"
                ? "Żadna opinia nie jest ukryta — wszystkie są widoczne na profilach firm."
                : "Opinie pojawiają się po zakończonych wizytach."
          }
        />
      ) : (
        <>
          <p className="mb-2 font-mono text-[11px] text-muted-foreground">
            {pluralize(total, "opinia", "opinie", "opinii")} · najnowsze u góry
          </p>
          <ul className="overflow-hidden rounded-2xl border border-border bg-card">
            {rows.map((review) => (
              <li
                key={review.id}
                className="border-t border-border first:border-t-0"
              >
                <AdminReviewCard review={review} />
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
