"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, Check, Users } from "lucide-react";
import { RestaurantArea } from "@/generated/prisma/enums";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatDayFull,
  formatDayShort,
  formatTimeInZone,
} from "@/components/marketplace/format";
import { AreaIcon } from "@/components/restaurant/area-icon";
import { DayStrip } from "@/components/restaurant/day-strip";
import { PartySizePills } from "@/components/restaurant/party-size-pills";
import { LargePartyCard } from "@/components/restaurant/reservation-widget";
import { WaitlistForm } from "@/components/restaurant/waitlist-form";
import { useTableAvailability } from "@/components/restaurant/use-availability";
import {
  GUEST_AREA_LABELS,
  MEAL_PERIODS,
  capitalizeFirst,
  isClosedOnDay,
  isoDayLabel,
  mealPeriod,
  nextLocalDays,
  partySizeGenitive,
  partySizeLabel,
  turnTimeLabel,
} from "@/components/restaurant/format";
import {
  turnTimeFor,
  type RestaurantBookingData,
  type RestaurantSlot,
  type TableBookingResult,
} from "@/components/restaurant/types";

/**
 * Flow rezerwacji stolika: goście → godzina → dane → potwierdzenie.
 *
 * Cały stan kroków żyje w searchParams (`osoby`, `strefa`, `data`, `godzina`,
 * `krok`), więc back button przeglądarki cofa o krok, a link z profilu może
 * wskoczyć od razu w wybraną godzinę. W pamięci komponentu zostają tylko
 * rzeczy, których nie wolno wystawiać w adresie: dane gościa (przetrwają
 * powrót z konfliktu) i utworzona rezerwacja.
 */

const DEFAULT_PARTY_SIZE = 2;
const DAYS_IN_STRIP = 14;
/** Ile dni sondujemy w poszukiwaniu najbliższego wolnego stolika. */
const PROBE_DAYS = 8;

type GuestDetails = {
  name: string;
  phone: string;
  email: string;
  note: string;
};

const isArea = (value: string | null): value is RestaurantArea =>
  value !== null && value in RestaurantArea;

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

