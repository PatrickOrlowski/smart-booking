"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { utcToZonedWallClock } from "@/lib/time";
import { Skeleton } from "@/components/ui/skeleton";
import {
  WEEKDAYS_SHORT,
  formatDateTimeLabel,
  formatDayFull,
  formatDayShort,
  formatDuration,
  formatPrice,
  formatTimeInZone,
  priceLabel,
} from "@/components/marketplace/format";

/**
 * Flow rezerwacji klienta: pracownik → termin → dane → sukces.
 * Stan kroków żyje w searchParams (krok, resourceId, date, time),
 * więc back button przeglądarki cofa o krok.
 */

export type BookingFlowData = {
  businessSlug: string;
  businessName: string;
  address: string;
  timezone: string;
  slotGranularityMin: number;
  minLeadTimeMin: number;
  cancellationCutoffHours: number;
  service: {
    id: string;
    name: string;
    durationMin: number;
    priceCents: number;
    priceType: string;
    currency: string;
  };
  resources: {
    id: string;
    name: string;
    title: string | null;
    durationMinOverride: number | null;
    priceCentsOverride: number | null;
  }[];
  user: { name: string | null; email: string | null } | null;
};

type AvailabilityResponse = {
  date: string;
  timezone: string;
  slots: { startAt: string; resourceIds: string[] }[];
  perResource: {
    resourceId: string;
    slots: { startAt: string; endAt: string }[];
  }[];
};

/** Dane rezerwującego gościa — stan podniesiony do BookingFlow. */
type GuestDetails = { name: string; phone: string; email: string };

type BookingResult = {
  id: string;
  startAt: string;
  endAt: string;
  durationMin: number;
  priceCents: number;
  currency: string;
  serviceName: string;
  resourceName: string;
  businessName: string;
  address: string;
  timezone: string;
  cancellationCutoffHours: number;
  cancellationDeadline: string;
};

const pad = (value: number) => String(value).padStart(2, "0");

const leadTimeLabel = (minutes: number) =>
  minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;

// ---------------------------------------------------------------------------
// Hold slotu na czas checkoutu (POST /api/v1/holds, TTL po stronie serwera)
// ---------------------------------------------------------------------------

/** Rozstrzygnięty wynik żądania blokady (stany przejściowe wyprowadzamy). */
type HoldOutcome =
  | { kind: "active"; token: string; expiresAt: number }
  | { kind: "conflict"; message: string }
  | { kind: "error"; message: string };

type HoldResponse = {
  hold?: { token: string; expiresAt: string; ttlMinutes: number };
  message?: string;
};

export type SlotHold = {
  status: "idle" | "creating" | "active" | "expired" | "conflict" | "error";
  /** Pozostały czas blokady w ms — null, gdy holda nie ma. */
  remainingMs: number | null;
  token: string | null;
  message: string | null;
  release: () => Promise<void>;
};

