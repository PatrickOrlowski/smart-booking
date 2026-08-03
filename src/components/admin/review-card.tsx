import Link from "next/link";
import { ReviewStars } from "@/components/panel/reviews-view";
import { pluralize } from "@/components/admin/format";
import { StatusPill } from "@/components/admin/ui";
import { ReviewVisibilityButton } from "@/components/admin/review-visibility-button";

export type AdminReview = {
  id: string;
  rating: number;
  comment: string | null;
  reply: string | null;
  isPublished: boolean;
  dateLabel: string;
  authorName: string;
  authorEmail: string | null;
  businessId: string;
  businessName: string;
  businessSlug: string;
  /** Liczba nierozpatrzonych zgłoszeń dotyczących tej opinii. */
  openReports: number;
};

/**
 * Opinia w panelu admina: treść, autor, firma i jedna akcja — ukryj/przywróć.
 * Odpowiedź właściciela pokazujemy razem z opinią, bo bez niej moderator
 * ocenia tylko połowę rozmowy.
 */
export function AdminReviewCard({
  review,
  reportId,
}: {
  review: AdminReview;
  reportId?: string;
}) {
  return (
    <article className="px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <ReviewStars rating={review.rating} />
        <span className="font-mono text-[11px] text-muted-foreground">
          {review.rating}/5
        </span>
        {review.isPublished ? (
          <StatusPill tone="bg-success-soft text-primary dark:text-accent-foreground">
            widoczna
          </StatusPill>
        ) : (
          <StatusPill tone="bg-muted text-muted-foreground">ukryta</StatusPill>
        )}
        {review.openReports > 0 ? (
          <StatusPill tone="bg-destructive/10 text-destructive">
            {pluralize(review.openReports, "zgłoszenie", "zgłoszenia", "zgłoszeń")}
          </StatusPill>
        ) : null}
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {review.dateLabel}
        </span>
      </div>

      {review.comment ? (
        <p className="mt-2 text-[13.5px] leading-relaxed">{review.comment}</p>
      ) : (
        <p className="mt-2 text-[13px] text-muted-foreground italic">
          Opinia bez treści — sama ocena.
        </p>
      )}

      {review.reply ? (
        <div className="mt-2.5 rounded-xl border border-border bg-muted/50 px-3 py-2.5">
          <span className="meta-label">Odpowiedź firmy</span>
          <p className="mt-1 text-[12.5px] leading-relaxed">{review.reply}</p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 font-mono text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{review.authorName}</span>
          {review.authorEmail ? ` · ${review.authorEmail}` : ""}
          {" · "}
          <Link
            href={`/admin/firmy/${review.businessId}`}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {review.businessName}
          </Link>
          {" · "}
          <Link
            href={`/b/${review.businessSlug}`}
            className="underline underline-offset-2 hover:text-foreground"
          >
            profil ↗
          </Link>
        </div>
        <ReviewVisibilityButton
          reviewId={review.id}
          isPublished={review.isPublished}
          reportId={reportId}
        />
      </div>
    </article>
  );
}
