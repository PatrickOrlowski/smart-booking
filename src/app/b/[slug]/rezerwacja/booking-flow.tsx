"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { utcToZonedWallClock } from "@/lib/time";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatDateTimeLabel,
  formatDayFull,
  formatDayShort,
  formatDuration,
  formatPrice,
  formatTimeInZone,
  priceLabel,
  weekdaysShort,
} from "@/components/marketplace/format";
import { useTranslations } from "@/i18n/client";
import { previewDiscountAction } from "./actions";

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
  /** Zadatek wymagany przy rezerwacji — null, gdy usługa go nie ma. */
  deposit: { amountCents: number; stripeEnabled: boolean } | null;
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

/**
 * Zastosowany kod rabatowy. Podgląd liczy serwer (server action) — tutaj
 * trzymamy wyłącznie wynik do pokazania; wiążąca kalkulacja i tak dzieje się
 * przy POST /bookings, w transakcji.
 */
type AppliedDiscount = {
  code: string;
  discountCents: number;
  subtotalCents: number;
  totalCents: number;
};

type BookingResult = {
  id: string;
  startAt: string;
  endAt: string;
  durationMin: number;
  /** Cena po rabacie — tyle klient płaci. */
  priceCents: number;
  /** Cena katalogowa przed rabatem (starsze odpowiedzi jej nie mają). */
  subtotalCents?: number;
  discountCents?: number;
  currency: string;
  serviceName: string;
  resourceName: string;
  businessName: string;
  address: string;
  timezone: string;
  cancellationCutoffHours: number;
  cancellationDeadline: string;
};

/** Płatność zadatku z odpowiedzi POST /bookings — null, gdy bez zadatku. */
type BookingPayment = {
  amountCents: number;
  currency: string;
  provider: string;
  status: string;
  /** Link do Stripe Checkout — tylko gdy bramka aktywna. */
  redirectUrl?: string;
};

const pad = (value: number) => String(value).padStart(2, "0");

const leadTimeLabel = (minutes: number) =>
  minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;

// ---------------------------------------------------------------------------
// Hold slotu na czas checkoutu (POST /api/v1/holds, TTL po stronie serwera)
// ---------------------------------------------------------------------------

/**
 * Rozstrzygnięty wynik żądania blokady (stany przejściowe wyprowadzamy).
 * Trzymamy KOD, nie przetłumaczony komunikat: treść tłumaczymy przy
 * renderze, więc translator nie jest zależnością efektu — przełączenie
 * języka w kroku „dane" nie zwalnia i nie zakłada blokady od nowa
 * (w oknie między DELETE a POST slot mógłby przejąć inny klient,
 * a licznik TTL resetowałby się do pełnych 10 minut).
 */
type HoldOutcome =
  | { kind: "active"; token: string; expiresAt: number }
  | { kind: "conflict" }
  | { kind: "error" };

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
  const { t } = useTranslations();
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
          setResult({ key: slotKey, outcome: { kind: "conflict" } });
          return;
        }
        setResult({ key: slotKey, outcome: { kind: "error" } });
      } catch {
        if (abandoned) return;
        setResult({ key: slotKey, outcome: { kind: "error" } });
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
    // Komunikaty z API są zawsze polskie — treść bierzemy ze słownika,
    // tłumacząc kod wyniku dopiero tutaj (przy renderze).
    message:
      outcome?.kind === "conflict"
        ? t("bf.holdConflict")
        : outcome?.kind === "error"
          ? t("bf.holdError")
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
  const { t } = useTranslations();
  // W stanie trzymamy flagę błędu, nie przetłumaczony komunikat — translator
  // nie jest zależnością efektu, więc zmiana języka nie wymusza refetchu
  // (tłumaczenie dzieje się przy renderze).
  const [state, setState] = useState<{
    key: string | null;
    data: AvailabilityResponse | null;
    error: boolean;
  }>({ key: null, data: null, error: false });

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
      .then((data) => setState({ key: requestKey, data, error: false }))
      .catch(() => {
        if (controller.signal.aborted) return;
        setState({ key: requestKey, data: null, error: true });
      });
    return () => controller.abort();
  }, [slug, serviceId, date, resourceId, requestKey]);

  const isCurrent = state.key === requestKey && requestKey !== null;
  return {
    loading: requestKey !== null && !isCurrent,
    data: isCurrent ? state.data : null,
    error: isCurrent && state.error ? t("bf.errorSlots") : null,
  };
}

