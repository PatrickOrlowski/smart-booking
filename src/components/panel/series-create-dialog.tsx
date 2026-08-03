"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  PanelDialogBody,
  PanelDialogContent,
} from "@/components/panel/panel-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  WEEKDAY_LABELS,
  formatMinutes,
  parseDateParam,
  timeOptions,
  weekdayOf,
} from "@/components/panel/format";
import { formatSeriesInterval } from "@/components/panel/series-rule";
import { runAction } from "@/components/panel/run-action";
import type {
  BookingServiceOption,
  BookingStaffOption,
  OpeningBlock,
} from "@/components/panel/add-booking-dialog";
import type { PlannedSlotPreview } from "@/app/panel/(dashboard)/serie/series-data";
import {
  createSeriesAction,
  previewSeriesAction,
  type CreateSeriesResult,
} from "@/app/panel/(dashboard)/serie/actions";
import { matchCustomerAction } from "@/app/panel/(dashboard)/klienci/actions";

/**
 * Dialog „Nowa seria" — reguła cyklu + podgląd konkretnych terminów przed
 * zapisem. Podgląd liczy serwer (te same funkcje co zapis), więc lista dat
 * i oznaczenie kolizji nie mogą rozjechać się z tym, co faktycznie powstanie.
 */

const INTERVAL_OPTIONS = [1, 2, 3, 4, 6, 8, 12];
const OCCURRENCE_OPTIONS = [2, 3, 4, 5, 6, 8, 10, 12, 24];

/** Czy liczebnik wymaga formy mnogiej „2–4" (2 wizyty, 22 terminy). */
const isFewForm = (count: number): boolean => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14);
};

/** „4 wizyty" / „6 wizyt" — odmiana liczebnika. */
const visitsLabel = (count: number): string =>
  `${count} ${isFewForm(count) ? "wizyty" : "wizyt"}`;

/** „4 terminy" / „6 terminów". */
const termsLabel = (count: number): string =>
  `${count} ${isFewForm(count) ? "terminy" : "terminów"}`;

type EndMode = "occurrences" | "endDate";

const SLOT_BADGE: Record<
  PlannedSlotPreview["status"],
  { label: string; className: string }
> = {
  free: {
    label: "wolny",
    className:
      "border-success-soft-border bg-success-soft text-primary dark:border-border dark:bg-muted dark:text-foreground",
  },
  busy: {
    label: "kolizja",
    className: "border-destructive/40 bg-destructive/10 text-destructive",
  },
  timeOff: {
    label: "urlop",
    className: "border-warning/40 bg-warning-soft text-warning-strong",
  },
  outsideHours: {
    label: "poza grafikiem",
    className: "border-border bg-muted text-muted-foreground",
  },
};

