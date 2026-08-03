import type { SeriesStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { WEEKDAY_LABELS, formatMinutes } from "@/components/panel/format";

/**
 * Prezentacja reguły serii cyklicznej — wspólna dla listy, szczegółów
 * i dialogu tworzenia (moduł bez zależności serwerowych).
 */

/** 1 → „co tydzień", 4 → „co 4 tyg." */
export function formatSeriesInterval(intervalWeeks: number): string {
  return intervalWeeks === 1 ? "co tydzień" : `co ${intervalWeeks} tyg.`;
}

/** „co 4 tyg., czwartek 17:00" */
export function formatSeriesRule(rule: {
  intervalWeeks: number;
  weekday: number;
  startMinute: number;
}): string {
  const weekday = WEEKDAY_LABELS[rule.weekday] ?? "";
  return `${formatSeriesInterval(rule.intervalWeeks)}, ${weekday.toLowerCase()} ${formatMinutes(rule.startMinute)}`;
}

export const SERIES_STATUS_LABELS: Record<SeriesStatus, string> = {
  ACTIVE: "Aktywna",
  FINISHED: "Zakończona",
  CANCELLED: "Zamknięta",
};

const SERIES_STATUS_CLASSES: Record<SeriesStatus, string> = {
  ACTIVE: "border-success-soft-border bg-success-soft text-primary",
  FINISHED: "border-border bg-muted text-muted-foreground",
  CANCELLED: "border-border bg-muted text-muted-foreground",
};

export function SeriesStatusBadge({
  status,
  className,
}: {
  status: SeriesStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.06em] uppercase",
        SERIES_STATUS_CLASSES[status],
        className,
      )}
    >
      {SERIES_STATUS_LABELS[status]}
    </span>
  );
}

/** Dyskretny znacznik „wizyta z serii" — pętla cyklu. */
export function SeriesMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={cn("size-3.5 shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9M13.5 8a5.5 5.5 0 0 1-9.4 3.9" />
      <path d="M12.2 1.9v2.6h-2.6M3.8 14.1v-2.6h2.6" />
    </svg>
  );
}
