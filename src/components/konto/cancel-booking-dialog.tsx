"use client";

import { useState, useTransition } from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cancelBookingAction } from "@/app/konto/actions";
import { useTranslations } from "@/i18n/client";

/**
 * Dialog potwierdzenia anulowania wizyty. Walidacja (własność, status,
 * cutoff) dzieje się w server action — komunikat błędu wraca do dialogu.
 */
export function CancelBookingDialog({
  bookingId,
  businessName,
  dateLabel,
  cutoffHours,
}: {
  bookingId: string;
  businessName: string;
  dateLabel: string;
  cutoffHours: number;
}) {
  const { t } = useTranslations();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      const result = await cancelBookingAction(bookingId);
      if (result.ok) {
        setOpen(false);
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-destructive/30 bg-card px-4 text-[13px] font-semibold text-destructive transition-colors hover:bg-destructive/10">
        {t("konto.cancel.trigger")}
      </DialogTrigger>
      <DialogContent className="rounded-2xl border border-border bg-card p-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-[22px] leading-tight font-extrabold tracking-tight">
            {t("konto.cancel.title")}
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed text-muted-foreground">
            {t("konto.cancel.description", {
              business: businessName,
              date: dateLabel,
              hours: cutoffHours,
            })}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] font-medium text-destructive"
          >
            {error}
          </p>
        ) : null}

        <DialogFooter className="mx-0 mb-0 rounded-b-none border-0 bg-transparent p-0 pt-1">
          <DialogClose className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border-[1.5px] border-border-strong bg-card px-4 text-[13px] font-semibold transition-colors hover:bg-muted">
            {t("konto.cancel.keep")}
          </DialogClose>
          <button
            type="button"
            onClick={confirm}
            disabled={isPending}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full bg-destructive px-4 text-[13px] font-semibold text-white transition-colors hover:bg-destructive/85 disabled:opacity-60"
          >
            {isPending ? t("konto.cancel.pending") : t("konto.cancel.confirm")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
