"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runAction } from "@/components/panel/run-action";
import { setReviewVisibilityAction } from "@/app/admin/opinie/actions";
import { cn } from "@/lib/utils";

/**
 * Przełącznik widoczności opinii — jeden przycisk, dwa kierunki.
 * Używany na liście opinii i wprost z widoku zgłoszenia nadużycia.
 */
export function ReviewVisibilityButton({
  reviewId,
  isPublished,
  reportId,
  className,
}: {
  reviewId: string;
  isPublished: boolean;
  reportId?: string;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const toggle = () => {
    startTransition(async () => {
      const result = await runAction(() =>
        setReviewVisibilityAction({
          reviewId,
          isPublished: !isPublished,
          ...(reportId ? { reportId } : {}),
        }),
      );
      if (result.ok) {
        toast.success(
          isPublished
            ? "Opinia ukryta — zniknęła z profilu firmy"
            : "Opinia przywrócona na profil firmy",
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Button
      variant="outline"
      onClick={toggle}
      disabled={isPending}
      className={cn(
        "h-11 shrink-0 rounded-full px-4 text-[12.5px] font-semibold md:h-9",
        isPublished &&
          "text-destructive hover:bg-destructive/10 hover:text-destructive",
        className,
      )}
    >
      {isPending
        ? "Zapisywanie…"
        : isPublished
          ? "Ukryj opinię"
          : "Przywróć opinię"}
    </Button>
  );
}
