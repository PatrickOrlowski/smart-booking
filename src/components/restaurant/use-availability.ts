"use client";

import { useCallback, useEffect, useState } from "react";
import type { RestaurantArea } from "@/generated/prisma/enums";
import type { AvailabilityResponse, PartyTooLargeResponse } from "./types";

/**
 * Pobieranie wolnych godzin na stolik z GET /api/v1/restaurants/[slug]/availability.
 *
 * Stan „ładowanie" jest WYPROWADZANY z porównania klucza żądania z kluczem
 * ostatniego wyniku — efekt nigdy nie woła setState synchronicznie, więc
 * zmiana liczby osób nie powoduje pustej klatki z migotaniem.
 *
 * `initial` to wynik policzony na serwerze (server component woła
 * `getTableAvailabilityRange`, nie HTTP): dopóki gość nie zmieni parametrów,
 * hook nie robi ani jednego requestu.
 */

export type AvailabilityOutcome =
  | { kind: "ready"; data: AvailabilityResponse }
  | { kind: "tooLarge"; info: PartyTooLargeResponse }
  | { kind: "error"; message: string };

export type UseAvailabilityOptions = {
  slug: string;
  /** Dzień lokalny lokalu „YYYY-MM-DD"; null wyłącza pobieranie. */
  date: string | null;
  partySize: number;
  area?: RestaurantArea | null;
  /** Ile dni naprzód policzyć — powyżej 1 odpowiedź niesie pole `days`. */
  days?: number;
  /** Wynik z serwera dla dokładnie tych parametrów (SSR, days = 1). */
  initial?: {
    date: string;
    partySize: number;
    area: RestaurantArea | null;
    data: AvailabilityResponse;
  } | null;
};

const buildKey = (options: {
  slug: string;
  date: string;
  partySize: number;
  area: RestaurantArea | null;
  days: number;
}) =>
  `${options.slug}|${options.date}|${options.partySize}|${options.area ?? ""}|${options.days}`;

export function useTableAvailability(options: UseAvailabilityOptions): {
  loading: boolean;
  outcome: AvailabilityOutcome | null;
  reload: () => void;
} {
  const {
    slug,
    date,
    partySize,
    area = null,
    days = 1,
    initial = null,
  } = options;

  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<{
    key: string;
    outcome: AvailabilityOutcome;
  } | null>(null);

  const requestKey = date
    ? `${buildKey({ slug, date, partySize, area, days })}|${reloadKey}`
    : null;

  // Serwer policzył już dokładnie ten dzień — pierwszy render nie potrzebuje
  // ani fetcha, ani skeletonu.
  const seedUsable =
    reloadKey === 0 &&
    days === 1 &&
    initial !== null &&
    initial.date === date &&
    initial.partySize === partySize &&
    (initial.area ?? null) === area;

  useEffect(() => {
    if (!requestKey || !date || seedUsable) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      date,
      partySize: String(partySize),
    });
    if (area) params.set("area", area);
    if (days > 1) params.set("days", String(days));

    fetch(`/api/v1/restaurants/${slug}/availability?${params}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const json: unknown = await response.json().catch(() => null);
        if (response.ok) {
          setState({
            key: requestKey,
            outcome: { kind: "ready", data: json as AvailabilityResponse },
          });
          return;
        }
        // Grupa ponad limit online to nie błąd, tylko inna ścieżka UI
        // („zadzwoń do lokalu") — niesie własny komunikat i telefon.
        const payload = json as { error?: string; message?: string } | null;
        if (response.status === 422 && payload?.error === "PARTY_TOO_LARGE") {
          setState({
            key: requestKey,
            outcome: {
              kind: "tooLarge",
              info: json as PartyTooLargeResponse,
            },
          });
          return;
        }
        setState({
          key: requestKey,
          outcome: {
            kind: "error",
            message:
              payload?.message ??
              "Nie udało się pobrać wolnych godzin. Spróbuj ponownie.",
          },
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setState({
          key: requestKey,
          outcome: {
            kind: "error",
            message: "Błąd połączenia. Sprawdź internet i spróbuj ponownie.",
          },
        });
      });

    return () => controller.abort();
  }, [requestKey, seedUsable, slug, date, partySize, area, days]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  if (seedUsable && initial) {
    return { loading: false, outcome: { kind: "ready", data: initial.data }, reload };
  }

  const current = state && state.key === requestKey ? state.outcome : null;
  return {
    loading: requestKey !== null && current === null,
    outcome: current,
    reload,
  };
}
