import { cn } from "@/lib/utils";

/**
 * Pastylka „Najbliższy wolny termin: dziś 15:30" — przepis z DESIGN.md:
 * bg-success-soft, obwódka success-soft-border, pulsująca kropka.
 */
export function AvailabilityPill({
  label,
  className,
}: {
  label: string | null;
  className?: string;
}) {
  if (!label) {
    return (
      <div
        className={cn(
          "flex items-center gap-[7px] rounded-lg border border-border bg-muted px-2.5 py-1.5",
          className,
        )}
      >
        <span className="text-xs font-semibold text-muted-foreground">
          Brak terminów w tym tygodniu
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-[7px] rounded-lg border border-success-soft-border bg-success-soft px-2.5 py-1.5",
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-success [animation:pulse-dot_1.8s_infinite]" />
      <span className="text-xs font-semibold text-primary">
        Najbliższy wolny termin: {label}
      </span>
    </div>
  );
}
