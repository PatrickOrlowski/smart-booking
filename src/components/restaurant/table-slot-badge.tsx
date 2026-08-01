import { cn } from "@/lib/utils";

/**
 * Wskaźnik najbliższego wolnego stolika na karcie listingu.
 *
 * `label === undefined` to stan „liczymy" (pastylka doliczana w przeglądarce
 * na stronach statycznych), `null` to brak wolnych stolików.
 */
export function TableSlotBadge({
  label,
  variant = "text",
  className,
}: {
  label: string | null | undefined;
  variant?: "pill" | "text";
  className?: string;
}) {
  const text =
    label === undefined
      ? "Sprawdzamy wolne stoliki…"
      : (label ?? "Brak wolnych stolików w tym tygodniu");

  if (variant === "pill") {
    return (
      <div
        className={cn(
          "flex items-center gap-[7px] rounded-lg border px-2.5 py-1.5",
          label
            ? "border-success-soft-border bg-success-soft"
            : "border-border bg-muted",
          className,
        )}
      >
        {label ? (
          <span className="size-1.5 flex-none rounded-full bg-success [animation:pulse-dot_1.8s_infinite]" />
        ) : null}
        <span
          className={cn(
            "text-xs font-semibold",
            label ? "text-primary" : "text-muted-foreground",
          )}
        >
          {text}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("text-xs text-muted-foreground", className)}>
      <span
        className={cn(
          "font-semibold",
          label ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {text}
      </span>
    </div>
  );
}
