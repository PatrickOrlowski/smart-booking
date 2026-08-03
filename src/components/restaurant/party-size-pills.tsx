"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/i18n/client";

/**
 * Wybór liczby osób: pigułki `min`–5 plus „6+", które rozwija drugi rząd
 * (6 … `max`). Duże grupy zostają na ekranie — to one trafiają na kartę
 * „Duża grupa" z telefonem do lokalu, więc muszą być klikalne.
 *
 * `min` to najmniejsza grupa, jaką lokal fizycznie sadza: przy stolikach
 * „od 2 osób" pigułka „1" nie ma czego pokazać (silnik zawsze zwróci zero
 * slotów), więc znika z rzędu zamiast prowadzić w ślepy zaułek.
 */

const BASE = [1, 2, 3, 4, 5];

export function PartySizePills({
  value,
  onChange,
  min = 1,
  max = 12,
  className,
}: {
  value: number;
  onChange: (partySize: number) => void;
  min?: number;
  max?: number;
  className?: string;
}) {
  const { t } = useTranslations();
  const [expanded, setExpanded] = useState(false);
  const showMore = expanded || value >= 6;
  const base = BASE.filter((size) => size >= min);
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
        aria-label={t("common.partySize")}
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5"
      >
        {base.map((size) => (
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
          aria-label={t("common.partySizeGroup")}
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
