"use client";

import { useCallback, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { formatPrice, priceLabel } from "@/components/marketplace/format";
import { INTL_LOCALE, type Locale, type MessageKey } from "@/i18n";
import { useTranslations } from "@/i18n/client";

/**
 * Flow rezerwacji w widgecie: usługa → termin → dane → potwierdzenie.
 *
 * Zaprojektowany pod wąski iframe (320–480 px), ale skaluje się też na
 * pełną szerokość. Rozmawia z tym samym /api/v1 co marketplace; rezerwacja
 * dostaje źródło WEB_WIDGET.
 */

export type WidgetService = {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  priceType: string;
  currency: string;
};

export type WidgetDay = {
  /** YYYY-MM-DD w strefie lokalu. */
  value: string;
  weekday: string;
  label: string;
  isToday: boolean;
};

type Step = "usluga" | "termin" | "dane" | "sukces";

type Slot = { startAt: string };

type CreatedBooking = {
  id: string;
  startAt: string;
  serviceName: string;
  resourceName: string;
  priceCents: number;
  currency: string;
};

const STEP_LABEL_KEY: Record<Exclude<Step, "sukces">, MessageKey> = {
  usluga: "wg.step.usluga",
  termin: "wg.step.termin",
  dane: "wg.step.dane",
};

/** Cena zawsze z walutą usługi (Business.currency); locale tylko zapisuje kwotę. */
const priceLabelFor = (service: WidgetService, locale: Locale) =>
  priceLabel(service.priceCents, service.priceType, service.currency, locale);

export function WidgetFlow({
  businessSlug,
  businessName,
  address,
  timezone,
  days,
  services,
}: {
  businessSlug: string;
  businessName: string;
  address: string;
  timezone: string;
  days: WidgetDay[];
  services: WidgetService[];
}) {
  const { locale, t } = useTranslations();
  const [step, setStep] = useState<Step>("usluga");
  const [service, setService] = useState<WidgetService | null>(null);
  const [day, setDay] = useState<string>(days[0]?.value ?? "");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedBooking | null>(null);

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(INTL_LOCALE[locale], {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
      }),
    [timezone, locale],
  );
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(INTL_LOCALE[locale], {
        timeZone: timezone,
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [timezone, locale],
  );

  const loadSlots = useCallback(
    async (serviceId: string, date: string) => {
      setSlots(null);
      setSlotsError(null);
      setSlot(null);
      try {
        const response = await fetch(
          `/api/v1/businesses/${businessSlug}/availability?serviceId=${encodeURIComponent(serviceId)}&date=${date}`,
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as { slots: Slot[] };
        setSlots(data.slots);
      } catch {
        setSlotsError(t("bf.errorSlots"));
      }
    },
    [businessSlug, t],
  );

  const submit = async () => {
    if (!service || !slot) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch("/api/v1/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessSlug,
          serviceId: service.id,
          startAt: slot,
          source: "WEB_WIDGET",
          guest: { name, email, phone },
          ...(note.trim() ? { customerNote: note.trim() } : {}),
        }),
      });
      const data = (await response.json()) as {
        booking?: {
          id: string;
          startAt: string;
          serviceName: string;
          resourceName: string;
          priceCents: number;
          currency: string;
        };
        error?: string;
        message?: string;
      };
      if (!response.ok || !data.booking) {
        if (response.status === 409) {
          // Slot sprzątnięty w międzyczasie — wracamy do wyboru godziny.
          // Komunikaty z API są polskie, więc treść bierzemy ze słownika.
          setStep("termin");
          setSlotsError(t("wg.slotTaken"));
          if (service) void loadSlots(service.id, day);
          return;
        }
        setSubmitError(t("bf.createFailed"));
        return;
      }
      setCreated({
        id: data.booking.id,
        startAt: data.booking.startAt,
        serviceName: data.booking.serviceName,
        resourceName: data.booking.resourceName,
        priceCents: data.booking.priceCents,
        currency: data.booking.currency,
      });
      setStep("sukces");
    } catch {
      setSubmitError(t("wg.noConnection"));
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "h-11 w-full rounded-lg border border-border bg-card px-3 text-[14px] outline-none focus:border-border-strong";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-4">
      {/* Nagłówek widgetu */}
      <header className="mb-4">
        <div className="meta-label">{t("wg.onlineBooking")}</div>
        <h1 className="mt-0.5 font-display text-[20px] leading-tight font-extrabold tracking-tight">
          {businessName}
        </h1>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
          {address}
        </p>
      </header>

      {step !== "sukces" && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="meta-label">{t(STEP_LABEL_KEY[step])}</span>
          {step !== "usluga" && (
            <button
              type="button"
              className="min-h-11 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSubmitError(null);
                setStep(step === "dane" ? "termin" : "usluga");
              }}
            >
              ← {t("common.back")}
            </button>
          )}
        </div>
      )}

      {/* KROK 1 — usługa */}
      {step === "usluga" &&
        (services.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card px-4 py-8 text-center text-[13px] text-muted-foreground">
            {t("wg.noServices")}
          </p>
        ) : (
          <ul className="flex flex-col">
            {services.map((entry) => (
              <li key={entry.id} className="border-t border-muted first:border-t-0">
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center gap-3 py-3 text-left"
                  onClick={() => {
                    setService(entry);
                    setStep("termin");
                    void loadSlots(entry.id, day);
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">
                      {entry.name}
                    </span>
                    <span className="mt-0.5 block font-mono text-[12px] text-muted-foreground">
                      {entry.durationMin} min · {priceLabelFor(entry, locale)}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full border-[1.5px] border-border-strong bg-card px-3.5 py-1.5 text-[12px] font-semibold">
                    {t("common.select")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ))}

      {/* KROK 2 — termin */}
      {step === "termin" && service && (
        <div>
          <div className="mb-3 rounded-xl bg-secondary px-3 py-2 text-[12.5px]">
            <span className="font-semibold">{service.name}</span>
            <span className="ml-2 font-mono text-[11.5px] text-muted-foreground">
              {service.durationMin} min · {priceLabelFor(service, locale)}
            </span>
          </div>

          {/* Pasek dni — przewija się poziomo we własnym kontenerze */}
          <div className="-mx-4 mb-3 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max gap-1.5">
              {days.map((entry) => {
                const active = entry.value === day;
                return (
                  <button
                    key={entry.value}
                    type="button"
                    className={cn(
                      "flex min-h-11 min-w-14 flex-col items-center justify-center rounded-xl border px-2 py-1.5",
                      active
                        ? "border-border-strong bg-primary text-primary-foreground"
                        : "border-border bg-card",
                    )}
                    onClick={() => {
                      setDay(entry.value);
                      void loadSlots(service.id, entry.value);
                    }}
                  >
                    <span className="font-mono text-[10px] uppercase">
                      {entry.isToday ? t("common.today") : entry.weekday}
                    </span>
                    <span className="text-[13px] font-semibold">
                      {entry.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {slotsError && (
            <p className="mb-3 rounded-xl bg-warning-soft px-3 py-2 text-[12.5px] text-warning-strong">
              {slotsError}
            </p>
          )}

          {slots === null && !slotsError ? (
            <p className="py-6 text-center font-mono text-[12px] text-muted-foreground">
              {t("wg.searching")}
            </p>
          ) : slots !== null && slots.length === 0 ? (
            <p className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
              {t("wg.noneToday")}
            </p>
          ) : slots !== null ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {slots.map((entry) => (
                <button
                  key={entry.startAt}
                  type="button"
                  className={cn(
                    "min-h-11 rounded-lg border font-mono text-[13px]",
                    slot === entry.startAt
                      ? "border-border-strong bg-primary font-medium text-primary-foreground"
                      : "border-border bg-card hover:border-border-strong",
                  )}
                  onClick={() => setSlot(entry.startAt)}
                >
                  {timeFormatter.format(new Date(entry.startAt))}
                </button>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            disabled={!slot}
            className="mt-4 min-h-11 w-full rounded-full bg-primary px-4 text-[13.5px] font-semibold text-primary-foreground disabled:opacity-40"
            onClick={() => setStep("dane")}
          >
            {t("common.next")}
          </button>
        </div>
      )}

      {/* KROK 3 — dane */}
      {step === "dane" && service && slot && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="rounded-xl bg-accent px-3 py-2.5 text-[12.5px]">
            <span className="font-semibold">{service.name}</span>
            <span className="ml-2 font-mono text-[11.5px] text-muted-foreground">
              {dateTimeFormatter.format(new Date(slot))} ·{" "}
              {priceLabelFor(service, locale)}
            </span>
          </div>

          <label className="flex flex-col gap-1.5 text-[12.5px] font-medium">
            {t("form.fullName")}
            <input
              required
              minLength={2}
              maxLength={120}
              className={inputClass}
              value={name}
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-medium">
            {t("form.email")}
            <input
              required
              type="email"
              className={inputClass}
              value={email}
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-medium">
            {t("form.phone")}
            <input
              required
              type="tel"
              minLength={7}
              maxLength={20}
              pattern="[+0-9][0-9 -]+"
              className={inputClass}
              value={phone}
              autoComplete="tel"
              placeholder="+48 600 700 800"
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-medium">
            {t("wg.notesOptional")}
            <textarea
              maxLength={500}
              rows={2}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-[14px] outline-none focus:border-border-strong"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          {submitError && (
            <p className="rounded-xl bg-warning-soft px-3 py-2 text-[12.5px] text-warning-strong">
              {submitError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="min-h-11 w-full rounded-full bg-primary px-4 text-[13.5px] font-semibold text-primary-foreground disabled:opacity-40"
          >
            {submitting ? t("bf.submitting") : t("wg.book")}
          </button>
          <p className="text-center text-[11px] text-muted-foreground">
            {t("wg.confirmEmail")}
          </p>
        </form>
      )}

      {/* Potwierdzenie */}
      {step === "sukces" && created && (
        <div className="flex flex-col items-center gap-4 rounded-2xl border-[1.5px] border-border-strong bg-card px-4 py-8 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-accent font-mono text-[18px] text-success">
            ✓
          </span>
          <div>
            <h2 className="font-display text-[22px] font-extrabold tracking-tight">
              {t("wg.booked")}
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {t("wg.waiting", { name: businessName })}
            </p>
          </div>
          <dl className="w-full max-w-xs text-left text-[13px]">
            <div className="flex justify-between gap-3 border-t border-muted py-2">
              <dt className="text-muted-foreground">{t("bf.service")}</dt>
              <dd className="font-semibold">{created.serviceName}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-muted py-2">
              <dt className="text-muted-foreground">{t("bf.term")}</dt>
              <dd className="font-mono text-[12.5px]">
                {dateTimeFormatter.format(new Date(created.startAt))}
              </dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-muted py-2">
              <dt className="text-muted-foreground">{t("wg.specialist")}</dt>
              <dd className="font-semibold">{created.resourceName}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-b border-muted py-2">
              <dt className="text-muted-foreground">{t("bf.price")}</dt>
              <dd className="font-mono text-[12.5px]">
                {formatPrice(created.priceCents, created.currency, locale)}
              </dd>
            </div>
          </dl>
          <p className="text-[11.5px] text-muted-foreground">
            {t("wg.emailDetails")}
          </p>
          <button
            type="button"
            className="min-h-11 rounded-full border-[1.5px] border-border-strong bg-card px-5 text-[13px] font-semibold"
            onClick={() => {
              setService(null);
              setSlot(null);
              setNote("");
              setCreated(null);
              setStep("usluga");
            }}
          >
            {t("wg.bookAnother")}
          </button>
        </div>
      )}
    </div>
  );
}
