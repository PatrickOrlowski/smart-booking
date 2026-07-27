"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StarIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { initials } from "@/components/panel/format";
import {
  saveReviewReplyAction,
  toggleReviewPublishedAction,
} from "@/app/panel/(dashboard)/opinie/actions";

/**
 * Lista opinii firmy z akcjami właściciela: odpowiedź (zapis i edycja)
 * oraz przełącznik publikacji. Dane przychodzą już sformatowane z serwera
 * (daty w strefie lokalizacji).
 */

export type PanelReview = {
  id: string;
  authorName: string;
  rating: number;
  comment: string | null;
  reply: string | null;
  /** Data odpowiedzi w strefie lokalizacji — null, gdy brak odpowiedzi. */
  replyDateLabel: string | null;
  isPublished: boolean;
  dateLabel: string;
  serviceName: string | null;
};

/**
 * Ocena gwiazdkami 1–5 — atrament na wypełnionych, wyblakłe puste.
 * Obsługuje wartości ułamkowe (średnia 4,5 = połowa piątej gwiazdki).
 */
export function ReviewStars({
  rating,
  className,
}: {
  rating: number;
  className?: string;
}) {
  return (
    <span
      className={cn("flex items-center gap-0.5", className)}
      role="img"
      aria-label={`Ocena ${rating.toLocaleString("pl-PL", {
        maximumFractionDigits: 1,
      })} na 5`}
    >
      {[1, 2, 3, 4, 5].map((value) => {
        const fill = Math.min(Math.max(rating - (value - 1), 0), 1);
        return (
          <span key={value} className="relative block size-[14px]">
            <StarIcon aria-hidden className="size-[14px] text-muted-foreground/40" />
            {fill > 0 && (
              <span
                className="absolute inset-y-0 left-0 overflow-hidden"
                style={{ width: `${fill * 100}%` }}
              >
                <StarIcon
                  aria-hidden
                  className="size-[14px] max-w-none fill-foreground text-foreground"
                />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

export function ReviewsList({
  businessId,
  reviews,
  canManage,
}: {
  businessId: string;
  reviews: PanelReview[];
  canManage: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {reviews.map((review) => (
        <ReviewCard
          key={review.id}
          businessId={businessId}
          review={review}
          canManage={canManage}
        />
      ))}
    </div>
  );
}

function ReviewCard({
  businessId,
  review,
  canManage,
}: {
  businessId: string;
  review: PanelReview;
  canManage: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(review.reply ?? "");

  // Opinia bez odpowiedzi ma textarea od razu; istniejąca — po "Edytuj".
  const showEditor = canManage && (editing || !review.reply);

  const saveReply = () => {
    startTransition(async () => {
      const result = await saveReviewReplyAction({
        businessId,
        reviewId: review.id,
        reply: draft,
      });
      if (result.ok) {
        toast.success("Odpowiedź zapisana");
        setEditing(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const togglePublished = (next: boolean) => {
    startTransition(async () => {
      const result = await toggleReviewPublishedAction({
        businessId,
        reviewId: review.id,
        isPublished: next,
      });
      if (result.ok) {
        toast.success(
          next ? "Opinia widoczna na profilu" : "Opinia ukryta z profilu",
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <article
      className={cn(
        "rounded-2xl border border-border bg-card p-4 sm:p-5",
        !review.isPublished && "border-dashed bg-card/60",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted font-display text-[12px] font-bold">
            {initials(review.authorName)}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="truncate text-[13.5px] font-bold">
                {review.authorName}
              </span>
              <ReviewStars rating={review.rating} />
            </div>
            <div className="font-mono text-[10.5px] text-muted-foreground">
              {review.dateLabel}
              {review.serviceName ? ` · ${review.serviceName}` : ""}
            </div>
          </div>
        </div>

        {canManage && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 sm:min-h-0">
            <span
              className={cn(
                "font-mono text-[10px] tracking-[0.08em] uppercase",
                review.isPublished
                  ? "text-muted-foreground"
                  : "text-warning-strong",
              )}
            >
              {review.isPublished ? "Widoczna" : "Ukryta"}
            </span>
            <Switch
              checked={review.isPublished}
              onCheckedChange={togglePublished}
              disabled={isPending}
              aria-label="Pokazuj opinię na publicznym profilu"
            />
          </label>
        )}
      </div>

      {review.comment && (
        <p className="mt-3 text-[13.5px] leading-relaxed">{review.comment}</p>
      )}

      {review.reply && !showEditor && (
        <div className="mt-3 rounded-xl bg-muted/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="meta-label">
              Odpowiedź właściciela
              {review.replyDateLabel ? ` · ${review.replyDateLabel}` : ""}
            </span>
            {canManage && (
              <button
                type="button"
                onClick={() => {
                  setDraft(review.reply ?? "");
                  setEditing(true);
                }}
                className="text-[11.5px] font-semibold text-primary hover:underline"
              >
                Edytuj
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed">{review.reply}</p>
        </div>
      )}

      {showEditor && (
        <div className="mt-3">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Napisz odpowiedź widoczną na publicznym profilu…"
            maxLength={1000}
            className="min-h-20 bg-background text-[13px]"
            aria-label="Odpowiedź właściciela"
          />
          <div className="mt-2 flex items-center gap-2">
            <Button
              size="sm"
              className="h-9 rounded-full px-4 font-semibold lg:h-8"
              disabled={isPending || draft.trim().length < 2}
              onClick={saveReply}
            >
              {review.reply ? "Zapisz zmiany" : "Odpowiedz"}
            </Button>
            {review.reply && (
              <Button
                size="sm"
                variant="ghost"
                className="h-9 rounded-full px-4 lg:h-8"
                disabled={isPending}
                onClick={() => setEditing(false)}
              >
                Anuluj
              </Button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
