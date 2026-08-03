"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { runAction } from "@/components/panel/run-action";
import { REPORT_TRANSITIONS } from "@/components/admin/format";
import { updateReportStatusAction } from "@/app/admin/zgloszenia/actions";
import type { ReportStatus } from "@/generated/prisma/enums";

/**
 * Decyzja w sprawie zgłoszenia: notatka + przyciski dozwolonych przejść.
 *
 * Przyciski wynikają z `REPORT_TRANSITIONS`, tej samej mapy, którą waliduje
 * serwer — UI nie zna skrótów, których backend by nie przyjął.
 */

const TRANSITION_COPY: Record<
  Exclude<ReportStatus, "OPEN">,
  { label: string; reopenLabel?: string; variant: "default" | "outline" | "destructive"; success: string }
> = {
  IN_REVIEW: {
    label: "Weź w obsługę",
    reopenLabel: "Wznów sprawę",
    variant: "outline",
    success: "Zgłoszenie w toku",
  },
  RESOLVED: {
    label: "Rozpatrz i zamknij",
    variant: "default",
    success: "Zgłoszenie rozpatrzone",
  },
  REJECTED: {
    label: "Odrzuć zgłoszenie",
    variant: "destructive",
    success: "Zgłoszenie odrzucone",
  },
};

export function ReportStatusForm({
  reportId,
  status,
  currentNote,
}: {
  reportId: string;
  status: ReportStatus;
  currentNote: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState(currentNote ?? "");

  const transitions = REPORT_TRANSITIONS[status];
  const isClosed = status === "RESOLVED" || status === "REJECTED";

  const submit = (target: Exclude<ReportStatus, "OPEN">) => {
    startTransition(async () => {
      const result = await runAction(() =>
        updateReportStatusAction({ reportId, status: target, note: note.trim() }),
      );
      if (result.ok) {
        toast.success(TRANSITION_COPY[target].success);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <section className="rounded-2xl border-[1.5px] border-border-strong bg-card px-4 py-4 sm:px-5">
      <h2 className="text-[14px] font-bold tracking-tight">Decyzja</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
        {isClosed
          ? "Sprawa jest zamknięta. Wznowienie cofa ją do obsługi i kasuje zapis kto oraz kiedy zdecydował."
          : "Notatka jest wymagana przy zamknięciu sprawy — trafia do zgłoszenia i do dziennika audytu."}
      </p>

      <div className="mt-3 flex flex-col gap-1.5">
        <Label htmlFor="report-note">Notatka z rozpatrzenia</Label>
        <Textarea
          id="report-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={4}
          placeholder="np. zweryfikowano rezerwację autora — opinia jest prawdziwa, zgłoszenie bezpodstawne"
        />
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {transitions.map((target) => {
          if (target === "OPEN") return null;
          const copy = TRANSITION_COPY[target];
          return (
            <Button
              key={target}
              variant={copy.variant}
              disabled={isPending}
              onClick={() => submit(target)}
              className="h-11 rounded-full px-5 font-semibold lg:h-9"
            >
              {isPending
                ? "Zapisywanie…"
                : target === "IN_REVIEW" && isClosed
                  ? (copy.reopenLabel ?? copy.label)
                  : copy.label}
            </Button>
          );
        })}
      </div>
    </section>
  );
}
