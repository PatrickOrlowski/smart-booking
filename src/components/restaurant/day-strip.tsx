"use client";

import { cn } from "@/lib/utils";

/**
 * Pasek dni lokalnych lokalu (domyślnie 14). Przewija się we własnym
 * kontenerze — strona nigdy nie scrolluje poziomo, także na 390 px.
 */

export type StripDay = {
  iso: string;
  weekday: string;
  dayNumber: number;
  isToday: boolean;
};

export function DayStrip({
  days,
  selected,
  onSelect,
  className,
}: {
  days: StripDay[];
  selected: string;
  onSelect: (iso: string) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Wybór dnia"
      className={cn("-mx-5 flex gap-2 overflow-x-auto px-5 pb-1.5", className)}
    >
      {days.map((day) => {
        const active = day.iso === selected;
        return (
          <button
            key={day.iso}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(day.iso)}
            className={cn(
              "w-14 flex-none rounded-[14px] py-2.5 text-center",
              active
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-card",
            )}
          >
            <div
              className={cn(
                "text-[11px]",
                active ? "text-primary-foreground/70" : "text-[#8f8b81]",
              )}
            >
              {day.isToday ? "dziś" : day.weekday}
            </div>
            <div className="mt-0.5 font-mono text-[17px] font-medium">
              {day.dayNumber}
            </div>
          </button>
        );
      })}
    </div>
  );
}
