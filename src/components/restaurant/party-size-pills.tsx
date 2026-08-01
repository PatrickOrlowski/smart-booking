"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Wybór liczby osób: pigułki 1–5 plus „6+", które rozwija drugi rząd
 * (6 … `max`). Duże grupy zostają na ekranie — to one trafiają na kartę
 * „Duża grupa" z telefonem do lokalu, więc muszą być klikalne.
 */

const BASE = [1, 2, 3, 4, 5];

export function PartySizePills({
  value,
  onChange,
  max = 12,
  className,
}: {
  value: number;
  onChange: (partySize: number) => void;
  max?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const showMore = expanded || value >= 6;
  const more = Array.from({ length: Math.max(0, max - 5) }, (_, i) => i + 6);

  const pill = (active: boolean) =>
    cn(
      "flex min-h-11 min-w-11 flex-none items-center justify-center rounded-full px-3.5 text-[13px] font-semibold transition-colors",
      active
        ? "bg-primary text-primary-foreground"
        : "border border-border bg-card text-foreground/80 hover:border-border-strong",
    );

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        role="group"
        aria-label="Liczba osób"
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5"
      >
        {BASE.map((size) => (
          <button
            key={size}
            type="button"
            aria-pressed={value === size}
            onClick={() => {
              setExpanded(false);
              onChange(size);
            }}
            className={pill(value === size)}
          >
            {size}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={value >= 6}
          onClick={() => {
            setExpanded(true);
            if (value < 6) onChange(6);
          }}
          className={pill(value >= 6)}
        >
          6+
        </button>
      </div>

      {showMore ? (
        <div
          role="group"
          aria-label="Liczba osób — grupa"
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5"
        >
          {more.map((size) => (
            <button
              key={size}
              type="button"
              aria-pressed={value === size}
              onClick={() => onChange(size)}
              className={pill(value === size)}
            >
              {size}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
