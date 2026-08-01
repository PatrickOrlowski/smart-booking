"use client";

import Link from "next/link";
import { useState } from "react";
import { Phone } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTimeInZone } from "@/components/marketplace/format";
import { DayStrip } from "./day-strip";
import { PartySizePills } from "./party-size-pills";
import { useTableAvailability } from "./use-availability";
import {
  isoDayLabel,
  nextLocalDays,
  partySizeLabel,
  turnTimeLabel,
} from "./format";
import { turnTimeFor, type AvailabilityResponse, type RestaurantBookingData } from "./types";

/**
 * Sekcja „Rezerwacja stolika" na profilu restauracji — odpowiednik cennika
 * usług w salonie: liczba osób, dzień i podgląd najbliższych godzin.
 *
 * Pierwszy render jest bezkosztowy: dzień „dziś" dla dwóch osób policzył już
 * server component (`initial`), więc dopóki gość nic nie zmieni, komponent
 * nie odpytuje API. Kliknięcie godziny prowadzi wprost do kroku „dane"
 * w /b/[slug]/stolik — stan jedzie w searchParams, więc back button działa.
 */

const PREVIEW_LIMIT = 8;

export function ReservationWidget({
  data,
  initial,
}: {
  data: RestaurantBookingData;
  initial: { date: string; partySize: number; data: AvailabilityResponse };
}) {
  const days = nextLocalDays(data.timezone, 14, new Date(data.nowIso));
  const [partySize, setPartySize] = useState(initial.partySize);
  const [date, setDate] = useState(initial.date);

  const availability = useTableAvailability({
    slug: data.slug,
    date,
    partySize,
    initial: { ...initial, area: null },
  });

  const durationMin = turnTimeFor(
    data.turnTimeRules,
    partySize,
    data.defaultTurnTimeMin,
  );
  const flowHref = (extra?: Record<string, string>) => {
    const params = new URLSearchParams({
      osoby: String(partySize),
      data: date,
      ...extra,
    });
    return `/b/${data.slug}/stolik?${params}`;
  };

  const outcome = availability.outcome;
  const slots = outcome?.kind === "ready" ? outcome.data.slots : [];

  return (
    <section className="mt-5">
      <div className="rounded-2xl border-[1.5px] border-border-strong bg-card p-4 md:p-5">
        <div className="meta-label">Rezerwacja stolika</div>
        <h2 className="mt-1 mb-3.5 font-display text-[21px] leading-tight font-extrabold tracking-tight">
          Ile Was będzie?
        </h2>

        <PartySizePills
          value={partySize}
          onChange={setPartySize}
          max={Math.max(12, data.maxPartySizeSeatable)}
        />

        <div className="mt-4 mb-2 flex items-baseline justify-between gap-3">
          <div className="meta-label">Dzień</div>
          <div className="font-mono text-[11px] text-[#8f8b81]">
            {isoDayLabel(date)}
          </div>
        </div>
        <DayStrip
          days={days}
          selected={date}
          onSelect={setDate}
          className="-mx-4 px-4 md:-mx-5 md:px-5"
        />

        <div className="mt-4">
          {availability.loading ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={index} className="h-11 rounded-[10px]" />
              ))}
            </div>
          ) : outcome?.kind === "tooLarge" ? (
            <LargePartyCard
              message={outcome.info.message}
              phone={outcome.info.phone ?? data.phone}
            />
          ) : outcome?.kind === "error" ? (
            <div className="rounded-xl border border-border bg-muted/60 p-3.5 text-center">
              <p className="mb-2.5 text-[13px] text-muted-foreground">
                {outcome.message}
              </p>
              <button
                type="button"
                onClick={availability.reload}
                className="min-h-11 rounded-full border-[1.5px] border-border-strong bg-card px-4 text-[13px] font-semibold"
              >
                Spróbuj ponownie
              </button>
            </div>
          ) : slots.length === 0 ? (
            <div className="rounded-xl border border-border bg-muted/60 p-3.5">
              <div className="text-[13px] font-bold">
                Brak wolnych stolików tego dnia
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                {data.waitlistEnabled
                  ? "Sprawdź inny dzień albo zapisz się na listę oczekujących — damy znać, gdy stolik się zwolni."
                  : "Sprawdź inny dzień na pasku powyżej."}
              </p>
              <Link
                href={flowHref()}
                className="mt-3 inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-[13px] font-bold text-primary-foreground"
              >
                {data.waitlistEnabled ? "Zapisz się na listę" : "Szukaj terminu"}
              </Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slots.slice(0, PREVIEW_LIMIT).map((slot) => (
                  <Link
                    key={slot.startAt}
                    href={flowHref({ godzina: slot.startAt, krok: "dane" })}
                    className="flex min-h-11 items-center justify-center rounded-[10px] border-[1.5px] border-border-strong bg-card font-mono text-[13px] font-medium"
                  >
                    {formatTimeInZone(new Date(slot.startAt), data.timezone)}
                  </Link>
                ))}
              </div>
              {slots.length > PREVIEW_LIMIT ? (
                <div className="mt-2 font-mono text-[11px] text-[#8f8b81]">
                  + {slots.length - PREVIEW_LIMIT} kolejnych godzin
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-muted pt-3.5">
          <div className="font-mono text-[11px] text-muted-foreground">
            Stolik na {turnTimeLabel(durationMin)} ·{" "}
            {partySizeLabel(partySize)}
          </div>
          <Link
            href={flowHref()}
            className="flex min-h-11 items-center rounded-full bg-primary px-4 text-[13px] font-bold text-primary-foreground"
          >
            Rezerwuj stolik
          </Link>
        </div>
      </div>
    </section>
  );
}

/** Grupa ponad limit rezerwacji online — jedyną drogą jest telefon. */
export function LargePartyCard({
  message,
  phone,
  className,
}: {
  message: string;
  phone: string | null;
  className?: string;
}) {
  return (
    <div
      className={
        className ??
        "rounded-xl border-[1.5px] border-border-strong bg-warning-soft p-4"
      }
    >
      <div className="meta-label text-warning-strong">Duża grupa</div>
      <div className="mt-1 mb-1.5 font-display text-[19px] leading-tight font-extrabold tracking-tight">
        Taką grupę ustalamy telefonicznie
      </div>
      <p className="text-[12.5px] leading-relaxed text-foreground/80">
        {message}
      </p>
      {phone ? (
        <a
          href={`tel:${phone.replace(/\s/g, "")}`}
          className="mt-3.5 flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-4 text-[13px] font-bold text-primary-foreground"
        >
          <Phone aria-hidden className="size-4" />
          Zadzwoń {phone}
        </a>
      ) : null}
    </div>
  );
}
