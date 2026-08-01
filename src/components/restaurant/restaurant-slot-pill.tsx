"use client";

import { useEffect, useState } from "react";
import { localIsoDate, tableSlotLabel } from "./format";
import { TableSlotBadge } from "./table-slot-badge";
import type { AvailabilityResponse } from "./types";

/**
 * „Stolik dziś od 18:00" doliczany w przeglądarce.
 *
 * Listingi miast i kategorii są statyczne (ISR co godzinę), więc słowo „dziś"
 * nie może pochodzić z czasu builda — pastylka odpytuje API po zamontowaniu
 * i do tego czasu pokazuje neutralny placeholder. Dzień liczymy w strefie
 * LOKALU, nie przeglądarki.
 */

const LOOKAHEAD_DAYS = 3;

export function RestaurantSlotPill({
  slug,
  timezone,
  partySize = 2,
  variant = "text",
  className,
}: {
  slug: string;
  timezone: string;
  partySize?: number;
  variant?: "pill" | "text";
  className?: string;
}) {
  const [label, setLabel] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    const now = new Date();
    const params = new URLSearchParams({
      date: localIsoDate(now, timezone),
      partySize: String(partySize),
      days: String(LOOKAHEAD_DAYS),
    });
    fetch(`/api/v1/restaurants/${slug}/availability?${params}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("availability");
        const data = (await response.json()) as AvailabilityResponse;
        const first = (data.days ?? [{ slots: data.slots }]).flatMap(
          (day) => day.slots,
        )[0];
        setLabel(
          first
            ? tableSlotLabel(new Date(first.startAt), timezone, new Date())
            : null,
        );
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setLabel(null);
      });
    return () => controller.abort();
  }, [slug, timezone, partySize]);

  return (
    <TableSlotBadge label={label} variant={variant} className={className} />
  );
}