/** ms → "09:58" (DM Mono, licznik ważności blokady). */
const formatCountdown = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}`;
};

/**
 * Blokada wybranego slotu na czas kroku „dane".
 *
 * Wszystkie operacje idą przez jedną kolejkę obietnic — dzięki temu nie
 * nachodzą na siebie (React w dev montuje efekty podwójnie, a szybkie
 * zmiany slotu potrafiłyby zostawić osierocony hold blokujący własny termin).
 * Zwolnienie jest best-effort: gdy DELETE nie dojdzie, hold i tak wygaśnie.
 *
 * Stany „creating"/„expired" są wyprowadzane (klucz slotu vs. klucz wyniku,
 * `expiresAt` vs. tykający zegar), więc efekty nie wołają setState wprost.
 */
function useSlotHold(options: {
  enabled: boolean;
  businessSlug: string;
  serviceId: string;
  resourceId: string;
  startAtIso: string | null;
}): SlotHold {
  const { enabled, businessSlug, serviceId, resourceId, startAtIso } = options;
  const slotKey = enabled && startAtIso ? `${startAtIso}|${resourceId}` : null;

  // Wynik jest przypięty do klucza slotu — zmiana slotu unieważnia go bez
  // synchronicznego setState w efekcie (ten sam wzorzec co useAvailability).
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
      await fetch(`/api/v1/holds/${token}`, { method: "DELETE" }).catch(
        () => undefined,
      );
    });
  }, [enqueue]);

  useEffect(() => {
    if (!slotKey || !startAtIso) return;

    let abandoned = false;

    void enqueue(async () => {
      if (abandoned) return;
      try {
        const response = await fetch("/api/v1/holds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessSlug,
            serviceId,
            resourceId: resourceId === "any" ? undefined : resourceId,
            startAt: startAtIso,
          }),
        });
        const json = (await response
          .json()
          .catch(() => null)) as HoldResponse | null;

        if (response.status === 201 && json?.hold) {
          if (abandoned) {
            // Krok porzucony, zanim wróciła odpowiedź — oddaj slot od razu.
            await fetch(`/api/v1/holds/${json.hold.token}`, {
              method: "DELETE",
            }).catch(() => undefined);
            return;
          }
          tokenRef.current = json.hold.token;
          // Zegar odświeżamy razem z wynikiem — inaczej pierwsza sekunda
          // licznika liczyłaby się od nieaktualnego „teraz".
          setNowMs(Date.now());
          setResult({
            key: slotKey,
            outcome: {
              kind: "active",
              token: json.hold.token,
              expiresAt: new Date(json.hold.expiresAt).getTime(),
            },
          });
          return;
        }
        if (abandoned) return;
        if (response.status === 409) {
          setResult({
            key: slotKey,
            outcome: {
              kind: "conflict",
              message:
                json?.message ??
                "Ten termin właśnie został zajęty. Wybierz inną godzinę.",
            },
          });
          return;
        }
        setResult({
          key: slotKey,
          outcome: {
            kind: "error",
            message:
              json?.message ??
              "Nie udało się zablokować terminu — możesz rezerwować dalej.",
          },
        });
      } catch {
        if (abandoned) return;
        setResult({
          key: slotKey,
          outcome: {
            kind: "error",
            message:
              "Nie udało się zablokować terminu — możesz rezerwować dalej.",
          },
        });
      }
    });

    return () => {
      abandoned = true;
      const token = tokenRef.current;
      tokenRef.current = null;
      if (!token) return;
      void enqueue(async () => {
        await fetch(`/api/v1/holds/${token}`, { method: "DELETE" }).catch(
          () => undefined,
        );
      });
    };
  }, [slotKey, startAtIso, resourceId, businessSlug, serviceId, enqueue]);

  const outcome = result && result.key === slotKey ? result.outcome : null;
  const activeExpiresAt = outcome?.kind === "active" ? outcome.expiresAt : null;
  const expired = activeExpiresAt !== null && nowMs >= activeExpiresAt;

  // Tykanie licznika: setState wyłącznie w callbacku interwału. Po wygaśnięciu
  // blokady interwał się zatrzymuje — nie ma już czego odliczać.
  useEffect(() => {
    if (activeExpiresAt === null || expired) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
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
    token: status === "active" && outcome?.kind === "active"
      ? outcome.token
      : null,
    message:
      outcome && (outcome.kind === "conflict" || outcome.kind === "error")
        ? outcome.message
        : null,
    release,
  };
}

function useAvailability(
  slug: string,
  serviceId: string,
  date: string | null,
  resourceId: string | null,
  reloadKey = 0,
) {
  // Stan „ładowania" jest wyprowadzany z porównania kluczy żądań —
  // efekt nie woła setState synchronicznie.
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
    const controller = new AbortController();
    const params = new URLSearchParams({ serviceId, date });
    if (resourceId && resourceId !== "any") params.set("resourceId", resourceId);
    fetch(`/api/v1/businesses/${slug}/availability?${params}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("availability");
        return (await response.json()) as AvailabilityResponse;
      })
      .then((data) => setState({ key: requestKey, data, error: null }))
      .catch(() => {
        if (controller.signal.aborted) return;
        setState({
          key: requestKey,
          data: null,
          error: "Nie udało się pobrać terminów. Spróbuj ponownie.",
        });
      });
    return () => controller.abort();
  }, [slug, serviceId, date, resourceId, requestKey]);

  const isCurrent = state.key === requestKey && requestKey !== null;
  return {
    loading: requestKey !== null && !isCurrent,
    data: isCurrent ? state.data : null,
    error: isCurrent ? state.error : null,
  };
}

function BackCircle({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Wstecz"
      className="mb-4 flex size-[34px] items-center justify-center rounded-full border-[1.5px] border-border-strong bg-card text-sm"
    >
      ←
    </button>
  );
}

