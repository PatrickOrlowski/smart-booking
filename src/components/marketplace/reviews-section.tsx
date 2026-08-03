import {
  DEFAULT_LOCALE,
  INTL_LOCALE,
  createPluralTranslator,
  createTranslator,
  type Locale,
} from "@/i18n";

/**
 * Zakładka „Opinie" profilu firmy: nagłówek ze średnią i rozkładem ocen,
 * lista opinii z odpowiedziami właściciela. Wspólna dla salonu i restauracji.
 */

export type ProfileReview = {
  id: string;
  rating: number;
  comment: string | null;
  reply: string | null;
  repliedAt: Date | null;
  createdAt: Date;
  author: { name: string | null };
};

export type RatingDistributionRow = {
  stars: number;
  count: number;
  percent: number;
};

/** "1 opinia" / "3 opinie" / "12 opinii" — Intl.PluralRules. */
export function reviewsCountLabel(
  count: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return createPluralTranslator(locale)("plural.reviews", count);
}

/** Gwiazdki 1–5 — wypełnione atramentem, reszta w kolorze obramowań. */
export function Stars({
  rating,
  locale = DEFAULT_LOCALE,
}: {
  rating: number;
  locale?: Locale;
}) {
  const t = createTranslator(locale);
  return (
    <span
      role="img"
      aria-label={t("reviews.ratingAria", { rating })}
      className="font-mono text-[13px] tracking-[0.15em]"
    >
      <span>{"★".repeat(rating)}</span>
      <span className="text-border">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

export function ReviewsSection({
  reviews,
  total,
  ratingScore,
  distribution,
  timezone,
  locale = DEFAULT_LOCALE,
  emptyTitle,
  emptyText,
}: {
  /** Najnowsze opinie do wyrenderowania (średnia idzie z agregatu). */
  reviews: ProfileReview[];
  total: number;
  ratingScore: string;
  distribution: RatingDistributionRow[];
  timezone: string;
  locale?: Locale;
  emptyTitle?: string;
  emptyText?: string;
}) {
  const t = createTranslator(locale);
  const reviewDateLabel = (date: Date) =>
    new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: timezone,
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);

  if (total === 0) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <h2 className="mb-2 font-display text-[24px] leading-tight font-extrabold tracking-tight">
          {emptyTitle ?? t("reviews.emptyTitle")}
        </h2>
        <p className="mx-auto max-w-[280px] text-[13px] leading-relaxed text-muted-foreground">
          {emptyText ?? t("reviews.emptyTextSalon")}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mt-5 flex items-center gap-6 rounded-2xl border border-border bg-card p-4 md:gap-8 md:p-5">
        <div className="flex-none text-center">
          <div className="font-display text-[44px] leading-none font-extrabold tracking-tight">
            {ratingScore}
          </div>
          <div className="mt-1.5 font-mono text-[11px] text-muted-foreground">
            {reviewsCountLabel(total, locale)}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
          {distribution.map((row) => (
            <div key={row.stars} className="flex items-center gap-2.5">
              <span className="w-3 flex-none text-right font-mono text-[11px] text-muted-foreground">
                {row.stars}
              </span>
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-foreground"
                  style={{ width: `${row.percent}%` }}
                />
              </div>
              <span className="w-6 flex-none font-mono text-[11px] text-muted-foreground">
                {row.count}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 flex flex-col">
        {reviews.map((review) => (
          <article
            key={review.id}
            className="border-t border-muted py-4 first:border-t-0"
          >
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0 truncate text-[14px] font-bold">
                {review.author.name ?? t("reviews.client")}
              </div>
              <div className="flex-none font-mono text-[11px] text-muted-foreground">
                {reviewDateLabel(review.createdAt)}
              </div>
            </div>
            <div className="mt-0.5">
              <Stars rating={review.rating} locale={locale} />
            </div>
            {review.comment ? (
              <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/80">
                {review.comment}
              </p>
            ) : null}
            {review.reply ? (
              <div className="mt-3 ml-4 rounded-r-xl border-l-2 border-border-strong bg-muted/60 py-2.5 pr-3.5 pl-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="meta-label">{t("reviews.ownerReply")}</div>
                  {review.repliedAt ? (
                    <div className="flex-none font-mono text-[10px] text-muted-foreground">
                      {reviewDateLabel(review.repliedAt)}
                    </div>
                  ) : null}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-foreground/80">
                  {review.reply}
                </p>
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {total > reviews.length ? (
        <p className="border-t border-muted pt-4 text-[12.5px] text-muted-foreground">
          {t("reviews.showingOf", { shown: reviews.length, total })}
        </p>
      ) : null}
    </>
  );
}
