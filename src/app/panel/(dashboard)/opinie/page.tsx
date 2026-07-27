import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPanelBusiness } from "@/app/panel/data";
import {
  ReviewsList,
  ReviewStars,
  type PanelReview,
} from "@/components/panel/reviews-view";

/**
 * Opinie firmy: średnia + rozkład ocen 1–5 u góry, niżej lista opinii
 * z odpowiedziami właściciela i przełącznikiem publikacji.
 */

const RATING_VALUES = [5, 4, 3, 2, 1] as const;

/** Ile opinii renderujemy naraz (karty są interaktywne — klienckie). */
const REVIEWS_PAGE_SIZE = 50;

/** "3 opinie" z polską odmianą liczebnika. */
function reviewsCountLabel(count: number): string {
  if (count === 1) return "1 opinia";
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} opinie`;
  }
  return `${count} opinii`;
}

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ strona?: string }>;
}) {
  const panel = await getPanelBusiness();
  if (!panel) redirect("/panel/nowa");

  const { business, location, isManager } = panel;
  const tz = location?.timezone ?? "Europe/Warsaw";

  const { strona } = await searchParams;
  const page = Math.max(1, Number.parseInt(strona ?? "1", 10) || 1);

  // Stronicowanie: firma z tysiącami opinii nie może ładować wszystkich
  // wierszy (z joinem usług) i renderować tylu interaktywnych kart.
  const reviews = await prisma.review.findMany({
    where: { businessId: business.id },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * REVIEWS_PAGE_SIZE,
    take: REVIEWS_PAGE_SIZE,
    include: {
      author: { select: { name: true } },
      booking: {
        select: {
          items: {
            orderBy: { sortOrder: "asc" },
            select: { service: { select: { name: true } } },
          },
        },
      },
    },
  });

  // Średnia i rozkład z agregatu — po WSZYSTKICH opiniach, nie po stronie.
  const groups = await prisma.review.groupBy({
    by: ["rating", "isPublished"],
    where: { businessId: business.id },
    _count: { _all: true },
  });

  const sumOf = (rows: typeof groups) => ({
    count: rows.reduce((sum, row) => sum + row._count._all, 0),
    total: rows.reduce((sum, row) => sum + row.rating * row._count._all, 0),
  });
  const all = sumOf(groups);
  const published = sumOf(groups.filter((row) => row.isPublished));

  const count = all.count;
  const average = count > 0 ? all.total / count : 0;
  // Profil publiczny liczy ocenę wyłącznie z opublikowanych opinii — obie
  // liczby pokazujemy obok siebie, żeby ukrycie opinii nie wyglądało jak
  // rozjazd danych.
  const publicCount = published.count;
  const publicAverage = publicCount > 0 ? published.total / publicCount : 0;
  const distribution = RATING_VALUES.map((value) => ({
    value,
    count: groups
      .filter((row) => row.rating === value)
      .reduce((sum, row) => sum + row._count._all, 0),
  }));
  const pageCount = Math.max(1, Math.ceil(count / REVIEWS_PAGE_SIZE));

  const dateFormatter = new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: tz,
  });

  const rows: PanelReview[] = reviews.map((review) => ({
    id: review.id,
    authorName: review.author.name ?? "Klient",
    rating: review.rating,
    comment: review.comment,
    reply: review.reply,
    replyDateLabel: review.repliedAt
      ? dateFormatter.format(review.repliedAt)
      : null,
    isPublished: review.isPublished,
    dateLabel: dateFormatter.format(review.createdAt),
    serviceName:
      review.booking.items.map((item) => item.service.name).join(" + ") ||
      null,
  }));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-5">
        <h1 className="font-display text-[22px] leading-tight font-extrabold tracking-tight sm:text-[27px]">
          Opinie
        </h1>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          Opinie klientów po zakończonych wizytach — odpowiadaj i decyduj,
          które są widoczne na profilu.
        </p>
      </div>

      {count === 0 ? (
        <EmptyState />
      ) : (
        <>
          <section className="mb-4 flex flex-col gap-5 rounded-2xl border-[1.5px] border-border-strong bg-card p-4 sm:flex-row sm:items-center sm:gap-8 sm:p-5">
            <div className="shrink-0">
              <div className="flex items-baseline gap-1.5">
                <span className="font-display text-5xl leading-none font-extrabold tracking-tight">
                  {average.toLocaleString("pl-PL", {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}
                </span>
                <span className="font-mono text-[12px] text-muted-foreground">
                  / 5
                </span>
              </div>
              <ReviewStars rating={average} className="mt-2" />
              <div className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                {reviewsCountLabel(count)} · wszystkie opinie
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                na profilu:{" "}
                <span className="font-medium text-foreground">
                  {publicAverage.toLocaleString("pl-PL", {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}
                </span>{" "}
                ({reviewsCountLabel(publicCount)})
              </div>
            </div>
            <div className="flex w-full flex-1 flex-col gap-1.5 sm:max-w-md">
              {distribution.map((entry) => (
                <div key={entry.value} className="flex items-center gap-2.5">
                  <span className="w-3 text-right font-mono text-[11px] text-muted-foreground">
                    {entry.value}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(entry.count / count) * 100}%` }}
                    />
                  </div>
                  <span className="w-5 font-mono text-[11px] text-muted-foreground">
                    {entry.count}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <ReviewsList
            businessId={business.id}
            reviews={rows}
            canManage={isManager}
          />

          {pageCount > 1 ? (
            <nav className="mt-5 flex items-center justify-between gap-3 font-mono text-[12px]">
              {page > 1 ? (
                <Link
                  href={`/panel/opinie?strona=${page - 1}`}
                  className="rounded-full border border-border px-3 py-1.5 font-semibold hover:bg-muted"
                >
                  ‹ Nowsze
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted-foreground">
                strona {page} z {pageCount}
              </span>
              {page < pageCount ? (
                <Link
                  href={`/panel/opinie?strona=${page + 1}`}
                  className="rounded-full border border-border px-3 py-1.5 font-semibold hover:bg-muted"
                >
                  Starsze ›
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center rounded-2xl border border-border bg-card px-6 py-20">
      <div className="max-w-md text-center">
        <h2 className="font-display text-2xl font-extrabold tracking-tight">
          Brak opinii
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Klienci mogą wystawić opinię po zakończonej wizycie — pierwsza pojawi
          się tutaj.
        </p>
      </div>
    </div>
  );
}
