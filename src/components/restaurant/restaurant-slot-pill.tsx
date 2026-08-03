"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/i18n/client";
import { localIsoDate, tableSlotLabel } from "./format";
import { TableSlotBadge } from "./table-slot-badge";

/**
 * „Stolik dziś od 18:00" doliczany w przeglądarce.
 *
 * Listingi miast i kategorii są statyczne (ISR co godzinę), więc słowo „dziś"
 * nie może pochodzić z czasu builda — pastylka odpytuje API po zamontowaniu
 * i do tego czasu pokazuje neutralny placeholder. Dzień liczymy w strefie
 * LOKALU, nie przeglądarki.
 *
 * Żądanie idzie w trybie `nearest=1`: odpowiedź to JEDNA data zamiast kompletu
 * slotów z trzech dni (czytamy i tak tylko pierwszy), a serwer oznacza ją jako
 * cache'owalną na 60 s — listing z 20 restauracjami nie przesyła wtedy
 * dwudziestu pełnych siatek godzin.
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
  const locale = useLocale();
  const [label, setLabel] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    const now = new Date();
    const params = new URLSearchParams({
      date: localIsoDate(now, timezone),
      partySize: String(partySize),
      days: String(LOOKAHEAD_DAYS),
      nearest: "1",
    });
    fetch(`/api/v1/restaurants/${slug}/availability?${params}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("availability");
        const data = (await response.json()) as { nearest: string | null };
        setLabel(
          data.nearest
            ? tableSlotLabel(new Date(data.nearest), timezone, locale, new Date())
            : null,
        );
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setLabel(null);
      });
    return () => controller.abort();
  }, [slug, timezone, partySize, locale]);

  return (
    <TableSlotBadge
      label={label}
      variant={variant}
      className={className}
      locale={locale}
    />
  );
}
