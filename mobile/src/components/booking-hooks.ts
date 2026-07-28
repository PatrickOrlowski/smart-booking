import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  createHold,
  getAvailability,
  releaseHold,
  type AvailabilityResponse,
} from "@/api/client";

/**
 * Hooki danych flow rezerwacji: dostępność jednego dnia i blokada slotu
 * (hold) na czas checkoutu. Wzorzec „wynik przypięty do klucza żądania"
 * przeniesiony z webowego booking-flow: efekty nie wołają setState
 * synchronicznie, a spóźnione odpowiedzi starych żądań są ignorowane.
 */

export function useAvailability(
  slug: string,
  serviceId: string,
  date: string | null,
  resourceId: string | null,
  reloadKey = 0,
) {
  const requestKey = date
    ? `${slug}|${serviceId}|${date}|${resourceId ?? ""}|${reloadKey}`
    : null;
  const [state, setState] = useState<{
    key: string | null;
    data: AvailabilityResponse | null;
    error: string | null;
  }>({ key: null, data: null, error: null });

  useEffect(() => {
    if (!requestKey || !date) return;
    let stale = false;
    getAvailability(slug, {
      serviceId,
      date,
      resourceId:
        resourceId && resourceId !== "any" ? resourceId : undefined,
    })
      .then((data) => {
        if (!stale) setState({ key: requestKey, data, error: null });
      })
      .catch(() => {
        if (!stale) {
          setState({
            key: requestKey,
            data: null,
            error: "Nie udało się pobrać terminów. Spróbuj ponownie.",
          });
        }
      });
    return () => {
      stale = true;
    };
  }, [slug, serviceId, date, resourceId, requestKey]);

  const isCurrent = state.key === requestKey && requestKey !== null;
  return {
    loading: requestKey !== null && !isCurrent,
    data: isCurrent ? state.data : null,
    error: isCurrent ? state.error : null,
  };
}

/** Rozstrzygnięty wynik żądania blokady (stany przejściowe wyprowadzamy). */
type HoldOutcome =
  | { kind: "active"; token: string; expiresAt: number }
  | { kind: "conflict"; message: string }
  | { kind: "blocked"; message: string }
  | { kind: "error"; message: string };

export type SlotHold = {
  status:
    | "idle"
    | "creating"
    | "active"
    | "expired"
    | "conflict"
    | "blocked"
    | "error";
  /** Pozostały czas blokady w ms — null, gdy holda nie ma. */
  remainingMs: number | null;
  token: string | null;
  message: string | null;
  release: () => Promise<void>;
};

const HOLD_ERROR_FALLBACK =
  "Nie udało się zablokować terminu — możesz rezerwować dalej.";

/**
 * Blokada wybranego slotu na czas kroku „dane" (POST /api/v1/holds,
 * TTL 10 min po stronie serwera).
 *
 * Operacje idą przez jedną kolejkę obietnic, żeby zakładanie i zwalnianie
 * się nie ścigały (szybka zmiana slotu nie może osierocić holda, który
 * blokowałby klientowi jego własny termin). Zwolnienie jest best-effort:
 * gdy DELETE nie dojdzie, hold i tak wygaśnie po TTL.
 */
export function useSlotHold(options: {
  enabled: boolean;
  businessSlug: string;
  serviceId: string;
  resourceId: string;
  startAtIso: string | null;
}): SlotHold {
  const { enabled, businessSlug, serviceId, resourceId, startAtIso } = options;
  const slotKey = enabled && startAtIso ? `${startAtIso}|${resourceId}` : null;

  const [result, setResult] = useState<{
    key: string;
    outcome: HoldOutcome;
  } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const tokenRef = useRef<string | null>(null);

  const enqueue = useCallback((task: () => Promise<void>) => {
    const next = queue.current.then(task, task);
    queue.current = next.catch(() => undefined);
    return queue.current;
  }, []);

  const release = useCallback(async () => {
    const token = tokenRef.current;
    tokenRef.current = null;
    if (!token) return;
    await enqueue(async () => {
      await releaseHold(token).catch(() => undefined);
    });
  }, [enqueue]);

  useEffect(() => {
    if (!slotKey || !startAtIso) return;

    let abandoned = false;

    void enqueue(async () => {
      if (abandoned) return;
      try {
        const { hold } = await createHold({
          businessSlug,
          serviceId,
          resourceId: resourceId === "any" ? undefined : resourceId,
          startAt: startAtIso,
        });
        if (abandoned) {
          // Krok porzucony, zanim wróciła odpowiedź — oddaj slot od razu.
          await releaseHold(hold.token).catch(() => undefined);
          return;
        }
        tokenRef.current = hold.token;
        // Zegar odświeżamy razem z wynikiem — inaczej pierwsza sekunda
        // licznika liczyłaby się od nieaktualnego „teraz".
        setNowMs(Date.now());
        setResult({
          key: slotKey,
          outcome: {
            kind: "active",
            token: hold.token,
            // Wygaśnięcie kotwiczymy w chwili odbioru odpowiedzi (TTL od
            // teraz), nie w serwerowym `expiresAt` — przesunięty zegar
            // urządzenia nie może ani ubić ważnego holda „od ręki", ani
            // doliczać mu minut. Źródłem prawdy pozostaje 409 HOLD_EXPIRED
            // z POST /bookings.
            expiresAt: Date.now() + hold.ttlMinutes * 60_000,
          },
        });
      } catch (error) {
        if (abandoned) return;
        if (error instanceof ApiError && error.status === 409) {
          setResult({
            key: slotKey,
            outcome: { kind: "conflict", message: error.message },
          });
          return;
        }
        if (error instanceof ApiError && error.status === 403) {
          setResult({
            key: slotKey,
            outcome: { kind: "blocked", message: error.message },
          });
          return;
        }
        setResult({
          key: slotKey,
          outcome: { kind: "error", message: HOLD_ERROR_FALLBACK },
        });
      }
    });

    return () => {
      abandoned = true;
      const token = tokenRef.current;
      tokenRef.current = null;
      if (!token) return;
      void enqueue(async () => {
        await releaseHold(token).catch(() => undefined);
      });
    };
  }, [slotKey, startAtIso, resourceId, businessSlug, serviceId, enqueue]);

  const outcome = result && result.key === slotKey ? result.outcome : null;
  const activeExpiresAt = outcome?.kind === "active" ? outcome.expiresAt : null;
  const expired = activeExpiresAt !== null && nowMs >= activeExpiresAt;

  // Tykanie licznika: setState wyłącznie w callbacku interwału. Po
  // wygaśnięciu blokady interwał się zatrzymuje.
  useEffect(() => {
    if (activeExpiresAt === null || expired) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeExpiresAt, expired]);

  const status: SlotHold["status"] =
    slotKey === null
      ? "idle"
      : outcome === null
        ? "creating"
        : outcome.kind === "active"
          ? expired
            ? "expired"
            : "active"
          : outcome.kind;

  return {
    status,
    remainingMs:
      activeExpiresAt === null ? null : Math.max(0, activeExpiresAt - nowMs),
    token:
      status === "active" && outcome?.kind === "active" ? outcome.token : null,
    message:
      outcome &&
      (outcome.kind === "conflict" ||
        outcome.kind === "blocked" ||
        outcome.kind === "error")
        ? outcome.message
        : null,
    release,
  };
}
