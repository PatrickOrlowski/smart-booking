import { cn } from "@/lib/utils";
import { DEFAULT_LOCALE, createTranslator, type Locale } from "@/i18n";

/**
 * Pastylka „Najbliższy wolny termin: dziś 15:30" — przepis z DESIGN.md:
 * bg-success-soft, obwódka success-soft-border, pulsująca kropka.
 */
export function AvailabilityPill({
  label,
  className,
  locale = DEFAULT_LOCALE,
}: {
  label: string | null;
  className?: string;
  locale?: Locale;
}) {
  const t = createTranslator(locale);

  if (!label) {
    return (
      <div
        className={cn(
          "flex items-center gap-[7px] rounded-lg border border-border bg-muted px-2.5 py-1.5",
          className,
        )}
      >
        <span className="text-xs font-semibold text-muted-foreground">
          {t("pill.noneWeek")}
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
        {t("pill.nearest", { label })}
      </span>
    </div>
  );
}
