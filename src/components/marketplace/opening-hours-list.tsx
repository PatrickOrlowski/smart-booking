import {
  minutesToLabel,
  weekdaysLong,
} from "@/components/marketplace/format";
import { DEFAULT_LOCALE, createTranslator, type Locale } from "@/i18n";

/**
 * Lista godzin otwarcia per dzień tygodnia — zakładka „Info" i sticky karta
 * rezerwacji na profilu firmy (salon i restauracja korzystają z tej samej).
 */
export function OpeningHoursList({
  openingHours,
  locale = DEFAULT_LOCALE,
}: {
  openingHours: { weekday: number; startMinute: number; endMinute: number }[];
  locale?: Locale;
}) {
  const t = createTranslator(locale);

  return (
    <div className="flex flex-col gap-1.5">
      {weekdaysLong(locale).map((dayName, weekday) => {
        const blocks = openingHours.filter(
          (entry) => entry.weekday === weekday,
        );
        return (
          <div key={dayName} className="flex justify-between text-[13px]">
            <span className="capitalize">{dayName}</span>
            <span className="font-mono text-muted-foreground">
              {blocks.length === 0
                ? t("common.closed")
                : blocks
                    .map(
                      (block) =>
                        `${minutesToLabel(block.startMinute)}–${minutesToLabel(block.endMinute)}`,
                    )
                    .join(", ")}
            </span>
          </div>
        );
      })}
    </div>
  );
}