export function TableFlow({ data }: { data: RestaurantBookingData }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const days = useMemo(
    () => nextLocalDays(data.timezone, DAYS_IN_STRIP, new Date(data.nowIso)),
    [data.timezone, data.nowIso],
  );
  const todayIso = days[0].iso;

  const partySizeParam = Number(searchParams.get("osoby"));
  const partySize =
    Number.isInteger(partySizeParam) && partySizeParam >= 1 && partySizeParam <= 40
      ? partySizeParam
      : DEFAULT_PARTY_SIZE;
  const areaParam = searchParams.get("strefa");
  const area = isArea(areaParam) && data.areas.includes(areaParam) ? areaParam : null;
  const dateParam = searchParams.get("data");
  const date =
    dateParam && days.some((day) => day.iso === dateParam)
      ? dateParam
      : todayIso;
  const time = searchParams.get("godzina");
  const krokParam = searchParams.get("krok");

  const [booking, setBooking] = useState<TableBookingResult | null>(null);
  // Dane gościa trzymamy poza adresem — komunikat konfliktu obiecuje, że
  // po powrocie do godzin nie trzeba ich wpisywać drugi raz.
  const [guest, setGuest] = useState<GuestDetails>({
    name: data.user?.name ?? "",
    phone: data.user?.phone ?? "",
    email: data.user?.email ?? "",
    note: "",
  });
  // Powrót z kroku „dane" musi zobaczyć świeżą listę godzin — zmiana klucza
  // przemontowuje krok, więc dostępność liczy się od nowa.
  const [slotsKey, setSlotsKey] = useState(0);

  const tooLarge =
    data.maxPartySizeOnline !== null && partySize > data.maxPartySizeOnline;

  const step: "goscie" | "godzina" | "dane" | "sukces" =
    krokParam === "sukces" && booking
      ? "sukces"
      : krokParam === "dane" && time && !tooLarge
        ? "dane"
        : (krokParam === "godzina" || krokParam === "dane") && !tooLarge
          ? "godzina"
          : "goscie";

  const durationMin = turnTimeFor(
    data.turnTimeRules,
    partySize,
    data.defaultTurnTimeMin,
  );

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

  const backToSlots = () => {
    setSlotsKey((key) => key + 1);
    setParams({ krok: "godzina", godzina: null });
  };

  if (step === "sukces" && booking) {
    return (
      <main className="mx-auto w-full max-w-md px-5 pt-4 pb-16 md:max-w-lg">
        <SuccessScreen booking={booking} slug={data.slug} />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-4 pb-16 md:max-w-lg lg:max-w-4xl">
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-10">
        <div className="min-w-0">
          {step === "goscie" ? (
            <GuestsStep
              data={data}
              days={days}
              date={date}
              partySize={partySize}
              area={area}
              durationMin={durationMin}
              tooLarge={tooLarge}
              onBack={() => router.push(`/b/${data.slug}`)}
              onChange={(patch) => setParams(patch, "replace")}
              onNext={() => setParams({ krok: "godzina" })}
            />
          ) : null}

          {step === "godzina" ? (
            <TimeStep
              key={slotsKey}
              data={data}
              days={days}
              date={date}
              partySize={partySize}
              area={area}
              durationMin={durationMin}
              onBack={() => router.back()}
              onPickDay={(iso) => setParams({ data: iso }, "replace")}
              onPickSlot={(slot) =>
                setParams({ krok: "dane", godzina: slot.startAt })
              }
            />
          ) : null}

          {step === "dane" && time ? (
            <DetailsStep
              data={data}
              startAtIso={time}
              partySize={partySize}
              area={area}
              durationMin={durationMin}
              guest={guest}
              onGuestChange={(patch) =>
                setGuest((current) => ({ ...current, ...patch }))
              }
              onBack={() => router.back()}
              onConflictRetry={backToSlots}
              onSuccess={(result) => {
                setBooking(result);
                setParams({ krok: "sukces", godzina: null });
              }}
            />
          ) : null}
        </div>

        <FlowSummary
          data={data}
          partySize={partySize}
          area={area}
          date={date}
          startAtIso={time}
          durationMin={durationMin}
        />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sticky podsumowanie (lg+)
// ---------------------------------------------------------------------------

function FlowSummary({
  data,
  partySize,
  area,
  date,
  startAtIso,
  durationMin,
}: {
  data: RestaurantBookingData;
  partySize: number;
  area: RestaurantArea | null;
  date: string;
  startAtIso: string | null;
  durationMin: number;
}) {
  return (
    <aside className="hidden lg:sticky lg:top-8 lg:block">
      <div className="rounded-2xl border-[1.5px] border-border-strong bg-card p-5">
        <div className="meta-label">Podsumowanie</div>
        <div className="mt-1 font-display text-lg font-bold tracking-tight">
          {data.name}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {data.address}
        </div>

        <div className="my-4 h-px bg-border" />

        <dl className="flex flex-col gap-2.5 text-[13px]">
          <div className="flex justify-between gap-3">
            <dt className="flex-none text-muted-foreground">Goście</dt>
            <dd className="text-right font-semibold">
              {partySizeLabel(partySize)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="flex-none text-muted-foreground">Strefa</dt>
            <dd className="text-right font-semibold">
              {area ? GUEST_AREA_LABELS[area] : "Bez preferencji"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="flex-none text-muted-foreground">Termin</dt>
            <dd className="text-right font-mono font-medium">
              {startAtIso ? (
                `${formatDayShort(new Date(startAtIso), data.timezone)}, ${formatTimeInZone(new Date(startAtIso), data.timezone)}`
              ) : (
                <span className="text-[#8f8b81]">{isoDayLabel(date)}</span>
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="flex-none text-muted-foreground">Stolik na</dt>
            <dd className="text-right font-mono">
              {turnTimeLabel(durationMin)}
            </dd>
          </div>
        </dl>

        <div className="my-4 h-px bg-border" />

        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          Rezerwacja stolika jest bezpłatna. Odwołasz ją bezpłatnie do{" "}
          <b>{data.cancellationCutoffHours} h</b> przed wizytą.
        </p>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Krok 1 — goście, strefa, dzień
// ---------------------------------------------------------------------------

function GuestsStep({
  data,
  days,
  date,
  partySize,
  area,
  durationMin,
  tooLarge,
  onBack,
  onChange,
  onNext,
}: {
  data: RestaurantBookingData;
  days: { iso: string; weekday: string; dayNumber: number; isToday: boolean }[];
  date: string;
  partySize: number;
  area: RestaurantArea | null;
  durationMin: number;
  tooLarge: boolean;
  onBack: () => void;
  onChange: (patch: Record<string, string | null>) => void;
  onNext: () => void;
}) {
  const chip = (active: boolean) =>
    `flex min-h-11 flex-none items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold ${
      active
        ? "bg-primary text-primary-foreground"
        : "border border-border bg-card text-foreground/80"
    }`;

  return (
    <div>
      <BackCircle onClick={onBack} />
      <div className="meta-label">Krok 1 / 3 · Goście</div>
      <h1 className="mt-1.5 mb-1 font-display text-[29px] leading-[1.05] font-extrabold tracking-tight">
        Ile Was będzie?
      </h1>
      <p className="mb-4 text-[13px] text-muted-foreground">
        {data.name} · stolik na {turnTimeLabel(durationMin)}
      </p>

      <PartySizePills
        value={partySize}
        onChange={(value) => onChange({ osoby: String(value) })}
        max={Math.max(12, data.maxPartySizeSeatable)}
      />

      {tooLarge ? (
        <LargePartyCard
          className="mt-4 rounded-2xl border-[1.5px] border-border-strong bg-warning-soft p-4"
          message={`Dla grup powyżej ${data.maxPartySizeOnline} osób zadzwoń do lokalu${data.phone ? `: ${data.phone}` : ""}.`}
          phone={data.phone}
        />
      ) : null}

      {data.areas.length > 1 ? (
        <>
          <div className="meta-label mt-6 mb-2">Preferowana strefa</div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
            <button
              type="button"
              aria-pressed={area === null}
              onClick={() => onChange({ strefa: null })}
              className={chip(area === null)}
            >
              Bez preferencji
            </button>
            {data.areas.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={area === value}
                onClick={() => onChange({ strefa: value })}
                className={chip(area === value)}
              >
                <AreaIcon area={value} className="size-3.5" />
                {GUEST_AREA_LABELS[value]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-[#8f8b81]">
            Bez preferencji dostajesz najwięcej godzin — stolik dobieramy sami.
          </p>
        </>
      ) : null}

      <div className="meta-label mt-6 mb-2">Dzień</div>
      <DayStrip
        days={days}
        selected={date}
        onSelect={(iso) => onChange({ data: iso })}
      />

      <button
        type="button"
        onClick={onNext}
        disabled={tooLarge}
        className="mt-5 min-h-11 w-full rounded-[14px] bg-primary p-4 text-[15px] font-bold text-primary-foreground disabled:opacity-60"
      >
        Pokaż wolne godziny
      </button>
      <p className="mt-2 text-center text-[11px] text-[#8f8b81]">
        {isoDayLabel(date)} · {partySizeLabel(partySize)} ·{" "}
        {area ? GUEST_AREA_LABELS[area] : "bez preferencji strefy"}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Krok 2 — godzina
// ---------------------------------------------------------------------------

function TimeStep({
  data,
  days,
  date,
  partySize,
  area,
  durationMin,
  onBack,
  onPickDay,
  onPickSlot,
}: {
  data: RestaurantBookingData;
  days: { iso: string; weekday: string; dayNumber: number; isToday: boolean }[];
  date: string;
  partySize: number;
  area: RestaurantArea | null;
  durationMin: number;
  onBack: () => void;
  onPickDay: (iso: string) => void;
  onPickSlot: (slot: RestaurantSlot) => void;
}) {
  const availability = useTableAvailability({
    slug: data.slug,
    date,
    partySize,
    area,
  });
  const outcome = availability.outcome;
  const slots = outcome?.kind === "ready" ? outcome.data.slots : [];
  const isEmpty =
    !availability.loading && outcome?.kind === "ready" && slots.length === 0;

  // Sonda po kolejnych dniach odpala się dopiero, gdy wybrany dzień jest
  // pusty — normalna ścieżka to jedno zapytanie o jeden dzień.
  const probe = useTableAvailability({
    slug: data.slug,
    date: isEmpty ? date : null,
    partySize,
    area,
    days: PROBE_DAYS,
  });
  const nearestDay =
    probe.outcome?.kind === "ready"
      ? (probe.outcome.data.days ?? []).find(
          (day) => day.date !== date && day.slots.length > 0,
        )
      : undefined;

  const closedDay = isClosedOnDay(data.openingHours, date);

  const groups = MEAL_PERIODS.map((label) => ({
    label,
    slots: slots.filter(
      (slot) => mealPeriod(new Date(slot.startAt), data.timezone) === label,
    ),
  })).filter((group) => group.slots.length > 0);

  return (
    <div>
      <BackCircle onClick={onBack} />
      <div className="meta-label">Krok 2 / 3 · Godzina</div>
      <h1 className="mt-1.5 mb-1 font-display text-[29px] leading-[1.05] font-extrabold tracking-tight">
        O której siadacie?
      </h1>
      <p className="mb-1 text-[13px] text-muted-foreground">
        {partySizeLabel(partySize)} ·{" "}
        {area ? GUEST_AREA_LABELS[area] : "bez preferencji strefy"}
      </p>

      <DayStrip
        days={days}
        selected={date}
        onSelect={onPickDay}
        className="pt-4"
      />

      <div className="mt-3.5 mb-2.5 flex items-center justify-between gap-3">
        <div className="meta-label">{isoDayLabel(date)}</div>
        <div className="font-mono text-[10px] text-[#8f8b81]">
          stolik na {turnTimeLabel(durationMin)}
        </div>
      </div>

      {availability.loading ? (
        <div className="grid grid-cols-3 gap-2 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 12 }, (_, index) => (
            <Skeleton key={index} className="h-11 rounded-[10px]" />
          ))}
        </div>
      ) : outcome?.kind === "tooLarge" ? (
        <LargePartyCard
          className="rounded-2xl border-[1.5px] border-border-strong bg-warning-soft p-4"
          message={outcome.info.message}
          phone={outcome.info.phone ?? data.phone}
        />
      ) : outcome?.kind === "error" ? (
        <div className="rounded-2xl border border-border bg-card p-4 text-center">
          <p className="mb-3 text-[13px] text-muted-foreground">
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
      ) : isEmpty ? (
        <div className="flex flex-col gap-3.5">
          <div>
            <h2 className="mb-1.5 font-display text-xl leading-tight font-extrabold tracking-tight">
              {closedDay ? "Tego dnia zamknięte" : "Brak wolnych stolików"}
            </h2>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              {closedDay
                ? `${capitalizeFirst(isoDayLabel(date))} — lokal nieczynny. Wybierz inny dzień.`
                : `${capitalizeFirst(isoDayLabel(date))} — nie mamy już stolika dla ${partySizeGenitive(partySize)}${
                    area
                      ? ` w strefie ${GUEST_AREA_LABELS[area].toLowerCase()}`
                      : ""
                  }.`}
            </p>
          </div>

          {probe.loading ? (
            <Skeleton className="h-[62px] rounded-xl" />
          ) : nearestDay ? (
            <button
              type="button"
              onClick={() => onPickDay(nearestDay.date)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border-[1.5px] border-border-strong bg-[#f7f4ef] px-3.5 py-3 text-left dark:bg-secondary"
            >
              <div className="min-w-0">
                <div className="text-[12.5px] font-bold">
                  Najbliżej wolne: {isoDayLabel(nearestDay.date)}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {nearestDay.slots
                    .slice(0, 3)
                    .map((slot) =>
                      formatTimeInZone(new Date(slot.startAt), data.timezone),
                    )
                    .join(" · ")}
                </div>
              </div>
              <span className="flex-none text-sm">›</span>
            </button>
          ) : (
            <p className="rounded-xl border border-border bg-muted/60 p-3.5 text-[12.5px] text-muted-foreground">
              W najbliższych dniach też nie widzimy wolnego stolika dla tej
              grupy. Spróbuj innej liczby osób albo zadzwoń do lokalu.
            </p>
          )}

          {/* W dniu zamkniętym lista oczekujących nie ma sensu — nie ma na
              jaką godzinę czekać; gość dostaje podpowiedź najbliższego dnia. */}
          {data.waitlistEnabled && !closedDay ? (
            <WaitlistForm data={data} date={date} partySize={partySize} />
          ) : null}
        </div>
      ) : (
        <>
          {groups.map((group) => (
            <div key={group.label}>
              <div className="mt-3.5 mb-2 text-xs font-bold">{group.label}</div>
              <div className="grid grid-cols-3 gap-2 md:grid-cols-4 lg:grid-cols-5">
                {group.slots.map((slot) => (
                  <button
                    key={slot.startAt}
                    type="button"
                    onClick={() => onPickSlot(slot)}
                    className="min-h-11 rounded-[10px] border-[1.5px] border-border-strong bg-card py-[11px] font-mono text-[13px] font-medium"
                  >
                    {formatTimeInZone(new Date(slot.startAt), data.timezone)}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="mt-4 rounded-xl border border-border bg-muted/60 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
            Stolik na <b>{turnTimeLabel(durationMin)}</b> — tyle trzymamy go dla{" "}
            {partySizeGenitive(partySize)}. Godziny w strefie lokalu (
            {data.timezone}).
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Krok 3 — dane gościa
// ---------------------------------------------------------------------------

function DetailsStep({
  data,
  startAtIso,
  partySize,
  area,
  durationMin,
  guest,
  onGuestChange,
  onBack,
  onConflictRetry,
  onSuccess,
}: {
  data: RestaurantBookingData;
  startAtIso: string;
  partySize: number;
  area: RestaurantArea | null;
  durationMin: number;
  guest: GuestDetails;
  onGuestChange: (patch: Partial<GuestDetails>) => void;
  onBack: () => void;
  onConflictRetry: () => void;
  onSuccess: (booking: TableBookingResult) => void;
}) {
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  const startAt = new Date(startAtIso);
  const isGuest = !data.user;
  const inputClass =
    "w-full rounded-[11px] border border-border bg-card px-[13px] py-3 text-sm outline-none focus:border-[1.5px] focus:border-border-strong";

  const submit = async () => {
    setError(null);
    setConflict(null);
    if (!accepted) {
      setError("Potwierdź zasady odwołania rezerwacji.");
      return;
    }
    if (isGuest) {
      if (guest.name.trim().length < 2) {
        setError("Podaj imię i nazwisko.");
        return;
      }
      if (!/^\S+@\S+\.\S+$/.test(guest.email.trim())) {
        setError("Podaj poprawny adres e-mail.");
        return;
      }
      if (guest.phone.trim().length < 7) {
        setError("Podaj poprawny numer telefonu — lokal dzwoni w razie zmian.");
        return;
      }
    }
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/v1/restaurants/${data.slug}/bookings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startAt: startAtIso,
            partySize,
            ...(area ? { area } : {}),
            ...(isGuest
              ? {
                  guest: {
                    name: guest.name.trim(),
                    email: guest.email.trim(),
                    phone: guest.phone.trim(),
                  },
                }
              : {}),
            ...(guest.note.trim() ? { note: guest.note.trim() } : {}),
          }),
        },
      );
      const json = (await response.json().catch(() => null)) as {
        booking?: TableBookingResult;
        message?: string;
      } | null;

      if (response.status === 201 && json?.booking) {
        onSuccess(json.booking);
        return;
      }
      if (response.status === 409) {
        setConflict(
          json?.message ??
            "Ten stolik został właśnie zajęty przez kogoś innego.",
        );
        return;
      }
      setError(
        json?.message ?? "Nie udało się zarezerwować stolika. Spróbuj ponownie.",
      );
    } catch {
      setError("Błąd połączenia. Sprawdź internet i spróbuj ponownie.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <BackCircle onClick={onBack} />
      <div className="meta-label">Krok 3 / 3 · Dane</div>
      <h1 className="mt-1.5 mb-[18px] font-display text-[29px] leading-[1.05] font-extrabold tracking-tight">
        Prawie przy stole.
      </h1>

      {conflict ? (
        <div className="mb-4 rounded-2xl border-[1.5px] border-border-strong bg-card p-4">
          <div className="mb-3 flex size-9 items-center justify-center rounded-full border border-[#d9a9a1] bg-[#f4e3e0] text-[17px] text-destructive">
            !
          </div>
          <div className="mb-1.5 font-display text-[21px] leading-tight font-extrabold tracking-tight">
            Ten stolik właśnie zniknął
          </div>
          <p className="mb-3.5 text-[12.5px] leading-relaxed text-foreground/80">
            {conflict} Twoje dane zostają — wybierz inną godzinę, reszta jest
            już wypełniona.
          </p>
          <button
            type="button"
            onClick={onConflictRetry}
            className="min-h-11 w-full rounded-[10px] bg-primary p-3 text-[13px] font-bold text-primary-foreground"
          >
            Pokaż wolne godziny
          </button>
        </div>
      ) : null}

      <div className="mb-5 rounded-2xl border border-[#e2ddd2] bg-[#f7f4ef] p-[15px] dark:border-border dark:bg-secondary">
        <div className="flex justify-between gap-3 text-sm font-semibold">
          <span>{data.name}</span>
          <span className="font-mono">bezpłatnie</span>
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
          <span>Goście</span>
          <span className="font-semibold text-foreground">
            {partySizeLabel(partySize)}
          </span>
        </div>
        <div className="mt-1.5 flex justify-between text-[13px] text-foreground/80">
          <span>Strefa</span>
          <span className="font-semibold text-foreground">
            {area ? GUEST_AREA_LABELS[area] : "Bez preferencji"}
          </span>
        </div>
        <div className="mt-1.5 flex justify-between text-[13px] text-foreground/80">
          <span>Stolik na</span>
          <span className="font-mono text-foreground">
            {turnTimeLabel(durationMin)}
          </span>
        </div>
      </div>

      {isGuest ? (
        <div className="flex flex-col gap-[11px]">
          <div>
            <label
              htmlFor="table-name"
              className="mb-[5px] block text-[11px] font-semibold text-muted-foreground"
            >
              Imię i nazwisko
            </label>
            <input
              id="table-name"
              value={guest.name}
              onChange={(event) => onGuestChange({ name: event.target.value })}
              autoComplete="name"
              className={`${inputClass} min-h-11 border-[1.5px] border-border-strong`}
            />
          </div>
          <div>
            <label
              htmlFor="table-phone"
              className="mb-[5px] block text-[11px] font-semibold text-muted-foreground"
            >
              Telefon{" "}
              <span className="font-normal text-[#8f8b81]">
                · lokal dzwoni w razie zmian
              </span>
            </label>
            <input
              id="table-phone"
              value={guest.phone}
              onChange={(event) => onGuestChange({ phone: event.target.value })}
              type="tel"
              autoComplete="tel"
              placeholder="+48 600 000 000"
              className={`${inputClass} min-h-11 font-mono`}
            />
          </div>
          <div>
            <label
              htmlFor="table-email"
              className="mb-[5px] block text-[11px] font-semibold text-muted-foreground"
            >
              E-mail
            </label>
            <input
              id="table-email"
              value={guest.email}
              onChange={(event) => onGuestChange({ email: event.target.value })}
              type="email"
              autoComplete="email"
              placeholder="anna@example.com"
              className={`${inputClass} min-h-11`}
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

      <div className="mt-[11px]">
        <label
          htmlFor="table-note"
          className="mb-[5px] block text-[11px] font-semibold text-muted-foreground"
        >
          Uwagi{" "}
          <span className="font-normal text-[#8f8b81]">
            · np. stolik przy oknie, urodziny, wózek
          </span>
        </label>
        <textarea
          id="table-note"
          value={guest.note}
          onChange={(event) => onGuestChange({ note: event.target.value })}
          rows={3}
          maxLength={500}
          placeholder="Poprosimy stolik przy oknie."
          className={`${inputClass} resize-none`}
        />
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-[14px] border border-[#e2ddd2] bg-card p-[13px] dark:border-border">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          className="mt-0.5 size-[18px] flex-none accent-[#143d31]"
        />
        <span className="text-[11.5px] leading-relaxed text-foreground/80">
          <b className="text-xs">Zasady odwołania</b>
          <br />
          Rezerwację odwołasz bezpłatnie do{" "}
          <b>{data.cancellationCutoffHours} h</b> przed godziną rezerwacji.
          Później stolik przepada. Przy spóźnieniu powyżej 15 minut lokal może
          zwolnić stolik.
        </span>
      </label>

      {error ? (
        <p className="mt-3 text-[13px] font-semibold text-destructive">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={submitting || Boolean(conflict)}
        className="mt-[18px] min-h-11 w-full rounded-[14px] bg-primary p-4 text-[15px] font-bold text-primary-foreground disabled:opacity-60"
      >
        {submitting
          ? "Rezerwuję…"
          : `Rezerwuję stolik · ${formatTimeInZone(startAt, data.timezone)}`}
      </button>
      <p className="mt-2 text-center text-[11px] text-[#8f8b81]">
        Rezerwacja stolika jest bezpłatna. Płacisz tylko za to, co zamówisz.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Potwierdzenie
// ---------------------------------------------------------------------------

function SuccessScreen({
  booking,
  slug,
}: {
  booking: TableBookingResult;
  slug: string;
}) {
  const startAt = new Date(booking.startAt);
  const deadline = new Date(booking.cancellationDeadline);

  return (
    <div className="pt-7">
      <div className="mb-5 flex size-[58px] items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check aria-hidden className="size-7" />
      </div>
      <h1 className="mb-2 font-display text-[32px] leading-none font-extrabold tracking-tight">
        Stolik zarezerwowany.
      </h1>
      <p className="mb-[22px] text-sm leading-relaxed text-foreground/80">
        Potwierdzenie poszło e-mailem. Pokaż obsłudze numer rezerwacji albo
        podaj nazwisko przy wejściu.
      </p>

      <div className="overflow-hidden rounded-2xl border-[1.5px] border-border-strong bg-card">
        <div className="border-b border-dashed border-[#d8d2c4] p-4 dark:border-border">
          <div className="meta-label">
            {formatDayFull(startAt, booking.timezone)}
          </div>
          <div className="my-1 font-display text-[38px] leading-none font-extrabold tracking-tight">
            {formatTimeInZone(startAt, booking.timezone)}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold">
            <span className="flex items-center gap-1.5">
              <Users aria-hidden className="size-4" />
              {partySizeLabel(booking.partySize)}
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[13px] font-medium text-muted-foreground">
              <CalendarClock aria-hidden className="size-4" />
              stolik na {turnTimeLabel(booking.durationMin)}
            </span>
          </div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            {booking.restaurantName}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3.5">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">
              {booking.address}
            </div>
            <div className="mt-[3px] font-mono text-[11px] text-[#8f8b81]">
              Numer rezerwacji
            </div>
          </div>
          <div className="flex-none font-mono text-base font-medium">
            #{booking.id.slice(-8).toUpperCase()}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-accent p-4">
        <div className="meta-label">Odwołanie</div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-foreground/80">
          Rezerwację odwołasz bezpłatnie do{" "}
          <b>
            {formatDayShort(deadline, booking.timezone)},{" "}
            {formatTimeInZone(deadline, booking.timezone)}
          </b>{" "}
          (na {booking.cancellationCutoffHours} h przed). Później stolik
          przepada.
        </p>
      </div>

      <Link
        href="/konto"
        className="mt-4 flex min-h-11 w-full items-center justify-center rounded-xl border-[1.5px] border-border-strong bg-card text-[13px] font-semibold"
      >
        Moje rezerwacje
      </Link>
      <Link
        href={`/b/${slug}`}
        className="mt-2 flex min-h-11 w-full items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground"
      >
        Wróć do profilu {booking.restaurantName}
      </Link>
    </div>
  );
}
