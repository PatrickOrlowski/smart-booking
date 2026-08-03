"use client";

import { useState, useTransition } from "react";

import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { createReviewAction } from "@/app/konto/actions";
import { useTranslations } from "@/i18n/client";

/**
 * Formularz „Oceń wizytę" — 5 gwiazdek + komentarz. Po udanym zapisie
 * revalidatePath odświeża listę i w miejscu formularza pojawia się opinia.
 */
export function ReviewForm({ bookingId }: { bookingId: string }) {
  const { t } = useTranslations();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    if (rating === 0) {
      setError(t("konto.review.pickStars"));
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createReviewAction({ bookingId, rating, comment });
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <div className="mt-3 rounded-xl border border-border bg-background/60 p-3.5">
      <div className="meta-label">{t("konto.review.label")}</div>
      <div
        className="mt-1.5 flex items-center gap-0.5"
        role="radiogroup"
        aria-label={t("konto.review.starsAria")}
      >
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={t("konto.review.starOf", { value })}
            onClick={() => setRating(value)}
            className={cn(
              "flex size-11 cursor-pointer items-center justify-center rounded-lg text-[24px] leading-none transition-colors hover:bg-muted md:size-9 md:text-[22px]",
              value <= rating ? "text-warning" : "text-border-strong/30",
            )}
          >
            ★
          </button>
        ))}
        {rating > 0 ? (
          <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
            {rating}/5
          </span>
        ) : null}
      </div>
      <Textarea
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder={t("konto.review.placeholder")}
        maxLength={1000}
        className="mt-2.5 min-h-[72px] rounded-xl border-border bg-card text-[13px]"
      />
      {error ? (
        <p role="alert" className="mt-2 text-[12.5px] font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        className="mt-2.5 inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full bg-primary px-5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-60"
      >
        {isPending ? t("konto.review.pending") : t("konto.review.submit")}
      </button>
    </div>
  );
}