export function SeriesCreateDialog({
  businessId,
  staff,
  services,
  openingHours,
  defaultDate,
  granularityMin,
}: {
  businessId: string;
  staff: BookingStaffOption[];
  services: BookingServiceOption[];
  openingHours: OpeningBlock[];
  defaultDate: string;
  granularityMin: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [resourceId, setResourceId] = useState(staff[0]?.id ?? "");
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [startDate, setStartDate] = useState(defaultDate);
  const [weekday, setWeekday] = useState(
    () => weekdayOf(parseDateParam(defaultDate) ?? { year: 2026, month: 1, day: 1 }),
  );
  const [startMinute, setStartMinute] = useState<number | null>(null);
  const [intervalWeeks, setIntervalWeeks] = useState(4);
  const [endMode, setEndMode] = useState<EndMode>("occurrences");
  const [occurrences, setOccurrences] = useState(6);
  const [endDate, setEndDate] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [note, setNote] = useState("");

  const [preview, setPreview] = useState<PlannedSlotPreview[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [truncated, setTruncated] = useState<{ horizonDays: number } | null>(null);
  const [result, setResult] = useState<
    Extract<CreateSeriesResult, { ok: true }> | null
  >(null);

  // Deduplikacja klienta — ten sam mechanizm co przy pojedynczej wizycie:
  // telefon/e-mail sprawdzany na serwerze, seria dopina się do istniejącego
  // profilu CRM zamiast tworzyć drugiego „tego samego" klienta.
  const [match, setMatch] = useState<{
    id: string;
    fullName: string;
    isBlocked: boolean;
  } | null>(null);
  const [matchChecked, setMatchChecked] = useState(false);

  useEffect(() => {
    if (!open) return;
    const phone = customerPhone.trim();
    const email = customerEmail.trim();
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!phone && !email) {
        if (!cancelled) {
          setMatch(null);
          setMatchChecked(false);
        }
        return;
      }
      const response = await runAction(() =>
        matchCustomerAction({
          businessId,
          phone: phone || undefined,
          email: email || undefined,
        }),
      );
      if (cancelled) return;
      setMatch(response.ok ? response.match : null);
      setMatchChecked(response.ok);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, businessId, customerPhone, customerEmail]);

  const startOptions = useMemo(() => {
    const blocks = openingHours.filter((block) => block.weekday === weekday);
    const openMin = blocks.length
      ? Math.min(...blocks.map((block) => block.startMinute))
      : 7 * 60;
    const closeMin = blocks.length
      ? Math.max(...blocks.map((block) => block.endMinute))
      : 21 * 60;
    const step = Math.max(granularityMin, 5);
    return timeOptions(openMin, Math.max(openMin, closeMin - step), step);
  }, [openingHours, weekday, granularityMin]);

  const ruleReady =
    resourceId !== "" &&
    serviceId !== "" &&
    parseDateParam(startDate) !== null &&
    startMinute !== null &&
    (endMode === "occurrences" || parseDateParam(endDate) !== null);

  const rulePayload = useMemo(
    () => ({
      businessId,
      resourceId,
      serviceId,
      startDate,
      weekday,
      startMinute: startMinute ?? 0,
      intervalWeeks,
      occurrences: endMode === "occurrences" ? occurrences : null,
      endDate: endMode === "endDate" ? endDate : null,
    }),
    [
      businessId,
      resourceId,
      serviceId,
      startDate,
      weekday,
      startMinute,
      intervalWeeks,
      endMode,
      occurrences,
      endDate,
    ],
  );

  // Podgląd odświeżany po każdej zmianie reguły (debounce 400 ms), a nie
  // dopiero po kliknięciu — inaczej nikt by go nie oglądał.
  useEffect(() => {
    if (!open || result) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!ruleReady) {
        setPreview(null);
        setPreviewError(null);
        setTruncated(null);
        setPreviewLoading(false);
        return;
      }
      setPreviewLoading(true);
      const response = await runAction(() => previewSeriesAction(rulePayload));
      if (cancelled) return;
      setPreviewLoading(false);
      if (!response.ok) {
        setPreview(null);
        setTruncated(null);
        setPreviewError(response.error);
        return;
      }
      setPreviewError(null);
      setPreview(response.slots);
      setTruncated(
        response.truncated ? { horizonDays: response.horizonDays } : null,
      );
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, result, ruleReady, rulePayload]);

  const freeCount = preview?.filter((slot) => slot.status !== "busy").length ?? 0;
  const busyCount = preview?.filter((slot) => slot.status === "busy").length ?? 0;

  const canSubmit =
    ruleReady && customerName.trim().length >= 2 && !previewLoading;

  const reset = () => {
    setCustomerName("");
    setCustomerPhone("");
    setCustomerEmail("");
    setNote("");
    setStartMinute(null);
    setMatch(null);
    setMatchChecked(false);
    setPreview(null);
    setPreviewError(null);
    setTruncated(null);
    setResult(null);
  };

  const submit = () => {
    if (!canSubmit || startMinute === null) return;
    startTransition(async () => {
      const response = await runAction(() =>
        createSeriesAction({
          ...rulePayload,
          startMinute,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim() || undefined,
          customerEmail: customerEmail.trim() || undefined,
          note: note.trim() || undefined,
        }),
      );
      if (!response.ok) {
        toast.error(response.error);
        return;
      }
      setResult(response);
      if (response.skipped.length > 0) {
        toast.warning(response.message);
      } else {
        toast.success(response.message);
      }
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button className="h-11 rounded-full px-5 font-semibold lg:h-9 lg:px-4">
          + Nowa seria
        </Button>
      </DialogTrigger>
      {/*
        Dialog serii jest wysoki (reguła + podgląd terminów + dane klienta).
        Domyślny DialogContent nie ma ograniczenia wysokości, więc na laptopie
        1024×768 stopka z „Utwórz serię" wypadała poza ekran — od `sm` w górę
        ograniczamy wysokość i przewijamy samą treść, tak jak na telefonie.
      */}
      <PanelDialogContent className="sm:flex sm:max-h-[calc(100dvh-3rem)] sm:max-w-2xl sm:flex-col sm:overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {result ? "Seria utworzona" : "Nowa seria cykliczna"}
          </DialogTitle>
          <DialogDescription>
            {result
              ? "Podsumowanie wygenerowanych wizyt."
              : "Powtarzalny termin dla stałego klienta — wizyty powstają od razu, z tą samą godziną lokalną także po zmianie czasu."}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <>
            <PanelDialogBody className="sm:min-h-0 sm:flex-1 sm:overflow-y-auto">
              <div className="rounded-xl border border-border bg-card px-4 py-3">
                <p className="font-display text-[18px] font-extrabold tracking-tight">
                  Utworzono {result.created} z {result.planned} wizyt
                </p>
                {result.skipped.length > 0 ? (
                  <div className="mt-3">
                    <p className="meta-label">Pominięte terminy</p>
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {result.skipped.map((entry) => (
                        <li
                          key={entry.label}
                          className="flex flex-wrap items-center gap-x-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 font-mono text-[11.5px] text-destructive"
                        >
                          <span className="font-semibold">{entry.label}</span>
                          <span aria-hidden>·</span>
                          <span>{entry.reason}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      Pominięte terminy nie blokują reszty serii — możesz je
                      dodać ręcznie w kalendarzu w innej godzinie.
                    </p>
                  </div>
                ) : (
                  <p className="mt-1 text-[12.5px] text-muted-foreground">
                    Wszystkie terminy były wolne.
                  </p>
                )}
              </div>
            </PanelDialogBody>
            <DialogFooter>
              <Button
                variant="outline"
                className="rounded-full max-lg:h-11"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Zamknij
              </Button>
              <Button asChild className="rounded-full font-semibold max-lg:h-11">
                <Link href={`/panel/serie/${result.seriesId}`}>
                  Otwórz serię
                </Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <PanelDialogBody className="sm:min-h-0 sm:flex-1 sm:overflow-y-auto">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>Pracownik</Label>
                  <Select value={resourceId} onValueChange={setResourceId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Wybierz" />
                    </SelectTrigger>
                    <SelectContent>
                      {staff.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Usługa</Label>
                  <Select value={serviceId} onValueChange={setServiceId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Wybierz" />
                    </SelectTrigger>
                    <SelectContent>
                      {services.map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          {entry.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="series-start">Start od</Label>
                  <Input
                    id="series-start"
                    type="date"
                    min={defaultDate}
                    value={startDate}
                    onChange={(event) => {
                      const value = event.target.value;
                      setStartDate(value);
                      const parsed = parseDateParam(value);
                      if (parsed) setWeekday(weekdayOf(parsed));
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Dzień tygodnia</Label>
                  <Select
                    value={String(weekday)}
                    onValueChange={(value) => setWeekday(Number(value))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAY_LABELS.map((label, index) => (
                        <SelectItem key={label} value={String(index)}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Godzina</Label>
                  <Select
                    value={startMinute === null ? "" : String(startMinute)}
                    onValueChange={(value) => setStartMinute(Number(value))}
                  >
                    <SelectTrigger className="w-full font-mono">
                      <SelectValue placeholder="--:--" />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {startOptions.map((minute) => (
                        <SelectItem
                          key={minute}
                          value={String(minute)}
                          className="font-mono"
                        >
                          {formatMinutes(minute)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Powtarzaj</Label>
                  <Select
                    value={String(intervalWeeks)}
                    onValueChange={(value) => setIntervalWeeks(Number(value))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INTERVAL_OPTIONS.map((weeks) => (
                        <SelectItem key={weeks} value={String(weeks)}>
                          {formatSeriesInterval(weeks)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <p className="meta-label">Koniec serii</p>
                <div className="mt-2 flex flex-col gap-2.5 sm:flex-row sm:items-end">
                  <div className="flex shrink-0 rounded-full border border-border bg-card p-0.5">
                    {(
                      [
                        ["occurrences", "Liczba wizyt"],
                        ["endDate", "Data końca"],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setEndMode(mode)}
                        className={cn(
                          "min-h-9 rounded-full px-3 text-[12.5px] font-semibold transition-colors",
                          endMode === mode
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {endMode === "occurrences" ? (
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <Label htmlFor="series-occurrences" className="sr-only">
                        Liczba wizyt
                      </Label>
                      <Select
                        value={String(occurrences)}
                        onValueChange={(value) => setOccurrences(Number(value))}
                      >
                        <SelectTrigger id="series-occurrences" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-64">
                          {OCCURRENCE_OPTIONS.map((count) => (
                            <SelectItem key={count} value={String(count)}>
                              {visitsLabel(count)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <Label htmlFor="series-end" className="sr-only">
                        Data końca
                      </Label>
                      <Input
                        id="series-end"
                        type="date"
                        value={endDate}
                        min={startDate}
                        onChange={(event) => setEndDate(event.target.value)}
                      />
                    </div>
                  )}
                </div>
              </div>

              <SeriesPreview
                slots={preview}
                loading={previewLoading}
                error={previewError}
                ready={ruleReady}
                truncatedHorizonDays={truncated?.horizonDays ?? null}
                summary={
                  preview
                    ? `${termsLabel(preview.length)} · ${freeCount} do utworzenia${busyCount ? ` · ${busyCount} z kolizją` : ""}`
                    : null
                }
              />

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="series-name">Imię i nazwisko klienta</Label>
                <Input
                  id="series-name"
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  placeholder="np. Jan Kowalski"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="series-phone">Telefon (opcjonalnie)</Label>
                  <Input
                    id="series-phone"
                    value={customerPhone}
                    onChange={(event) => setCustomerPhone(event.target.value)}
                    placeholder="+48 600 000 000"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="series-email">E-mail (opcjonalnie)</Label>
                  <Input
                    id="series-email"
                    type="email"
                    value={customerEmail}
                    onChange={(event) => setCustomerEmail(event.target.value)}
                    placeholder="jan@przyklad.pl"
                  />
                </div>
              </div>

              {matchChecked && match ? (
                <div className="rounded-lg border border-success-soft-border bg-success-soft px-3 py-2.5 text-xs leading-relaxed text-primary dark:border-border dark:bg-muted dark:text-foreground">
                  Znaleziono istniejącego klienta: <b>{match.fullName}</b> —
                  wizyty serii trafią do jego historii.
                  {match.isBlocked ? (
                    <span className="mt-1 block font-semibold text-destructive">
                      Uwaga: ten klient jest zablokowany dla rezerwacji online.
                    </span>
                  ) : null}
                </div>
              ) : matchChecked ? (
                <p className="text-[11px] text-muted-foreground">
                  Brak dopasowania po telefonie/e-mailu — przy zapisie powstanie
                  nowy profil klienta.
                </p>
              ) : null}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="series-note">Notatka wewnętrzna (opcjonalnie)</Label>
                <Textarea
                  id="series-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={2}
                  placeholder="np. stały termin, ta sama maszynka"
                />
              </div>
            </PanelDialogBody>

            <DialogFooter>
              <Button
                variant="outline"
                className="rounded-full max-lg:h-11"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Anuluj
              </Button>
              <Button
                className="rounded-full font-semibold max-lg:h-11"
                onClick={submit}
                disabled={!canSubmit || isPending}
              >
                {isPending ? "Tworzenie…" : "Utwórz serię"}
              </Button>
            </DialogFooter>
          </>
        )}
      </PanelDialogContent>
    </Dialog>
  );
}

function SeriesPreview({
  slots,
  loading,
  error,
  ready,
  truncatedHorizonDays,
  summary,
}: {
  slots: PlannedSlotPreview[] | null;
  loading: boolean;
  error: string | null;
  ready: boolean;
  truncatedHorizonDays: number | null;
  summary: string | null;
}) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-3 py-2">
        <span className="meta-label">Podgląd terminów</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {loading ? "liczenie…" : (summary ?? "")}
        </span>
      </div>

      {error ? (
        <p className="px-3 py-3 text-[12.5px] text-destructive">{error}</p>
      ) : !ready ? (
        <p className="px-3 py-3 text-[12.5px] text-muted-foreground">
          Uzupełnij pracownika, usługę, godzinę i koniec serii — terminy
          pokażą się tutaj.
        </p>
      ) : slots === null ? (
        <p className="px-3 py-3 text-[12.5px] text-muted-foreground">
          Liczenie terminów…
        </p>
      ) : slots.length === 0 ? (
        <p className="px-3 py-3 text-[12.5px] text-muted-foreground">
          Ta reguła nie daje żadnego terminu w horyzoncie rezerwacji.
        </p>
      ) : (
        <>
          <ul className="max-h-56 overflow-y-auto">
            {slots.map((slot) => {
              const badge = SLOT_BADGE[slot.status];
              return (
                <li
                  key={slot.startAtIso}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border px-3 py-2 first:border-t-0"
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {String(slot.index).padStart(2, "0")}
                    </span>
                    <span className="font-mono text-[12.5px] font-medium">
                      {slot.label}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {slot.detail ? (
                      <span className="font-mono text-[10.5px] text-muted-foreground">
                        {slot.detail}
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.04em] uppercase",
                        badge.className,
                      )}
                    >
                      {badge.label}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          {truncatedHorizonDays !== null ? (
            <p className="border-t border-border px-3 py-2 text-[11.5px] text-warning-strong">
              Seria skrócona do horyzontu rezerwacji lokalizacji
              ({truncatedHorizonDays} dni).
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
