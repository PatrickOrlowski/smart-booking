"use client";

import { useMemo, useState } from "react";
import { BellRing } from "lucide-react";
import { zonedTimeToUtc } from "@/lib/time";
import { formatTimeInZone } from "@/components/marketplace/format";
import { isoDayLabel, partySizeLabel } from "./format";
import type { RestaurantBookingData } from "./types";

/**
 * Zapis na listę oczekujących — pokazywany tam, gdzie kończą się wolne
 * godziny. Gość wybiera preferowaną porę i tolerancję („±1 h"), lokal
 * odzywa się, gdy stolik się zwolni (POST /api/v1/restaurants/[slug]/waitlist).
 *
 * Siatka pór budowana jest z godzin otwarcia lokalu w JEGO strefie i dopiero
 * potem zamieniana na instant UTC — nigdy z zegara przeglądarki.
 */

const FLEX_OPTIONS = [
  { value: 30, label: "±30 min" },
  { value: 60, label: "±1 h" },
  { value: 120, label: "±2 h" },
];

const inputClass =
  "w-full rounded-[11px] border border-border bg-card px-[13px] py-3 text-sm outline-none focus:border-[1.5px] focus:border-border-strong";

/** Dzień „YYYY-MM-DD" → 0 = poniedziałek … 6 = niedziela. */
const isoWeekday = (iso: string): number =>
  (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;

export function WaitlistForm({
  data,
  date,
  partySize,
}: {
  data: RestaurantBookingData;
  /** Dzień lokalny lokalu, dla którego zabrakło stolików. */
  date: string;
  partySize: number;
}) {
  const [name, setName] = useState(data.user?.name ?? "");
  const [phone, setPhone] = useState(data.user?.phone ?? "");
  const [email, setEmail] = useState(data.user?.email ?? "");
  const [flexMin, setFlexMin] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // „Teraz" bierzemy z zegara serwera (props), nie z `Date.now()` w renderze.
  const nowMs = Date.parse(data.nowIso);

  // Możliwe pory: co 30 min w godzinach otwarcia tego dnia, tylko przyszłe.
  const times = useMemo(() => {
    const [year, month, day] = date.split("-").map(Number);
    const weekday = isoWeekday(date);
    const result: { iso: string; label: string }[] = [];
    for (const block of data.openingHours.filter(
      (entry) => entry.weekday === weekday,
    )) {
      for (
        let minute = block.startMinute;
        minute <= block.endMinute - 60;
        minute += 30
      ) {
        const instant = zonedTimeToUtc(
          {
            year,
            month,
            day,
            hour: Math.floor(minute / 60),
            minute: minute % 60,
          },
          data.timezone,
        );
        if (instant.getTime() <= nowMs) continue;
        result.push({
          iso: instant.toISOString(),
          label: formatTimeInZone(instant, data.timezone),
        });
      }
    }
    return result.sort((a, b) => a.iso.localeCompare(b.iso));
  }, [date, data.openingHours, data.timezone, nowMs]);

  const [requestedAt, setRequestedAt] = useState<string>("");
  const selectedTime = requestedAt || times[0]?.iso || "";

  if (times.length === 0) {
    return (
      <p className="rounded-2xl border border-border bg-card p-4 text-[12.5px] text-muted-foreground">
        Tego dnia lokal jest już zamknięty — wybierz inny dzień, żeby zapisać
        się na listę oczekujących.
      </p>
    );
  }

  if (done) {
    return (
      <div className="rounded-2xl border-[1.5px] border-border-strong bg-accent p-4">
        <div className="mb-2.5 flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <BellRing aria-hidden className="size-4" />
        </div>
        <div className="font-display text-[19px] leading-tight font-extrabold tracking-tight">
          Jesteś na liście oczekujących
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground/80">
          Odezwiemy się, jeśli stolik się zwolni — {isoDayLabel(date)} około{" "}
          {formatTimeInZone(new Date(selectedTime), data.timezone)},{" "}
          {partySizeLabel(partySize)}. Zapis nie jest rezerwacją.
        </p>
      </div>
    );
  }

  const submit = async () => {
    setError(null);
    if (!data.user) {
      if (name.trim().length < 2) {
        setError("Podaj imię i nazwisko.");
        return;
      }
      if (phone.trim().length < 7 && !/^\S+@\S+\.\S+$/.test(email.trim())) {
        setError("Podaj telefon albo e-mail — inaczej nie damy znać.");
        return;
      }
    }
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/v1/restaurants/${data.slug}/waitlist`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestedAt: selectedTime,
            partySize,
            flexMin,
            guest: data.user
              ? undefined
              : {
                  name: name.trim(),
                  ...(email.trim() ? { email: email.trim() } : {}),
                  ...(phone.trim() ? { phone: phone.trim() } : {}),
                },
          }),
        },
      );
      const json = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      if (response.ok) {
        setDone(true);
        return;
      }
      setError(json?.message ?? "Nie udało się zapisać. Spróbuj ponownie.");
    } catch {
      setError("Błąd połączenia. Sprawdź internet i spróbuj ponownie.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="meta-label">Lista oczekujących</div>
      <div className="mt-1 mb-1.5 font-display text-[19px] leading-tight font-extrabold tracking-tight">
        Damy znać, gdy stolik się zwolni
      </div>
      <p className="mb-3.5 text-[12.5px] leading-relaxed text-muted-foreground">
        Zostaw kontakt — odzywamy się do pierwszej pasującej osoby. Zapis nie
        jest rezerwacją.
      </p>

      <div className="flex flex-col gap-[11px]">
        <div className="grid gap-[11px] sm:grid-cols-2">
          <div>
            <label
              htmlFor="waitlist-time"
              className="mb-[5px] block text-[11px] font-semibold text-muted-foreground"
            >
              Preferowana godzina
            </label>
            <select
              id="waitlist-time"
              value={selectedTime}
              onChange={(event) => setRequestedAt(event.target.value)}
              className={`${inputClass} min-h-11 font-mono`}
            >
              {times.map((time) => (
                <option key={time.iso} value={time.iso}>
                  {time.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="waitlist-flex"
              className="mb-[5px] block text-[11px] font-semibold text-muted-foreground"
            >
              Tolerancja
            </label>
            <select
              id="waitlist-flex"
              value={flexMin}
              onChange={(event) => setFlexMin(Number(event.target.value))}
              className={`${inputClass} min-h-11`}
            >
              {FLEX_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {data.user ? (
          <p className="text-[12px] text-muted-foreground">
            Zapisujemy Cię jako {data.user.name ?? "zalogowanego gościa"}.
          </p>
        ) : (
          <>
            <div>
              <label
                htmlFor="waitlist-name"
                className="mb-[5px] block text-[11px] font-semibold text-muted-foreground"
              >
                Imię i nazwisko
              </label>
              <input
                id="waitlist-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                className={`${inputClass} min-h-11`}
              />
            </div>
            <div className="grid gap-[11px] sm:grid-cols-2">
              <div>
                <label
                  htmlFor="waitlist-phone"
                  className="mb-[5px] block text-[11px] font-semibold text-muted-foreground"
                >
                  Telefon
                </label>
                <input
                  id="waitlist-phone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  type="tel"
                  autoComplete="tel"
                  placeholder="+48 600 000 000"
                  className={`${inputClass} min-h-11 font-mono`}
                />
              </div>
              <div>
                <label
                  htmlFor="waitlist-email"
                  className="mb-[5px] block text-[11px] font-semibold text-muted-foreground"
                >
                  E-mail
                </label>
                <input
                  id="waitlist-email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  autoComplete="email"
                  placeholder="anna@example.com"
                  className={`${inputClass} min-h-11`}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {error ? (
        <p className="mt-3 text-[13px] font-semibold text-destructive">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="mt-3.5 min-h-11 w-full rounded-full bg-primary px-4 text-[13px] font-bold text-primary-foreground disabled:opacity-60"
      >
        {submitting ? "Zapisuję…" : "Zapisz mnie na listę"}
      </button>
    </div>
  );
}