function BackCircle({ onClick }: { onClick: () => void }) {
  const { t } = useTranslations();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("common.back")}
      className="mb-4 flex size-[34px] items-center justify-center rounded-full border-[1.5px] border-border-strong bg-card text-sm"
    >
      ←
    </button>
  );
}

export function BookingFlow({ data }: { data: BookingFlowData }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale, t } = useTranslations();

  const resourceParam = searchParams.get("resourceId");
  const dateParam = searchParams.get("date");
  const timeParam = searchParams.get("time");
  const krokParam = searchParams.get("krok");
  // Powrót ze Stripe Checkout (success_url/cancel_url z lib/payments.ts) to
  // pełne przeładowanie strony — stan `booking`/`payment` w pamięci przepada,
  // więc status zadatku musimy odczytać z adresu.
  const zadatekParam = searchParams.get("zadatek");
  const depositReturn: "oplacony" | "anulowany" | null =
    zadatekParam === "oplacony" || zadatekParam === "anulowany"
      ? zadatekParam
      : null;

  const [booking, setBooking] = useState<BookingResult | null>(null);
  const [payment, setPayment] = useState<BookingPayment | null>(null);
  // Rabat żyje na poziomie flow — sticky podsumowanie po prawej pokazuje
  // tę samą kwotę co krok „dane".
  const [discount, setDiscount] = useState<AppliedDiscount | null>(null);

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
        weekday: weekdaysShort(locale)[(date.getUTCDay() + 6) % 7],
        dayNumber: date.getUTCDate(),
        isToday: index === 0,
      };
    });
  }, [data.timezone, locale]);

  const todayIso = days[0].iso;

  const chosenResource =
    resourceParam && resourceParam !== "any"
      ? (data.resources.find((resource) => resource.id === resourceParam) ??
        null)
      : null;
  const staffLabel = chosenResource?.name ?? t("bf.anyStaff");
  const effectiveDurationMin =
    chosenResource?.durationMinOverride ?? data.service.durationMin;
  const effectivePriceCents =
    chosenResource?.priceCentsOverride ?? data.service.priceCents;
  const effectivePriceLabel = priceLabel(
    effectivePriceCents,
    data.service.priceType,
    data.service.currency,
    locale,
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
    // Zmiana terminu/pracownika może zmienić cenę, a rabat liczy się od niej —
    // porzucamy podgląd, żeby nie pokazywać kwoty sprzed zmiany.
    setDiscount(null);
    setParams({ krok: "termin", time: null });
  };

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-4 pb-16 md:max-w-lg lg:max-w-4xl">
      {krokParam === "sukces" ? (
        booking ? (
          <div className="mx-auto w-full max-w-md">
            <SuccessScreen
              booking={booking}
              payment={payment}
              slug={data.businessSlug}
              depositReturn={depositReturn}
            />
          </div>
        ) : (
          <div className="mx-auto max-w-md py-16 text-center">
            <h1 className="mb-2 font-display text-[27px] font-extrabold tracking-tight">
              {t("bf.confirmedTitle")}
            </h1>
            <p className="mb-6 text-[13px] text-muted-foreground">
              {depositReturn === "oplacony"
                ? t("bf.depositPaidInfo")
                : depositReturn === "anulowany"
                  ? t("bf.depositAbortedInfo")
                  : t("bf.checkEmail")}
            </p>
            <Link
              href={`/b/${data.businessSlug}`}
              className="inline-block rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground"
            >
              {t("bf.backToProfile")}
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
                discount={discount}
                onDiscountChange={setDiscount}
                onBack={() => {
                  // Porzucenie kroku danych zwalnia slot, zanim wrócimy
                  // po świeżą listę godzin.
                  setDiscount(null);
                  void hold.release().finally(() => router.back());
                }}
                onConflictRetry={backToSlots}
                onSuccess={(result, resultPayment) => {
                  setBooking(result);
                  setPayment(resultPayment);
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
                ? formatDateTimeLabel(new Date(timeParam), data.timezone, locale)
                : null
            }
            priceLabelText={effectivePriceLabel}
            deposit={data.deposit}
            currency={data.service.currency}
            discount={discount}
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
  deposit,
  currency,
  discount,
}: {
  businessName: string;
  address: string;
  serviceName: string;
  durationMin: number;
  staffLabel: string | null;
  termLabel: string | null;
  priceLabelText: string;
  deposit: BookingFlowData["deposit"];
  currency: string;
  discount: AppliedDiscount | null;
}) {
  const { locale, t } = useTranslations();
  return (
    <aside className="hidden lg:sticky lg:top-8 lg:block">
      <div className="rounded-2xl border-[1.5px] border-border-strong bg-card p-5">
        <div className="meta-label">{t("bf.summary")}</div>
        <div className="mt-1 font-display text-lg font-bold tracking-tight">
          {businessName}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">{address}</div>

        <div className="my-4 h-px bg-border" />

        <dl className="flex flex-col gap-2.5 text-[13px]">
          <div className="flex justify-between gap-3">
            <dt className="flex-none text-muted-foreground">
              {t("bf.service")}
            </dt>
            <dd className="text-right font-semibold">{serviceName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="flex-none text-muted-foreground">{t("bf.staff")}</dt>
            <dd className="text-right font-semibold">
              {staffLabel ?? <span className="text-[#8f8b81]">—</span>}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="flex-none text-muted-foreground">{t("bf.term")}</dt>
            <dd className="text-right font-mono font-medium">
              {termLabel ?? <span className="text-[#8f8b81]">—</span>}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="flex-none text-muted-foreground">
              {t("bf.duration")}
            </dt>
            <dd className="text-right font-mono">
              {formatDuration(durationMin)}
            </dd>
          </div>
        </dl>

        <div className="my-4 h-px bg-border" />

        {discount ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] text-muted-foreground">
                {t("bf.price")}
              </span>
              <span className="font-mono text-[13px] text-muted-foreground line-through">
                {formatPrice(discount.subtotalCents, currency, locale)}
              </span>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-3">
              <span className="text-[13px] text-muted-foreground">
                {t("bf.discount")}
                <span className="ml-1.5 font-mono text-[11px] tracking-wider text-[#8f8b81]">
                  {discount.code}
                </span>
              </span>
              <span className="font-mono text-[13px] font-medium text-success">
                −{formatPrice(discount.discountCents, currency, locale)}
              </span>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-3">
              <span className="text-[13px] font-semibold">{t("bf.toPay")}</span>
              <span className="font-mono text-base font-medium">
                {formatPrice(discount.totalCents, currency, locale)}
              </span>
            </div>
          </>
        ) : (
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-semibold">{t("bf.price")}</span>
            <span className="font-mono text-base font-medium">
              {priceLabelText}
            </span>
          </div>
        )}

        {deposit ? (
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <span className="text-[13px] text-muted-foreground">
              {t("bf.deposit")}
              <span className="block text-[11px] text-[#8f8b81]">
                {deposit.stripeEnabled
                  ? t("bf.depositOnline")
                  : t("bf.depositOnsite")}
              </span>
            </span>
            <span className="font-mono text-[13px] font-medium">
              {formatPrice(deposit.amountCents, currency, locale)}
            </span>
          </div>
        ) : null}
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
  const { locale, t, tp } = useTranslations();
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
      <div className="meta-label">{t("bf.step1")}</div>
      <h1 className="mt-1.5 mb-1 font-display text-[29px] font-extrabold tracking-tight">
        {t("bf.whoTitle")}
      </h1>
      <div className="mb-5 text-[13px] text-muted-foreground">
        {data.service.name} · {formatDuration(data.service.durationMin)} ·{" "}
        {priceLabel(
          data.service.priceCents,
          data.service.priceType,
          data.service.currency,
          locale,
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
              {t("bf.anyStaff")}
            </div>
            <div className="mt-[3px] text-xs text-primary-foreground/70">
              {t("bf.mergedAvailability")}
            </div>
          </div>
          <div className="flex-none text-right">
            <div className="font-mono text-xl font-medium">
              {today.loading ? "…" : mergedToday.length}
            </div>
            <div className="text-[10px] text-primary-foreground/70">
              {t("bf.slotsTodayLabel")}
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
                `${delta > 0 ? "+" : "−"}${formatPrice(Math.abs(delta), data.service.currency, locale)}`,
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
                    {t("bf.todayFrom", {
                      time: formatTimeInZone(
                        new Date(slots[0].startAt),
                        data.timezone,
                      ),
                      slots: tp("plural.slots", slots.length),
                    })}
                  </div>
                ) : (
                  <div className="mt-[5px] font-mono text-[11px] font-medium text-warning">
                    {t("bf.noSlotsToday")}
                  </div>
                )}
              </div>
              <span className="flex-none text-[#8f8b81]">›</span>
            </button>
          );
        })}
      </div>

      <p className="mt-[18px] text-xs leading-relaxed text-muted-foreground">
        {t("bf.anyHint")}
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
  const { locale, t } = useTranslations();
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
      { key: "bf.morning" as const, slots: rano },
      { key: "bf.afternoon" as const, slots: popoludniu },
      { key: "bf.evening" as const, slots: wieczorem },
    ].filter((group) => group.slots.length > 0);
  }, [availability.data, data.timezone]);

  const selectedDay = days.find((day) => day.iso === selectedDate);
  const selectedDayLabel = selectedDay
    ? formatDayFull(new Date(`${selectedDate}T12:00:00Z`), "UTC", locale)
    : "";

  return (
    <div>
      <BackCircle onClick={onBack} />
      <div className="meta-label">{t("bf.step2")}</div>
      <h1 className="mt-1.5 mb-1 font-display text-[29px] font-extrabold tracking-tight">
        {t("bf.whenTitle")}
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
                {day.isToday ? t("common.today") : day.weekday}
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
            {t("bf.grid", { min: data.slotGranularityMin })}
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
              {t("common.retry")}
            </button>
          </div>
        ) : groups.length === 0 ? (
          <div className="mx-auto mt-3 max-w-md">
            <h2 className="mb-3.5 font-display text-xl font-extrabold tracking-tight">
              {t("bf.noFreeHours")}
            </h2>
            {nearest ? (
              <button
                type="button"
                onClick={() => onPickDay(nearest.iso)}
                className="flex w-full items-center justify-between rounded-xl border-[1.5px] border-border-strong bg-[#f7f4ef] px-3 py-[11px] text-left dark:bg-secondary"
              >
                <div>
                  <div className="text-[12.5px] font-bold">
                    {t("bf.nearest", {
                      day: formatDayShort(
                        new Date(`${nearest.iso}T12:00:00Z`),
                        "UTC",
                        locale,
                      ),
                    })}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {nearest.firstSlots.join(", ")}
                  </div>
                </div>
                <span className="text-sm">›</span>
              </button>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                {t("bf.noneNextWeek")}
              </p>
            )}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.key}>
              <div className="mt-3.5 mb-2 text-xs font-bold">
                {t(group.key)}
              </div>
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
          {t("bf.tzNote", {
            tz: data.timezone,
            lead: leadTimeLabel(data.minLeadTimeMin),
          })}
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
  discount,
  onDiscountChange,
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
  discount: AppliedDiscount | null;
  onDiscountChange: (next: AppliedDiscount | null) => void;
  onBack: () => void;
  onConflictRetry: () => void;
  onSuccess: (booking: BookingResult, payment: BookingPayment | null) => void;
}) {
  const { locale, t } = useTranslations();
  const { name, phone, email } = guest;
  const setName = (value: string) => onGuestChange({ name: value });
  const setPhone = (value: string) => onGuestChange({ phone: value });
  const setEmail = (value: string) => onGuestChange({ email: value });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codePending, setCodePending] = useState(false);

  // Rabat ma sens tylko przy konkretnej kwocie — usługa „bezpłatna" albo
  // „na zapytanie" nie ma od czego liczyć zniżki.
  const priceKnown =
    data.service.priceType !== "FREE" && data.service.priceType !== "ON_REQUEST";

  const applyCode = async () => {
    const entered = codeInput.trim();
    if (entered === "") return;
    setCodeError(null);
    setCodePending(true);
    try {
      const result = await previewDiscountAction({
        businessSlug: data.businessSlug,
        serviceId: data.service.id,
        resourceId: resourceId === "any" ? undefined : resourceId,
        code: entered,
        guestEmail: email.trim() || undefined,
        guestPhone: phone.trim() || undefined,
      });
      if (result.ok) {
        onDiscountChange({
          code: result.code,
          discountCents: result.discountCents,
          subtotalCents: result.subtotalCents,
          totalCents: result.totalCents,
        });
        setCodeInput("");
      } else {
        onDiscountChange(null);
        setCodeError(result.error);
      }
    } catch {
      setCodeError(t("bf.codeCheckFailed"));
    } finally {
      setCodePending(false);
    }
  };

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
        setError(t("form.errName"));
        return;
      }
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
        setError(t("form.errEmail"));
        return;
      }
      if (phone.trim().length < 7) {
        setError(t("form.errPhone"));
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
          discountCode: discount?.code,
        }),
      });
      const json = (await response.json().catch(() => null)) as {
        booking?: BookingResult;
        payment?: BookingPayment | null;
        error?: string;
        message?: string;
      } | null;

      if (response.status === 201 && json?.booking) {
        onSuccess(json.booking, json.payment ?? null);
        return;
      }
      // Kod przestał działać między podglądem a potwierdzeniem (limit,
      // wygaśnięcie) — zdejmujemy go i zostawiamy klienta przy rezerwacji.
      // Komunikaty z API są zawsze polskie — treść bierzemy ze słownika.
      if (json?.error === "DISCOUNT_INVALID") {
        onDiscountChange(null);
        setCodeError(t("bf.codeStopped"));
        setError(t("bf.codeStoppedRecheck"));
        return;
      }
      if (response.status === 409) {
        setConflict(t("bf.conflict409"));
        return;
      }
      setError(t("bf.createFailed"));
    } catch {
      setError(t("common.connectionError"));
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "w-full rounded-[11px] border border-border bg-card px-[13px] py-3 text-sm outline-none focus:border-border-strong focus:border-[1.5px]";

  return (
    <div>
      <BackCircle onClick={onBack} />
      <div className="meta-label">{t("bf.step3")}</div>
      <h1 className="mt-1.5 mb-[18px] font-display text-[29px] font-extrabold tracking-tight">
        {t("bf.almostDone")}
      </h1>

      {activeConflict ? (
        <div className="mx-auto mb-4 max-w-md rounded-2xl border-[1.5px] border-border-strong bg-card p-4">
          <div className="mb-3 flex size-9 items-center justify-center rounded-full border border-[#d9a9a1] bg-[#f4e3e0] text-[17px] text-destructive">
            !
          </div>
          <div className="mb-1.5 font-display text-[21px] leading-tight font-extrabold tracking-tight">
            {t("bf.slotTaken", {
              time: formatTimeInZone(startAt, data.timezone),
            })}
          </div>
          <p className="mb-3.5 text-[12.5px] leading-relaxed text-foreground/80">
            {activeConflict} {t("bf.dataStays")}
          </p>
          <button
            type="button"
            onClick={onConflictRetry}
            className="w-full rounded-[10px] bg-primary p-3 text-[13px] font-bold text-primary-foreground"
          >
            {t("bf.showFree")}
          </button>
        </div>
      ) : null}

      {holdExpired ? (
        <div className="mx-auto mb-4 max-w-md rounded-2xl border-[1.5px] border-border-strong bg-card p-4">
          <div className="mb-3 flex size-9 items-center justify-center rounded-full border border-warning bg-warning-soft text-[15px] text-warning-strong">
            ⏱
          </div>
          <div className="mb-1.5 font-display text-[21px] leading-tight font-extrabold tracking-tight">
            {t("bf.holdExpiredTitle")}
          </div>
          <p className="mb-3.5 text-[12.5px] leading-relaxed text-foreground/80">
            {t("bf.holdExpiredText", {
              time: formatTimeInZone(startAt, data.timezone),
            })}
          </p>
          <button
            type="button"
            onClick={onConflictRetry}
            className="w-full rounded-[10px] bg-primary p-3 text-[13px] font-bold text-primary-foreground"
          >
            {t("bf.showFree")}
          </button>
        </div>
      ) : null}

      {!activeConflict && !holdExpired ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-[14px] border border-border bg-accent px-3.5 py-2.5">
          <div className="min-w-0">
            <div className="meta-label">{t("bf.holdLabel")}</div>
            <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
              {hold.status === "error"
                ? t("bf.holdErrorNote")
                : t("bf.holdFinish")}
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
          <span>{t("bf.term")}</span>
          <span className="font-mono font-medium text-foreground">
            {formatDayShort(startAt, data.timezone, locale)} ·{" "}
            {formatTimeInZone(startAt, data.timezone)}
          </span>
        </div>
        <div className="mt-1.5 flex justify-between text-[13px] text-foreground/80">
          <span>{t("bf.staff")}</span>
          <span className="font-semibold text-foreground">
            {resourceId === "any" ? t("bf.assignedAtConfirm") : staffLabel}
          </span>
        </div>
        <div className="mt-1.5 flex justify-between text-[13px] text-foreground/80">
          <span>{t("bf.duration")}</span>
          <span className="font-mono text-foreground">
            {formatDuration(durationMin)}
          </span>
        </div>
        {data.deposit ? (
          <>
            <div className="my-[11px] h-px bg-[#e2ddd2] dark:bg-border" />
            <div className="flex justify-between text-[13px] text-foreground/80">
              <span>
                {t("bf.deposit")}
                <span className="ml-1.5 text-[11px] text-[#8f8b81]">
                  {data.deposit.stripeEnabled
                    ? t("bf.depositOnline")
                    : t("bf.depositOnsite")}
                </span>
              </span>
              <span className="font-mono font-medium text-foreground">
                {formatPrice(
                  data.deposit.amountCents,
                  data.service.currency,
                  locale,
                )}
              </span>
            </div>
          </>
        ) : null}

        {priceKnown ? (
          <>
            <div className="my-[11px] h-px bg-[#e2ddd2] dark:bg-border" />
            {discount ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="min-w-0">
                    {t("bf.discount")}
                    <span className="ml-1.5 font-mono text-[11px] tracking-wider text-[#8f8b81]">
                      {discount.code}
                    </span>
                  </span>
                  <span className="flex-none font-mono font-medium text-success">
                    −
                    {formatPrice(
                      discount.discountCents,
                      data.service.currency,
                      locale,
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] font-bold">{t("bf.toPay")}</span>
                  <span className="font-mono text-[17px] font-medium">
                    {formatPrice(
                      discount.totalCents,
                      data.service.currency,
                      locale,
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onDiscountChange(null);
                    setCodeError(null);
                  }}
                  className="self-start text-[11.5px] text-muted-foreground underline underline-offset-2"
                >
                  {t("bf.removeCode")}
                </button>
              </div>
            ) : (
              <div>
                <label
                  htmlFor="discount-code-input"
                  className="mb-[5px] block text-[11px] font-semibold text-muted-foreground"
                >
                  {t("bf.haveCode")}
                </label>
                <div className="flex gap-2">
                  <input
                    id="discount-code-input"
                    value={codeInput}
                    onChange={(event) => {
                      setCodeInput(event.target.value);
                      if (codeError) setCodeError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void applyCode();
                      }
                    }}
                    autoComplete="off"
                    autoCapitalize="characters"
                    placeholder={t("bf.codePlaceholder")}
                    aria-invalid={codeError !== null}
                    className={`${inputClass} min-w-0 flex-1 font-mono tracking-wider uppercase ${
                      codeError ? "border-[1.5px] border-destructive" : ""
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => void applyCode()}
                    disabled={codePending || codeInput.trim() === ""}
                    className="flex-none rounded-[11px] border-[1.5px] border-border-strong bg-card px-4 text-[13px] font-semibold disabled:opacity-50"
                  >
                    {codePending ? t("bf.checkingCode") : t("bf.apply")}
                  </button>
                </div>
                {codeError ? (
                  <p
                    role="alert"
                    className="mt-1.5 text-[12px] font-semibold text-destructive"
                  >
                    {codeError}
                  </p>
                ) : null}
              </div>
            )}
          </>
        ) : null}
      </div>

      {isGuest ? (
        <div className="flex flex-col gap-[11px]">
          <div>
            <label
              htmlFor="guest-name"
              className="mb-[5px] block text-[11px] font-semibold text-muted-foreground"
            >
              {t("form.fullName")}
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
              {t("form.phone")}{" "}
              <span className="font-normal text-[#8f8b81]">
                {t("form.phoneHintSms")}
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
              {t("form.email")}
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
          <div className="meta-label mb-1.5">{t("bf.bookingAs")}</div>
          <div className="text-sm font-semibold">
            {data.user?.name ?? t("bf.yourAccount")}
          </div>
          {data.user?.email ? (
            <div className="mt-0.5 text-[13px] text-muted-foreground">
              {data.user.email}
            </div>
          ) : null}
        </div>
      )}

      <div className="mt-5 rounded-[14px] border border-[#e2ddd2] bg-card p-[13px] dark:border-border">
        <div className="mb-[7px] text-xs font-bold">
          {t("profile.cancelPolicy")}
        </div>
        <p className="text-[11.5px] leading-relaxed text-foreground/80">
          {t("profile.cancelPolicyText", {
            hours: data.cancellationCutoffHours,
          })}
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
          ? t("bf.submitting")
          : t("bf.confirmCta", {
              price: discount
                ? formatPrice(
                    discount.totalCents,
                    data.service.currency,
                    locale,
                  )
                : priceLabelText,
            })}
      </button>
      <p className="mt-2 text-center text-[11px] text-[#8f8b81]">
        {data.deposit
          ? data.deposit.stripeEnabled
            ? t("bf.depositPayOnline", {
                amount: formatPrice(
                  data.deposit.amountCents,
                  data.service.currency,
                  locale,
                ),
              })
            : t("bf.depositPayOnsite", {
                amount: formatPrice(
                  data.deposit.amountCents,
                  data.service.currency,
                  locale,
                ),
              })
          : t("bf.payInVenue")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sukces
// ---------------------------------------------------------------------------

function SuccessScreen({
  booking,
  payment,
  slug,
  depositReturn,
}: {
  booking: BookingResult;
  payment: BookingPayment | null;
  slug: string;
  /** Status powrotu z bramki (searchParam `zadatek`), gdy klient stąd wracał. */
  depositReturn: "oplacony" | "anulowany" | null;
}) {
  const { locale, t } = useTranslations();
  const startAt = new Date(booking.startAt);
  const deadline = new Date(booking.cancellationDeadline);
  // Powrót z bramki jest świeższy niż status zapisany przy tworzeniu
  // płatności (PENDING w chwili wystawienia linku do Checkoutu).
  const depositPaid = payment?.status === "PAID" || depositReturn === "oplacony";
  const depositAborted = !depositPaid && depositReturn === "anulowany";

  return (
    <div className="pt-7">
      <div className="mb-5 flex size-[58px] items-center justify-center rounded-full bg-primary text-[26px] text-primary-foreground">
        ✓
      </div>
      <h1 className="mb-2 font-display text-[32px] leading-none font-extrabold tracking-tight">
        {t("bf.booked")}
      </h1>
      <p className="mb-[22px] text-sm leading-relaxed text-foreground/80">
        {t("bf.successNote")}
      </p>

      <div className="overflow-hidden rounded-2xl border-[1.5px] border-border-strong bg-card">
        <div className="border-b border-dashed border-[#d8d2c4] p-4 dark:border-border">
          <div className="meta-label">
            {formatDayFull(startAt, booking.timezone, locale)}
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
          <div className="text-right">
            {booking.discountCents && booking.subtotalCents ? (
              <div className="font-mono text-[11px] text-[#8f8b81] line-through">
                {formatPrice(booking.subtotalCents, booking.currency, locale)}
              </div>
            ) : null}
            <div className="font-mono text-base font-medium">
              {formatPrice(booking.priceCents, booking.currency, locale)}
            </div>
            {booking.discountCents ? (
              <div className="font-mono text-[11px] font-medium text-success">
                {t("bf.discountMinus", {
                  amount: formatPrice(
                    booking.discountCents,
                    booking.currency,
                    locale,
                  ),
                })}
              </div>
            ) : null}
          </div>
        </div>
        {payment ? (
          <div className="border-t border-dashed border-[#d8d2c4] px-4 py-3 dark:border-border">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="meta-label">{t("bf.deposit")}</div>
                <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                  {depositPaid
                    ? t("bf.depositPaidThanks")
                    : depositAborted
                      ? t("bf.depositAbortedRetry")
                      : payment.redirectUrl
                        ? t("bf.depositFinishOnline")
                        : t("bf.depositOnsiteAtVisit")}
                </div>
              </div>
              <div className="flex-none font-mono text-base font-medium">
                {formatPrice(payment.amountCents, payment.currency, locale)}
              </div>
            </div>
            {!depositPaid && payment.redirectUrl ? (
              <a
                href={payment.redirectUrl}
                className="mt-3 block w-full rounded-xl bg-primary py-3 text-center text-[13px] font-bold text-primary-foreground"
              >
                {depositAborted
                  ? `${t("bf.retryDeposit")} · `
                  : `${t("bf.payDeposit")} · `}
                {formatPrice(payment.amountCents, payment.currency, locale)}
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className="flex-1 rounded-xl border-[1.5px] border-border-strong bg-card py-[13px] text-[13px] font-semibold"
        >
          {t("bf.addToCalendar")}
        </button>
        <button
          type="button"
          className="flex-1 rounded-xl border-[1.5px] border-border-strong bg-card py-[13px] text-[13px] font-semibold"
        >
          {t("bf.navigate")}
        </button>
      </div>
      <Link
        href="/"
        className="mt-2 block w-full rounded-xl bg-primary p-[15px] text-center text-sm font-bold text-primary-foreground"
      >
        {t("bf.backToSearch")}
      </Link>
      <p className="mt-4 text-center text-[11.5px] leading-relaxed text-[#8f8b81]">
        {t("bf.cancelFreeUntilFull", {
          hours: booking.cancellationCutoffHours,
          deadline: `${formatDayShort(deadline, booking.timezone, locale)}, ${formatTimeInZone(deadline, booking.timezone)}`,
        })}
      </p>
      <p className="mt-1 text-center text-[11px] text-[#8f8b81]">
        <Link href={`/b/${slug}`} className="underline underline-offset-2">
          {t("bf.seeProfile", { name: booking.businessName })}
        </Link>
      </p>
    </div>
  );
}
