import { WEEKDAYS_LONG, minutesToLabel } from "@/components/marketplace/format";

/**
 * Lista godzin otwarcia per dzień tygodnia — zakładka „Info" i sticky karta
 * rezerwacji na profilu firmy (salon i restauracja korzystają z tej samej).
 */
export function OpeningHoursList({
  openingHours,
}: {
  openingHours: { weekday: number; startMinute: number; endMinute: number }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {WEEKDAYS_LONG.map((dayName, weekday) => {
        const blocks = openingHours.filter(
          (entry) => entry.weekday === weekday,
        );
        return (
          <div key={dayName} className="flex justify-between text-[13px]">
            <span className="capitalize">{dayName}</span>
            <span className="font-mono text-muted-foreground">
              {blocks.length === 0
                ? "zamknięte"
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
