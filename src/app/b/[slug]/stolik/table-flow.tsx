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
  capitalizeFirst,
  guestAreaLabel,
  isClosedOnDay,
  isoDayLabel,
  mealPeriod,
  mealPeriodLabel,
  MEAL_PERIODS,
  nextLocalDays,
  partySizeGenitive,
  partySizeLabel,
  partyTooLargeMessage,
  partyTooSmallMessage,
  turnTimeLabel,
} from "@/components/restaurant/format";
import {
  turnTimeFor,
  type RestaurantBookingData,
  type RestaurantSlot,
  type TableBookingResult,
} from "@/components/restaurant/types";
import { useTranslations } from "@/i18n/client";

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
/** Górna granica paska dni; faktyczną długość ogranicza `maxAdvanceDays`. */
const DAYS_IN_STRIP_MAX = 14;
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

export function TableFlow({ data }: { data: RestaurantBookingData }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale } = useTranslations();

  // Pasek dni nie może wychodzić poza horyzont rezerwacji lokalu: silnik
  // odrzuca każdy dzień powyżej `maxAdvanceDays`, więc dni 8–14 przy horyzoncie
  // 7 pokazywały „Brak wolnych stolików" i formularz listy oczekujących.
  const daysInStrip = Math.max(
    1,
    Math.min(DAYS_IN_STRIP_MAX, data.maxAdvanceDays + 1),
  );
  const days = useMemo(
    () =>
      nextLocalDays(data.timezone, daysInStrip, new Date(data.nowIso), locale),
    [data.timezone, data.nowIso, daysInStrip, locale],
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
  // `godzina` idzie prosto do new Date() i Intl.DateTimeFormat — bez walidacji
  // „?godzina=abc" dawało Invalid Date i RangeError w renderze (biały ekran).
  // Nieparsowalna wartość degraduje flow do kroku wyboru godziny.
  const timeParam = searchParams.get("godzina");
  const time =
    timeParam && Number.isFinite(Date.parse(timeParam)) ? timeParam : null;
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
  // Dolna granica: żaden stolik nie ma tak niskiego `capacityMin`.
  const tooSmall = partySize < data.minPartySizeSeatable;
  const outOfRange = tooLarge || tooSmall;

  const step: "goscie" | "godzina" | "dane" | "sukces" =
    krokParam === "sukces" && booking
      ? "sukces"
      : krokParam === "dane" && time && !outOfRange
        ? "dane"
        : (krokParam === "godzina" || krokParam === "dane") && !outOfRange
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
              tooSmall={tooSmall}
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
  const { locale, t } = useTranslations();
  return (
    <aside className="hidden lg:sticky lg:top-8 lg:block">
      <div className="rounded-2xl border-[1.5px] border-border-strong bg-card p-5">
        <div className="meta-label">{t("bf.summary")}</div>
        <div className="mt-1 font-display text-lg font-bold tracking-tight">
          {data.name}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {data.address}
        </div>

        <div className="my-4 h-px bg-border" />

        <dl className="flex flex-col gap-2.5 text-[13px]">
          <div className="flex justify-between gap-3">
            <dt className="flex-none text-muted-foreground">{t("tf.guests")}</dt>
            <dd className="text-right font-semibold">
              {partySizeLabel(partySize, locale)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="flex-none text-muted-foreground">{t("tf.zone")}</dt>
            <dd className="text-right font-semibold">
              {area ? guestAreaLabel(area, locale) : t("tf.noPreference")}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="flex-none text-muted-foreground">{t("bf.term")}</dt>
            <dd className="text-right font-mono font-medium">
              {startAtIso ? (
                `${formatDayShort(new Date(startAtIso), data.timezone, locale)}, ${formatTimeInZone(new Date(startAtIso), data.timezone)}`
              ) : (
                <span className="text-[#8f8b81]">
                  {isoDayLabel(date, locale)}
                </span>
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="flex-none text-muted-foreground">
              {t("tf.tableOn")}
            </dt>
            <dd className="text-right font-mono">
              {turnTimeLabel(durationMin)}
            </dd>
          </div>
        </dl>

        <div className="my-4 h-px bg-border" />

        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          {t("tf.summaryNote", { hours: data.cancellationCutoffHours })}
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
  tooSmall,
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
  tooSmall: boolean;
  onBack: () => void;
  onChange: (patch: Record<string, string | null>) => void;
  onNext: () => void;
}) {
  const { locale, t } = useTranslations();
  const chip = (active: boolean) =>
    `flex min-h-11 flex-none items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold ${
      active
        ? "bg-primary text-primary-foreground"
        : "border border-border bg-card text-foreground/80"
    }`;

  return (
    <div>
      <BackCircle onClick={onBack} />
      <div className="meta-label">{t("tf.step1")}</div>
      <h1 className="mt-1.5 mb-1 font-display text-[29px] leading-[1.05] font-extrabold tracking-tight">
        {t("rw.howMany")}
      </h1>
      <p className="mb-4 text-[13px] text-muted-foreground">
        {data.name} · {t("tf.tableFor", { turn: turnTimeLabel(durationMin) })}
      </p>

      <PartySizePills
        value={partySize}
        onChange={(value) => onChange({ osoby: String(value) })}
        min={data.minPartySizeSeatable}
        max={Math.max(12, data.maxPartySizeSeatable)}
      />

      {tooLarge ? (
        <LargePartyCard
          className="mt-4 rounded-2xl border-[1.5px] border-border-strong bg-warning-soft p-4"
          message={partyTooLargeMessage(
            data.maxPartySizeOnline ?? partySize,
            data.phone,
            locale,
          )}
          phone={data.phone}
        />
      ) : null}

      {tooSmall ? (
        <LargePartyCard
          className="mt-4 rounded-2xl border-[1.5px] border-border-strong bg-warning-soft p-4"
          label={t("lp.smallLabel")}
          title={t("lp.smallTitle")}
          message={partyTooSmallMessage(
            data.minPartySizeSeatable,
            data.phone,
            locale,
          )}
          phone={data.phone}
        />
      ) : null}

      {data.areas.length > 1 ? (
        <>
          <div className="meta-label mt-6 mb-2">{t("tf.preferredZone")}</div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
            <button
              type="button"
              aria-pressed={area === null}
              onClick={() => onChange({ strefa: null })}
              className={chip(area === null)}
            >
              {t("tf.noPreference")}
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
                {guestAreaLabel(value, locale)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-[#8f8b81]">
            {t("tf.noPrefHint")}
          </p>
        </>
      ) : null}

      <div className="meta-label mt-6 mb-2">{t("tf.day")}</div>
      <DayStrip
        days={days}
        selected={date}
        onSelect={(iso) => onChange({ data: iso })}
      />

      <button
        type="button"
        onClick={onNext}
        disabled={tooLarge || tooSmall}
        className="mt-5 min-h-11 w-full rounded-[14px] bg-primary p-4 text-[15px] font-bold text-primary-foreground disabled:opacity-60"
      >
        {t("tf.showHours")}
      </button>
      <p className="mt-2 text-center text-[11px] text-[#8f8b81]">
        {isoDayLabel(date, locale)} · {partySizeLabel(partySize, locale)} ·{" "}
        {area ? guestAreaLabel(area, locale) : t("tf.noPreferenceZone")}
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
  const { locale, t } = useTranslations();
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
  // pusty — normalna ścieżka to jedno zapytanie o jeden dzień. Nie wychodzi
  // poza pasek dni, czyli poza horyzont rezerwacji lokalu.
  const dayIsoSet = new Set(days.map((day) => day.iso));
  const probeDays = Math.max(1, Math.min(PROBE_DAYS, days.length));
  const probe = useTableAvailability({
    slug: data.slug,
    date: isEmpty ? date : null,
    partySize,
    area,
    days: probeDays,
  });
  const nearestDay =
    probe.outcome?.kind === "ready"
      ? (probe.outcome.data.days ?? []).find(
          (day) =>
            day.date !== date &&
            day.slots.length > 0 &&
            dayIsoSet.has(day.date),
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
      <div className="meta-label">{t("tf.step2")}</div>
      <h1 className="mt-1.5 mb-1 font-display text-[29px] leading-[1.05] font-extrabold tracking-tight">
        {t("tf.whenSit")}
      </h1>
      <p className="mb-1 text-[13px] text-muted-foreground">
        {partySizeLabel(partySize, locale)} ·{" "}
        {area ? guestAreaLabel(area, locale) : t("tf.noPreferenceZone")}
      </p>

      <DayStrip
        days={days}
        selected={date}
        onSelect={onPickDay}
        className="pt-4"
      />

      <div className="mt-3.5 mb-2.5 flex items-center justify-between gap-3">
        <div className="meta-label">{isoDayLabel(date, locale)}</div>
        <div className="font-mono text-[10px] text-[#8f8b81]">
          {t("tf.tableFor", { turn: turnTimeLabel(durationMin) })}
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
          message={partyTooLargeMessage(
            outcome.info.maxPartySizeOnline,
            outcome.info.phone ?? data.phone,
            locale,
          )}
          phone={outcome.info.phone ?? data.phone}
        />
      ) : outcome?.kind === "tooSmall" ? (
        <LargePartyCard
          className="rounded-2xl border-[1.5px] border-border-strong bg-warning-soft p-4"
          label={t("lp.smallLabel")}
          title={t("lp.smallTitle")}
          message={partyTooSmallMessage(
            outcome.info.minPartySizeSeatable,
            outcome.info.phone ?? data.phone,
            locale,
          )}
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
            {t("common.retry")}
          </button>
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col gap-3.5">
          <div>
            <h2 className="mb-1.5 font-display text-xl leading-tight font-extrabold tracking-tight">
              {closedDay ? t("tf.closedThatDay") : t("tf.noTables")}
            </h2>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              {closedDay
                ? t("tf.closedText", {
                    day: capitalizeFirst(isoDayLabel(date, locale)),
                  })
                : t("tf.noTableForGroup", {
                    day: capitalizeFirst(isoDayLabel(date, locale)),
                    party: partySizeGenitive(partySize, locale),
                    zone: area
                      ? t("tf.inZone", {
                          area: guestAreaLabel(area, locale).toLowerCase(),
                        })
                      : "",
                  })}
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
                  {t("tf.nearestFree", {
                    day: isoDayLabel(nearestDay.date, locale),
                  })}
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
              {t("tf.noneNearby")}
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
              <div className="mt-3.5 mb-2 text-xs font-bold">
                {mealPeriodLabel(group.label, locale)}
              </div>
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
            {t("tf.tableOn")} <b>{turnTimeLabel(durationMin)}</b>{" "}
            {t("tf.holdNotePrefix", {
              party: partySizeGenitive(partySize, locale),
              tz: data.timezone,
            })}
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
  const { locale, t } = useTranslations();
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
      setError(t("tf.errAccept"));
      return;
    }
    if (isGuest) {
      if (guest.name.trim().length < 2) {
        setError(t("form.errName"));
        return;
      }
      if (!/^\S+@\S+\.\S+$/.test(guest.email.trim())) {
        setError(t("form.errEmail"));
        return;
      }
      if (guest.phone.trim().length < 7) {
        setError(t("tf.errPhoneCalls"));
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
        // Komunikat z API jest zawsze polski — konflikt opisujemy słownikiem.
        setConflict(t("tf.conflict409"));
        return;
      }
      setError(t("tf.createFailed"));
    } catch {
      setError(t("common.connectionError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <BackCircle onClick={onBack} />
      <div className="meta-label">{t("tf.step3")}</div>
      <h1 className="mt-1.5 mb-[18px] font-display text-[29px] leading-[1.05] font-extrabold tracking-tight">
        {t("tf.almostAtTable")}
      </h1>

      {conflict ? (
        <div className="mb-4 rounded-2xl border-[1.5px] border-border-strong bg-card p-4">
          <div className="mb-3 flex size-9 items-center justify-center rounded-full border border-[#d9a9a1] bg-[#f4e3e0] text-[17px] text-destructive">
            !
          </div>
          <div className="mb-1.5 font-display text-[21px] leading-tight font-extrabold tracking-tight">
            {t("tf.tableGone")}
          </div>
          <p className="mb-3.5 text-[12.5px] leading-relaxed text-foreground/80">
            {conflict} {t("tf.tableGoneText")}
          </p>
          <button
            type="button"
            onClick={onConflictRetry}
            className="min-h-11 w-full rounded-[10px] bg-primary p-3 text-[13px] font-bold text-primary-foreground"
          >
            {t("tf.showHours")}
          </button>
        </div>
      ) : null}

      <div className="mb-5 rounded-2xl border border-[#e2ddd2] bg-[#f7f4ef] p-[15px] dark:border-border dark:bg-secondary">
        <div className="flex justify-between gap-3 text-sm font-semibold">
          <span>{data.name}</span>
          <span className="font-mono">{t("tf.free")}</span>
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
          <span>{t("tf.guests")}</span>
          <span className="font-semibold text-foreground">
            {partySizeLabel(partySize, locale)}
          </span>
        </div>
        <div className="mt-1.5 flex justify-between text-[13px] text-foreground/80">
          <span>{t("tf.zone")}</span>
          <span className="font-semibold text-foreground">
            {area ? guestAreaLabel(area, locale) : t("tf.noPreference")}
          </span>
        </div>
        <div className="mt-1.5 flex justify-between text-[13px] text-foreground/80">
          <span>{t("tf.tableOn")}</span>
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
              {t("form.fullName")}
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
              {t("form.phone")}{" "}
              <span className="font-normal text-[#8f8b81]">
                {t("tf.phoneHintCalls")}
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
              {t("form.email")}
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

      <div className="mt-[11px]">
        <label
          htmlFor="table-note"
          className="mb-[5px] block text-[11px] font-semibold text-muted-foreground"
        >
          {t("tf.notes")}{" "}
          <span className="font-normal text-[#8f8b81]">
            {t("tf.notesHint")}
          </span>
        </label>
        <textarea
          id="table-note"
          value={guest.note}
          onChange={(event) => onGuestChange({ note: event.target.value })}
          rows={3}
          maxLength={500}
          placeholder={t("tf.notesPlaceholder")}
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
          <b className="text-xs">{t("tf.acceptTitle")}</b>
          <br />
          {t("tf.acceptText", { hours: data.cancellationCutoffHours })}
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
          ? t("bf.submitting")
          : t("tf.bookCta", {
              time: formatTimeInZone(startAt, data.timezone),
            })}
      </button>
      <p className="mt-2 text-center text-[11px] text-[#8f8b81]">
        {t("tf.freeNote")}
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
  const { locale, t } = useTranslations();
  const startAt = new Date(booking.startAt);
  const deadline = new Date(booking.cancellationDeadline);

  return (
    <div className="pt-7">
      <div className="mb-5 flex size-[58px] items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check aria-hidden className="size-7" />
      </div>
      <h1 className="mb-2 font-display text-[32px] leading-none font-extrabold tracking-tight">
        {t("tf.bookedTitle")}
      </h1>
      <p className="mb-[22px] text-sm leading-relaxed text-foreground/80">
        {t("tf.successNote")}
      </p>

      <div className="overflow-hidden rounded-2xl border-[1.5px] border-border-strong bg-card">
        <div className="border-b border-dashed border-[#d8d2c4] p-4 dark:border-border">
          <div className="meta-label">
            {formatDayFull(startAt, booking.timezone, locale)}
          </div>
          <div className="my-1 font-display text-[38px] leading-none font-extrabold tracking-tight">
            {formatTimeInZone(startAt, booking.timezone)}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold">
            <span className="flex items-center gap-1.5">
              <Users aria-hidden className="size-4" />
              {partySizeLabel(booking.partySize, locale)}
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[13px] font-medium text-muted-foreground">
              <CalendarClock aria-hidden className="size-4" />
              {t("tf.tableFor", { turn: turnTimeLabel(booking.durationMin) })}
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
              {t("tf.bookingNumber")}
            </div>
          </div>
          <div className="flex-none font-mono text-base font-medium">
            #{booking.id.slice(-8).toUpperCase()}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-accent p-4">
        <div className="meta-label">{t("tf.cancellation")}</div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-foreground/80">
          {t("tf.cancelUntil", {
            deadline: `${formatDayShort(deadline, booking.timezone, locale)}, ${formatTimeInZone(deadline, booking.timezone)}`,
            hours: booking.cancellationCutoffHours,
          })}
        </p>
      </div>

      <Link
        href="/konto"
        className="mt-4 flex min-h-11 w-full items-center justify-center rounded-xl border-[1.5px] border-border-strong bg-card text-[13px] font-semibold"
      >
        {t("tf.myBookings")}
      </Link>
      <Link
        href={`/b/${slug}`}
        className="mt-2 flex min-h-11 w-full items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground"
      >
        {t("tf.backToProfileOf", { name: booking.restaurantName })}
      </Link>
    </div>
  );
}