export function BookingFlow({ data }: { data: BookingFlowData }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const resourceParam = searchParams.get("resourceId");
  const dateParam = searchParams.get("date");
  const timeParam = searchParams.get("time");
  const krokParam = searchParams.get("krok");

  const [booking, setBooking] = useState<BookingResult | null>(null);

  // Dane gościa trzymamy na poziomie flow: komunikat konfliktu obiecuje
  // „Twoje dane zostają", a powrót do listy terminów odmontowuje krok „dane".
  const [guest, setGuest] = useState<GuestDetails>({
    name: data.user?.name ?? "",
    phone: "",
    email: data.user?.email ?? "",
  });
  const updateGuest = useCallback(
    (patch: Partial<GuestDetails>) =>
      setGuest((current) => ({ ...current, ...patch })),
    [],
  );

  // Krok wynika z parametrów URL; brakujące dane cofają do wcześniejszego kroku.
  const step: "staff" | "termin" | "dane" | "sukces" =
    krokParam === "sukces" && booking
      ? "sukces"
      : krokParam === "dane" && resourceParam && timeParam
        ? "dane"
        : (krokParam === "termin" || krokParam === "dane") && resourceParam
          ? "termin"
          : "staff";

  // Bump wymusza ponowne pobranie slotów po powrocie z kroku „dane"
  // (wygasła blokada / zajęty termin → lista musi być świeża).
  const [slotsRefreshKey, setSlotsRefreshKey] = useState(0);

  const setParams = (
    updates: Record<string, string | null>,
    mode: "push" | "replace" = "push",
  ) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const url = `?${params.toString()}`;
    if (mode === "push") router.push(url, { scroll: false });
    else router.replace(url, { scroll: false });
  };

  // 14 kolejnych dni lokalnych lokalu — pasek wyboru dnia.
  const days = useMemo(() => {
    const wall = utcToZonedWallClock(new Date(), data.timezone);
    const startSerial = Date.UTC(wall.year, wall.month - 1, wall.day);
    return Array.from({ length: 14 }, (_, index) => {
      const date = new Date(startSerial + index * 86_400_000);
      return {
        iso: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
        weekday: WEEKDAYS_SHORT[(date.getUTCDay() + 6) % 7],
        dayNumber: date.getUTCDate(),
        isToday: index === 0,
      };
    });
  }, [data.timezone]);

  const todayIso = days[0].iso;

  const chosenResource =
    resourceParam && resourceParam !== "any"
      ? (data.resources.find((resource) => resource.id === resourceParam) ??
        null)
      : null;
  const staffLabel = chosenResource?.name ?? "Dowolny pracownik";
  const effectiveDurationMin =
    chosenResource?.durationMinOverride ?? data.service.durationMin;
  const effectivePriceCents =
    chosenResource?.priceCentsOverride ?? data.service.priceCents;
  const effectivePriceLabel = priceLabel(
    effectivePriceCents,
    data.service.priceType,
    data.service.currency,
  );

  // Hold żyje na poziomie flow, nie kroku — przetrwa re-render przy zmianie
  // parametrów URL i zwalnia się dokładnie wtedy, gdy krok „dane" znika.
  const hold = useSlotHold({
    enabled: step === "dane",
    businessSlug: data.businessSlug,
    serviceId: data.service.id,
    resourceId: resourceParam ?? "any",
    startAtIso: timeParam,
  });

  const backToSlots = () => {
    setSlotsRefreshKey((key) => key + 1);
    setParams({ krok: "termin", time: null });
  };

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-4 pb-16 md:max-w-lg lg:max-w-4xl">
      {krokParam === "sukces" ? (
        booking ? (
          <div className="mx-auto w-full max-w-md">
            <SuccessScreen booking={booking} slug={data.businessSlug} />
          </div>
        ) : (
          <div className="mx-auto max-w-md py-16 text-center">
            <h1 className="mb-2 font-display text-[27px] font-extrabold tracking-tight">
              Rezerwacja potwierdzona
            </h1>
            <p className="mb-6 text-[13px] text-muted-foreground">
              Szczegóły wizyty znajdziesz w e-mailu z potwierdzeniem.
            </p>
            <Link
              href={`/b/${data.businessSlug}`}
              className="inline-block rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground"
            >
              Wróć do profilu
            </Link>
          </div>
        )
      ) : (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-10">
          <div className="min-w-0">
            {step === "staff" ? (
              <StaffStep
                data={data}
                todayIso={todayIso}
                onBack={() => router.push(`/b/${data.businessSlug}`)}
                onPick={(resourceId) =>
                  setParams({
                    krok: "termin",
                    resourceId,
                    date: todayIso,
                    time: null,
                  })
                }
              />
            ) : null}

            {step === "termin" ? (
              <DateStep
                data={data}
                days={days}
                selectedDate={dateParam ?? todayIso}
                resourceId={resourceParam ?? "any"}
                staffLabel={staffLabel}
                durationMin={effectiveDurationMin}
                refreshKey={slotsRefreshKey}
                onBack={() => router.back()}
                onPickDay={(iso) => setParams({ date: iso }, "replace")}
                onPickSlot={(startAt) =>
                  setParams({ krok: "dane", time: startAt })
                }
              />
            ) : null}

            {step === "dane" && timeParam ? (
              <DetailsStep
                data={data}
                startAtIso={timeParam}
                resourceId={resourceParam ?? "any"}
                staffLabel={staffLabel}
                durationMin={effectiveDurationMin}
                priceLabelText={effectivePriceLabel}
                hold={hold}
                guest={guest}
                onGuestChange={updateGuest}
                onBack={() => {
                  // Porzucenie kroku danych zwalnia slot, zanim wrócimy
                  // po świeżą listę godzin.
                  void hold.release().finally(() => router.back());
                }}
                onConflictRetry={backToSlots}
                onSuccess={(result) => {
                  setBooking(result);
                  setParams({ krok: "sukces", time: null });
                }}
              />
            ) : null}
          </div>

          <BookingSummary
            businessName={data.businessName}
            address={data.address}
            serviceName={data.service.name}
            durationMin={effectiveDurationMin}
            staffLabel={resourceParam ? staffLabel : null}
            termLabel={
              timeParam
                ? formatDateTimeLabel(new Date(timeParam), data.timezone)
                : null
            }
            priceLabelText={effectivePriceLabel}
          />
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sticky podsumowanie (lg+) — uzupełnia się w miarę przechodzenia kroków
// ---------------------------------------------------------------------------

function BookingSummary({
  businessName,
  address,
  serviceName,
  durationMin,
  staffLabel,
  termLabel,
  priceLabelText,
}: {
  businessName: string;
  address: string;
  serviceName: string;
  durationMin: number;
  staffLabel: string | null;
  termLabel: string | null;
  priceLabelText: string;
}) {
  return (
    <aside className="hidden lg:sticky lg:top-8 lg:block">
      <div className="rounded-2xl border-[1.5px] border-border-strong bg-card p-5">
        <div className="meta-label">Podsumowanie</div>
        <div className="mt-1 font-display text-lg font-bold tracking-tight">
          {businessName}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">{address}</div>

        <div className="my-4 h-px bg-border" />

        <dl className="flex flex-col gap-2.5 text-[13px]">
          <div className="flex justify-between gap-3">
            <dt className="flex-none text-muted-foreground">Usługa</dt>
            <dd className="text-right font-semibold">{serviceName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="flex-none text-muted-foreground">Pracownik</dt>
            <dd className="text-right font-semibold">
              {staffLabel ?? <span className="text-[#8f8b81]">—</span>}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="flex-none text-muted-foreground">Termin</dt>
            <dd className="text-right font-mono font-medium">
              {termLabel ?? <span className="text-[#8f8b81]">—</span>}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="flex-none text-muted-foreground">Czas trwania</dt>
            <dd className="text-right font-mono">
              {formatDuration(durationMin)}
            </dd>
          </div>
        </dl>

        <div className="my-4 h-px bg-border" />

        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-semibold">Cena</span>
          <span className="font-mono text-base font-medium">
            {priceLabelText}
          </span>
        </div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Krok 1 — pracownik
// ---------------------------------------------------------------------------

function StaffStep({
  data,
  todayIso,
  onBack,
  onPick,
}: {
  data: BookingFlowData;
  todayIso: string;
  onBack: () => void;
  onPick: (resourceId: string) => void;
}) {
  const today = useAvailability(
    data.businessSlug,
    data.service.id,
    todayIso,
    null,
  );

  const mergedToday = today.data?.slots ?? [];
  const perResourceToday = new Map(
    (today.data?.perResource ?? []).map((entry) => [
      entry.resourceId,
      entry.slots,
    ]),
  );

  return (
    <div>
      <BackCircle onClick={onBack} />
      <div className="meta-label">Krok 1 / 3 · Pracownik</div>
      <h1 className="mt-1.5 mb-1 font-display text-[29px] font-extrabold tracking-tight">
        Kto ma to zrobić?
      </h1>
      <div className="mb-5 text-[13px] text-muted-foreground">
        {data.service.name} · {formatDuration(data.service.durationMin)} ·{" "}
        {priceLabel(
          data.service.priceCents,
          data.service.priceType,
          data.service.currency,
        )}
      </div>

      <button
        type="button"
        onClick={() => onPick("any")}
        className="mb-3.5 w-full rounded-2xl bg-primary p-4 text-left text-primary-foreground"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-display text-lg font-bold tracking-tight">
              Dowolny pracownik
            </div>
            <div className="mt-[3px] text-xs text-primary-foreground/70">
              Scalona dostępność całego zespołu
            </div>
          </div>
          <div className="flex-none text-right">
            <div className="font-mono text-xl font-medium">
              {today.loading ? "…" : mergedToday.length}
            </div>
            <div className="text-[10px] text-primary-foreground/70">
              terminów dziś
            </div>
          </div>
        </div>
        {mergedToday.length > 0 ? (
          <div className="mt-3.5 flex gap-1.5">
            {mergedToday.slice(0, 3).map((slot) => (
              <span
                key={slot.startAt}
                className="rounded-md bg-[#1f5645] px-2 py-[5px] font-mono text-[11px]"
              >
                {formatTimeInZone(new Date(slot.startAt), data.timezone)}
              </span>
            ))}
            {mergedToday.length > 3 ? (
              <span className="rounded-md bg-[#1f5645] px-2 py-[5px] font-mono text-[11px]">
                +{mergedToday.length - 3}
              </span>
            ) : null}
          </div>
        ) : null}
      </button>

      <div className="flex flex-col gap-2.5">
        {data.resources.map((resource) => {
          const slots = perResourceToday.get(resource.id) ?? [];
          const extras: string[] = [];
          if (resource.priceCentsOverride !== null) {
            const delta = resource.priceCentsOverride - data.service.priceCents;
            if (delta !== 0) {
              extras.push(
                `${delta > 0 ? "+" : "−"}${formatPrice(Math.abs(delta), data.service.currency)}`,
              );
            }
          }
          if (resource.durationMinOverride !== null) {
            extras.push(formatDuration(resource.durationMinOverride));
          }
          return (
            <button
              key={resource.id}
              type="button"
              onClick={() => onPick(resource.id)}
              className="flex w-full items-center gap-[13px] rounded-2xl border-[1.5px] border-border-strong bg-card p-[13px] text-left"
            >
              <div className="photo-placeholder size-[52px] flex-none rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold">{resource.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {[resource.title, ...extras].filter(Boolean).join(" · ") ||
                    "Barber"}
                </div>
                {today.loading ? (
                  <Skeleton className="mt-1.5 h-3.5 w-32" />
                ) : slots.length > 0 ? (
                  <div className="mt-[5px] font-mono text-[11px] font-medium text-success">
                    Dziś od{" "}
                    {formatTimeInZone(new Date(slots[0].startAt), data.timezone)}{" "}
                    · {slots.length}{" "}
                    {slots.length === 1
                      ? "termin"
                      : slots.length < 5
                        ? "terminy"
                        : "terminów"}
                  </div>
                ) : (
                  <div className="mt-[5px] font-mono text-[11px] font-medium text-warning">
                    Brak terminów dziś
                  </div>
                )}
              </div>
              <span className="flex-none text-[#8f8b81]">›</span>
            </button>
          );
        })}
      </div>

      <p className="mt-[18px] text-xs leading-relaxed text-muted-foreground">
        Wybór „dowolny” daje najwięcej terminów — pracownika przypisujemy przy
        potwierdzeniu i pokazujemy go w e-mailu.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Krok 2 — data i godzina
// ---------------------------------------------------------------------------

function DateStep({
  data,
  days,
  selectedDate,
  resourceId,
  staffLabel,
  durationMin,
  refreshKey,
  onBack,
  onPickDay,
  onPickSlot,
}: {
  data: BookingFlowData;
  days: { iso: string; weekday: string; dayNumber: number; isToday: boolean }[];
  selectedDate: string;
  resourceId: string;
  staffLabel: string;
  durationMin: number;
  /** Zmiana wartości wymusza świeże pobranie slotów (powrót z kroku „dane"). */
  refreshKey: number;
  onBack: () => void;
  onPickDay: (iso: string) => void;
  onPickSlot: (startAtIso: string) => void;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const availability = useAvailability(
    data.businessSlug,
    data.service.id,
    selectedDate,
    resourceId,
    reloadKey + refreshKey,
  );

  // Gdy dzień jest pusty — sonduj kolejne dni, żeby podpowiedzieć najbliższy.
  // Wynik jest przypięty do klucza dnia, więc zmiana dnia unieważnia go
  // bez synchronicznego setState w efekcie.
  const emptyDayKey =
    !availability.loading &&
    availability.data &&
    availability.data.slots.length === 0
      ? `${selectedDate}|${resourceId}`
      : null;
  const [probeResult, setProbeResult] = useState<{
    key: string;
    iso: string;
    firstSlots: string[];
  } | null>(null);

  useEffect(() => {
    if (!emptyDayKey) return;
    let cancelled = false;
    const probe = async () => {
      const startIndex = days.findIndex((day) => day.iso === selectedDate);
      for (const day of days.slice(startIndex + 1, startIndex + 8)) {
        const params = new URLSearchParams({
          serviceId: data.service.id,
          date: day.iso,
        });
        if (resourceId !== "any") params.set("resourceId", resourceId);
        try {
          const response = await fetch(
            `/api/v1/businesses/${data.businessSlug}/availability?${params}`,
          );
          if (!response.ok) return;
          const json = (await response.json()) as AvailabilityResponse;
          if (cancelled) return;
          if (json.slots.length > 0) {
            setProbeResult({
              key: emptyDayKey,
              iso: day.iso,
              firstSlots: json.slots
                .slice(0, 3)
                .map((slot) =>
                  formatTimeInZone(new Date(slot.startAt), data.timezone),
                ),
            });
            return;
          }
        } catch {
          return;
        }
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, [
    emptyDayKey,
    days,
    selectedDate,
    resourceId,
    data.businessSlug,
    data.service.id,
    data.timezone,
  ]);

  const nearest =
    probeResult && probeResult.key === emptyDayKey ? probeResult : null;

  const groups = useMemo(() => {
    const slots = availability.data?.slots ?? [];
    const rano: typeof slots = [];
    const popoludniu: typeof slots = [];
    const wieczorem: typeof slots = [];
    for (const slot of slots) {
      const hour = utcToZonedWallClock(new Date(slot.startAt), data.timezone)
        .hour;
      if (hour < 12) rano.push(slot);
      else if (hour < 17) popoludniu.push(slot);
      else wieczorem.push(slot);
    }
    return [
      { label: "Rano", slots: rano },
      { label: "Po południu", slots: popoludniu },
      { label: "Wieczorem", slots: wieczorem },
    ].filter((group) => group.slots.length > 0);
  }, [availability.data, data.timezone]);

  const selectedDay = days.find((day) => day.iso === selectedDate);
  const selectedDayLabel = selectedDay
    ? formatDayFull(
        new Date(`${selectedDate}T12:00:00Z`),
        "UTC",
      )
    : "";

  return (
    <div>
      <BackCircle onClick={onBack} />
      <div className="meta-label">Krok 2 / 3 · Termin</div>
      <h1 className="mt-1.5 mb-1 font-display text-[29px] font-extrabold tracking-tight">
        Kiedy pasuje?
      </h1>
      <div className="mb-1 text-[13px] text-muted-foreground">
        {data.service.name} · {staffLabel} · {formatDuration(durationMin)}
      </div>

      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pt-4 pb-1.5 lg:mx-0 lg:px-0">
        {days.map((day) => {
          const selected = day.iso === selectedDate;
          return (
            <button
              key={day.iso}
              type="button"
              onClick={() => onPickDay(day.iso)}
              className={
                selected
                  ? "w-14 flex-none rounded-[14px] bg-primary py-2.5 text-center text-primary-foreground"
                  : "w-14 flex-none rounded-[14px] border border-border bg-card py-2.5 text-center"
              }
            >
              <div
                className={
                  selected
                    ? "text-[11px] text-primary-foreground/70"
                    : "text-[11px] text-[#8f8b81]"
                }
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

      <div className="pt-3.5">
        <div className="mb-2.5 flex items-center justify-between">
          <div className="meta-label">{selectedDayLabel}</div>
          <div className="font-mono text-[10px] text-[#8f8b81]">
            siatka {data.slotGranularityMin} min
          </div>
        </div>

        {availability.loading ? (
          <div className="mt-3 grid grid-cols-3 gap-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 12 }, (_, index) => (
              <Skeleton key={index} className="h-11 rounded-[10px]" />
            ))}
          </div>
        ) : availability.error ? (
          <div className="mt-4 rounded-2xl border border-border bg-card p-4 text-center">
            <p className="mb-3 text-[13px] text-muted-foreground">
              {availability.error}
            </p>
            <button
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
              className="rounded-full border-[1.5px] border-border-strong bg-card px-4 py-2 text-[13px] font-semibold"
            >
              Spróbuj ponownie
            </button>
          </div>
        ) : groups.length === 0 ? (
          <div className="mx-auto mt-3 max-w-md">
            <h2 className="mb-3.5 font-display text-xl font-extrabold tracking-tight">
              Brak wolnych godzin
            </h2>
            {nearest ? (
              <button
                type="button"
                onClick={() => onPickDay(nearest.iso)}
                className="flex w-full items-center justify-between rounded-xl border-[1.5px] border-border-strong bg-[#f7f4ef] px-3 py-[11px] text-left dark:bg-secondary"
              >
                <div>
                  <div className="text-[12.5px] font-bold">
                    Najbliżej:{" "}
                    {formatDayShort(
                      new Date(`${nearest.iso}T12:00:00Z`),
                      "UTC",
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {nearest.firstSlots.join(", ")}
                  </div>
                </div>
                <span className="text-sm">›</span>
              </button>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                Sprawdź inny dzień na pasku powyżej — w najbliższym tygodniu
                nie widzimy wolnych godzin.
              </p>
            )}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <div className="mt-3.5 mb-2 text-xs font-bold">{group.label}</div>
              <div className="grid grid-cols-3 gap-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {group.slots.map((slot) => (
                  <button
                    key={slot.startAt}
                    type="button"
                    onClick={() => onPickSlot(slot.startAt)}
                    className="min-h-11 rounded-[10px] border-[1.5px] border-border-strong bg-card py-[11px] font-mono text-[13px] font-medium"
                  >
                    {formatTimeInZone(new Date(slot.startAt), data.timezone)}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}

        <p className="mt-[18px] text-[11px] leading-relaxed text-[#8f8b81]">
          Godziny w strefie lokalu ({data.timezone}). Pokazujemy wyłącznie
          wolne terminy — min. wyprzedzenie {leadTimeLabel(data.minLeadTimeMin)}
          .
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Krok 3 — dane i potwierdzenie
// ---------------------------------------------------------------------------

function DetailsStep({
  data,
  startAtIso,
  resourceId,
  staffLabel,
  durationMin,
  priceLabelText,
  hold,
  guest,
  onGuestChange,
  onBack,
  onConflictRetry,
  onSuccess,
}: {
  data: BookingFlowData;
  startAtIso: string;
  resourceId: string;
  staffLabel: string;
  durationMin: number;
  priceLabelText: string;
  hold: SlotHold;
  /** Dane gościa żyją w BookingFlow — przetrwają powrót do listy terminów. */
  guest: GuestDetails;
  onGuestChange: (patch: Partial<GuestDetails>) => void;
  onBack: () => void;
  onConflictRetry: () => void;
  onSuccess: (booking: BookingResult) => void;
}) {
  const { name, phone, email } = guest;
  const setName = (value: string) => onGuestChange({ name: value });
  const setPhone = (value: string) => onGuestChange({ phone: value });
  const setEmail = (value: string) => onGuestChange({ email: value });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  const startAt = new Date(startAtIso);
  const isGuest = !data.user;

  // Konflikt może przyjść dwiema drogami: przy zakładaniu blokady (od razu
  // po wejściu w krok) albo dopiero przy POST /bookings.
  const activeConflict =
    conflict ?? (hold.status === "conflict" ? hold.message : null);
  const holdExpired = hold.status === "expired";

  const submit = async () => {
    setError(null);
    setConflict(null);
    if (isGuest) {
      if (name.trim().length < 2) {
        setError("Podaj imię i nazwisko.");
        return;
      }
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
        setError("Podaj poprawny adres e-mail.");
        return;
      }
      if (phone.trim().length < 7) {
        setError("Podaj poprawny numer telefonu.");
        return;
      }
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/v1/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessSlug: data.businessSlug,
          serviceId: data.service.id,
          resourceId: resourceId === "any" ? undefined : resourceId,
          startAt: startAtIso,
          holdToken: hold.token ?? undefined,
          guest: isGuest
            ? { name: name.trim(), email: email.trim(), phone: phone.trim() }
            : undefined,
        }),
      });
      const json = (await response.json().catch(() => null)) as {
        booking?: BookingResult;
        message?: string;
      } | null;

      if (response.status === 201 && json?.booking) {
        onSuccess(json.booking);
        return;
      }
      if (response.status === 409) {
        setConflict(
          json?.message ??
            "Ten termin właśnie został zajęty. Wybierz inną godzinę.",
        );
        return;
      }
      setError(
        json?.message ?? "Nie udało się utworzyć rezerwacji. Spróbuj ponownie.",
      );
    } catch {
      setError("Błąd połączenia. Sprawdź internet i spróbuj ponownie.");
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "w-full rounded-[11px] border border-border bg-card px-[13px] py-3 text-sm outline-none focus:border-border-strong focus:border-[1.5px]";

  return (
    <div>
      <BackCircle onClick={onBack} />
      <div className="meta-label">Krok 3 / 3 · Dane</div>
      <h1 className="mt-1.5 mb-[18px] font-display text-[29px] font-extrabold tracking-tight">
        Prawie gotowe.
      </h1>

      {activeConflict ? (
        <div className="mx-auto mb-4 max-w-md rounded-2xl border-[1.5px] border-border-strong bg-card p-4">
          <div className="mb-3 flex size-9 items-center justify-center rounded-full border border-[#d9a9a1] bg-[#f4e3e0] text-[17px] text-destructive">
            !
          </div>
          <div className="mb-1.5 font-display text-[21px] leading-tight font-extrabold tracking-tight">
            Termin {formatTimeInZone(startAt, data.timezone)} przepadł
          </div>
          <p className="mb-3.5 text-[12.5px] leading-relaxed text-foreground/80">
            {activeConflict} Twoje dane zostają — nie wpisujesz ich drugi raz.
          </p>
          <button
            type="button"
            onClick={onConflictRetry}
            className="w-full rounded-[10px] bg-primary p-3 text-[13px] font-bold text-primary-foreground"
          >
            Pokaż wolne terminy
          </button>
        </div>
      ) : null}

      {holdExpired ? (
        <div className="mx-auto mb-4 max-w-md rounded-2xl border-[1.5px] border-border-strong bg-card p-4">
          <div className="mb-3 flex size-9 items-center justify-center rounded-full border border-warning bg-warning-soft text-[15px] text-warning-strong">
            ⏱
          </div>
          <div className="mb-1.5 font-display text-[21px] leading-tight font-extrabold tracking-tight">
            Blokada terminu wygasła
          </div>
          <p className="mb-3.5 text-[12.5px] leading-relaxed text-foreground/80">
            Godzinę {formatTimeInZone(startAt, data.timezone)} trzymaliśmy dla
            Ciebie 10 minut. Wróć do listy — pokażemy odświeżoną dostępność.
          </p>
          <button
            type="button"
            onClick={onConflictRetry}
            className="w-full rounded-[10px] bg-primary p-3 text-[13px] font-bold text-primary-foreground"
          >
            Pokaż wolne terminy
          </button>
        </div>
      ) : null}

      {!activeConflict && !holdExpired ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-[14px] border border-border bg-accent px-3.5 py-2.5">
          <div className="min-w-0">
            <div className="meta-label">Termin zablokowany dla Ciebie</div>
            <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
              {hold.status === "error"
                ? "Blokady nie udało się założyć — rezerwuj dalej, termin może zająć ktoś inny."
                : "Dokończ dane, zanim skończy się czas."}
            </div>
          </div>
          <div
            aria-live="polite"
            className={`flex-none font-mono text-[17px] font-medium tabular-nums ${
              hold.remainingMs !== null && hold.remainingMs < 120_000
                ? "text-destructive"
                : "text-primary dark:text-accent-foreground"
            }`}
          >
            {hold.status === "active" && hold.remainingMs !== null
              ? formatCountdown(hold.remainingMs)
              : "--:--"}
          </div>
        </div>
      ) : null}

      <div className="mb-5 rounded-2xl border border-[#e2ddd2] bg-[#f7f4ef] p-[15px] dark:border-border dark:bg-secondary">
        <div className="flex justify-between gap-3 text-sm font-semibold">
          <span>{data.service.name}</span>
          <span className="font-mono">{priceLabelText}</span>
        </div>
        <div className="my-[11px] h-px bg-[#e2ddd2] dark:bg-border" />
        <div className="flex justify-between text-[13px] text-foreground/80">
          <span>Termin</span>
          <span className="font-mono font-medium text-foreground">
            {formatDayShort(startAt, data.timezone)} ·{" "}
            {formatTimeInZone(startAt, data.timezone)}
          </span>
        </div>
        <div className="mt-1.5 flex justify-between text-[13px] text-foreground/80">
          <span>Pracownik</span>
          <span className="font-semibold text-foreground">
            {resourceId === "any" ? "Przypisany przy potwierdzeniu" : staffLabel}
          </span>
        </div>
        <div className="mt-1.5 flex justify-between text-[13px] text-foreground/80">
          <span>Czas trwania</span>
          <span className="font-mono text-foreground">
            {formatDuration(durationMin)}
          </span>
        </div>
      </div>

      {isGuest ? (
        <div className="flex flex-col gap-[11px]">
          <div>
            <label
              htmlFor="guest-name"
              className="mb-[5px] block text-[11px] font-semibold text-muted-foreground"
            >
              Imię i nazwisko
            </label>
            <input
              id="guest-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              className={`${inputClass} border-[1.5px] border-border-strong`}
            />
          </div>
          <div>
            <label
              htmlFor="guest-phone"
              className="mb-[5px] block text-[11px] font-semibold text-muted-foreground"
            >
              Telefon{" "}
              <span className="font-normal text-[#8f8b81]">
                · na SMS z przypomnieniem
              </span>
            </label>
            <input
              id="guest-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              type="tel"
              autoComplete="tel"
              placeholder="+48 600 000 000"
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label
              htmlFor="guest-email"
              className="mb-[5px] block text-[11px] font-semibold text-muted-foreground"
            >
              E-mail
            </label>
            <input
              id="guest-email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              autoComplete="email"
              placeholder="anna@example.com"
              className={inputClass}
            />
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="meta-label mb-1.5">Rezerwujesz jako</div>
          <div className="text-sm font-semibold">
            {data.user?.name ?? "Twoje konto"}
          </div>
          {data.user?.email ? (
            <div className="mt-0.5 text-[13px] text-muted-foreground">
              {data.user.email}
            </div>
          ) : null}
        </div>
      )}

      <div className="mt-5 rounded-[14px] border border-[#e2ddd2] bg-card p-[13px] dark:border-border">
        <div className="mb-[7px] text-xs font-bold">Zasady odwołania</div>
        <p className="text-[11.5px] leading-relaxed text-foreground/80">
          Bezpłatnie do <b>{data.cancellationCutoffHours} h</b> przed wizytą.
          Później termin przepada.
        </p>
      </div>

      {error ? (
        <p className="mt-3 text-[13px] font-semibold text-destructive">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={
          submitting ||
          Boolean(activeConflict) ||
          holdExpired ||
          // Chwila na odpowiedź z /api/v1/holds — inaczej najszybsi klienci
          // rezerwowaliby z pominięciem blokady.
          hold.status === "creating"
        }
        className="mt-[18px] w-full rounded-[14px] bg-primary p-4 text-[15px] font-bold text-primary-foreground disabled:opacity-60"
      >
        {submitting
          ? "Rezerwuję…"
          : `Potwierdzam rezerwację · ${priceLabelText}`}
      </button>
      <p className="mt-2 text-center text-[11px] text-[#8f8b81]">
        Płatność w lokalu. Zadatku nie wymagamy.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sukces
// ---------------------------------------------------------------------------

function SuccessScreen({
  booking,
  slug,
}: {
  booking: BookingResult;
  slug: string;
}) {
  const startAt = new Date(booking.startAt);
  const deadline = new Date(booking.cancellationDeadline);

  return (
    <div className="pt-7">
      <div className="mb-5 flex size-[58px] items-center justify-center rounded-full bg-primary text-[26px] text-primary-foreground">
        ✓
      </div>
      <h1 className="mb-2 font-display text-[32px] leading-none font-extrabold tracking-tight">
        Zarezerwowane.
      </h1>
      <p className="mb-[22px] text-sm leading-relaxed text-foreground/80">
        Rezerwacja jest potwierdzona. Zapisz szczegóły — przypomnienie
        wyślemy przed wizytą.
      </p>

      <div className="overflow-hidden rounded-2xl border-[1.5px] border-border-strong bg-card">
        <div className="border-b border-dashed border-[#d8d2c4] p-4 dark:border-border">
          <div className="meta-label">
            {formatDayFull(startAt, booking.timezone)}
          </div>
          <div className="my-1 font-display text-[38px] font-extrabold tracking-tight">
            {formatTimeInZone(startAt, booking.timezone)}
          </div>
          <div className="text-sm font-semibold">
            {booking.serviceName} · {formatDuration(booking.durationMin)}
          </div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            {booking.resourceName} · {booking.businessName}
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-3.5">
          <div>
            <div className="text-xs text-muted-foreground">
              {booking.address}
            </div>
            <div className="mt-[3px] font-mono text-[11px] text-[#8f8b81]">
              #{booking.id.slice(-8).toUpperCase()}
            </div>
          </div>
          <div className="font-mono text-base font-medium">
            {formatPrice(booking.priceCents, booking.currency)}
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className="flex-1 rounded-xl border-[1.5px] border-border-strong bg-card py-[13px] text-[13px] font-semibold"
        >
          Dodaj do kalendarza
        </button>
        <button
          type="button"
          className="flex-1 rounded-xl border-[1.5px] border-border-strong bg-card py-[13px] text-[13px] font-semibold"
        >
          Nawiguj
        </button>
      </div>
      <Link
        href="/"
        className="mt-2 block w-full rounded-xl bg-primary p-[15px] text-center text-sm font-bold text-primary-foreground"
      >
        Wróć do wyszukiwarki
      </Link>
      <p className="mt-4 text-center text-[11.5px] leading-relaxed text-[#8f8b81]">
        Odwołanie bezpłatne do {booking.cancellationCutoffHours} h przed (do{" "}
        {formatDayShort(deadline, booking.timezone)},{" "}
        {formatTimeInZone(deadline, booking.timezone)}).
      </p>
      <p className="mt-1 text-center text-[11px] text-[#8f8b81]">
        <Link href={`/b/${slug}`} className="underline underline-offset-2">
          Zobacz profil {booking.businessName}
        </Link>
      </p>
    </div>
  );
}
