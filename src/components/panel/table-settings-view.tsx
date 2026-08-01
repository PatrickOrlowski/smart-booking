"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { WEEKDAY_LABELS } from "@/components/panel/format";
import {
  minutesToTimeValue,
  timeValueToMinutes,
} from "@/app/panel/(dashboard)/sale/plan-utils";
import {
  deletePacingRuleAction,
  deleteTurnTimeRuleAction,
  savePacingRuleAction,
  saveRestaurantSettingsAction,
  saveTurnTimeRuleAction,
} from "@/app/panel/(dashboard)/sale/actions";

/**
 * Ustawienia restauracyjne lokalu: turn time (czas zajęcia stolika zależny od
 * liczby osób), pacing (limit gości na przedział czasu) i parametry lokalu.
 *
 * Wszystkie czasy to minuty od północy czasu LOKALU — nie ma tu żadnej
 * konwersji stref, bo reguły opisują zegar na ścianie, nie moment w czasie.
 */

export type TurnTimeRuleRow = {
  id: string;
  partySizeMin: number;
  partySizeMax: number;
  durationMin: number;
};

export type PacingRuleRow = {
  id: string;
  weekday: number | null;
  startMinute: number;
  endMinute: number;
  intervalMin: number;
  maxCovers: number | null;
  maxBookings: number | null;
};

export type RestaurantSettings = {
  defaultTurnTimeMin: number;
  tableBufferMin: number;
  maxPartySizeOnline: number | null;
  waitlistEnabled: boolean;
};

const SECTION = "rounded-2xl border border-border bg-card p-4 sm:p-5";

export function TableSettingsView({
  businessId,
  locationId,
  settings,
  turnTimeRules,
  pacingRules,
  isManager,
}: {
  businessId: string;
  locationId: string;
  settings: RestaurantSettings;
  turnTimeRules: TurnTimeRuleRow[];
  pacingRules: PacingRuleRow[];
  isManager: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [form, setForm] = useState({
    defaultTurnTimeMin: String(settings.defaultTurnTimeMin),
    tableBufferMin: String(settings.tableBufferMin),
    maxPartySizeOnline:
      settings.maxPartySizeOnline == null
        ? ""
        : String(settings.maxPartySizeOnline),
    waitlistEnabled: settings.waitlistEnabled,
  });

  const [turnDraft, setTurnDraft] = useState({
    partySizeMin: "",
    partySizeMax: "",
    durationMin: "",
  });

  const [pacingDraft, setPacingDraft] = useState({
    weekday: "all",
    start: "18:00",
    end: "21:00",
    intervalMin: "15",
    maxCovers: "",
    maxBookings: "",
  });

  const saveSettings = () => {
    const defaultTurnTimeMin = Number(form.defaultTurnTimeMin);
    const tableBufferMin = Number(form.tableBufferMin);
    const maxPartySizeOnline =
      form.maxPartySizeOnline.trim() === ""
        ? null
        : Number(form.maxPartySizeOnline);
    if (!Number.isFinite(defaultTurnTimeMin) || defaultTurnTimeMin < 15) {
      toast.error("Domyślny czas zajęcia stolika: minimum 15 minut");
      return;
    }
    if (!Number.isFinite(tableBufferMin) || tableBufferMin < 0) {
      toast.error("Przerwa na sprzątnięcie nie może być ujemna");
      return;
    }
    if (
      maxPartySizeOnline !== null &&
      (!Number.isFinite(maxPartySizeOnline) || maxPartySizeOnline < 1)
    ) {
      toast.error("Maksymalna grupa online: minimum 1 osoba albo pusto");
      return;
    }
    startTransition(async () => {
      const result = await saveRestaurantSettingsAction({
        businessId,
        locationId,
        defaultTurnTimeMin,
        tableBufferMin,
        maxPartySizeOnline,
        waitlistEnabled: form.waitlistEnabled,
      });
      if (result.ok) {
        toast.success("Zapisano ustawienia lokalu");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const addTurnTimeRule = () => {
    const partySizeMin = Number(turnDraft.partySizeMin);
    const partySizeMax = Number(turnDraft.partySizeMax);
    const durationMin = Number(turnDraft.durationMin);
    if (
      !Number.isFinite(partySizeMin) ||
      !Number.isFinite(partySizeMax) ||
      partySizeMin < 1 ||
      partySizeMax < partySizeMin
    ) {
      toast.error("Podaj poprawny zakres osób (od ≤ do)");
      return;
    }
    if (!Number.isFinite(durationMin) || durationMin < 15) {
      toast.error("Czas zajęcia stolika: minimum 15 minut");
      return;
    }
    const overlap = turnTimeRules.find(
      (rule) =>
        rule.partySizeMin <= partySizeMax && rule.partySizeMax >= partySizeMin,
    );
    if (overlap) {
      toast.error(
        `Zakres nakłada się na regułę ${overlap.partySizeMin}–${overlap.partySizeMax} osób`,
      );
      return;
    }
    startTransition(async () => {
      const result = await saveTurnTimeRuleAction({
        businessId,
        locationId,
        partySizeMin,
        partySizeMax,
        durationMin,
      });
      if (result.ok) {
        toast.success("Reguła dodana");
        setTurnDraft({ partySizeMin: "", partySizeMax: "", durationMin: "" });
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const removeTurnTimeRule = (ruleId: string) => {
    startTransition(async () => {
      const result = await deleteTurnTimeRuleAction({ businessId, ruleId });
      if (result.ok) {
        toast.success("Reguła usunięta");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const addPacingRule = () => {
    const startMinute = timeValueToMinutes(pacingDraft.start);
    const endMinute = timeValueToMinutes(pacingDraft.end);
    const intervalMin = Number(pacingDraft.intervalMin);
    const maxCovers =
      pacingDraft.maxCovers.trim() === "" ? null : Number(pacingDraft.maxCovers);
    const maxBookings =
      pacingDraft.maxBookings.trim() === ""
        ? null
        : Number(pacingDraft.maxBookings);

    if (startMinute === null || endMinute === null || startMinute >= endMinute) {
      toast.error("Okno godzinowe musi się kończyć później, niż zaczyna");
      return;
    }
    if (!Number.isFinite(intervalMin) || intervalMin < 5) {
      toast.error("Interwał: minimum 5 minut");
      return;
    }
    if (maxCovers === null && maxBookings === null) {
      toast.error("Ustaw limit osób albo limit rezerwacji");
      return;
    }
    if (
      (maxCovers !== null && (!Number.isFinite(maxCovers) || maxCovers < 1)) ||
      (maxBookings !== null && (!Number.isFinite(maxBookings) || maxBookings < 1))
    ) {
      toast.error("Limity muszą być liczbami większymi od zera");
      return;
    }

    startTransition(async () => {
      const result = await savePacingRuleAction({
        businessId,
        locationId,
        weekday:
          pacingDraft.weekday === "all" ? null : Number(pacingDraft.weekday),
        startMinute,
        endMinute,
        intervalMin,
        maxCovers,
        maxBookings,
      });
      if (result.ok) {
        toast.success("Reguła pacingu dodana");
        setPacingDraft({ ...pacingDraft, maxCovers: "", maxBookings: "" });
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const removePacingRule = (ruleId: string) => {
    startTransition(async () => {
      const result = await deletePacingRuleAction({ businessId, ruleId });
      if (result.ok) {
        toast.success("Reguła usunięta");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const sortedTurnTimes = [...turnTimeRules].sort(
    (a, b) => a.partySizeMin - b.partySizeMin,
  );

  return (
    <div className="flex flex-col gap-4 xl:grid xl:grid-cols-2 xl:items-start">
      <section className={SECTION}>
        <div className="meta-label mb-3">Turn time — czas zajęcia stolika</div>
        <p className="mb-3 text-[12px] text-muted-foreground">
          Pierwsza pasująca reguła wygrywa. Gdy żadna nie pasuje, obowiązuje
          czas domyślny lokalu ({settings.defaultTurnTimeMin} min).
        </p>

        <div className="overflow-hidden rounded-xl border border-border">
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 border-b border-muted bg-muted/50 px-3 py-2 font-mono text-[9.5px] tracking-[0.06em] text-muted-foreground">
            <span>OSÓB OD</span>
            <span>OSÓB DO</span>
            <span>CZAS</span>
            <span className="w-8" />
          </div>
          {sortedTurnTimes.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              Brak reguł — wszystkie grupy dostają czas domyślny.
            </div>
          )}
          {sortedTurnTimes.map((rule) => (
            <div
              key={rule.id}
              className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2 border-b border-muted px-3 py-2 last:border-b-0"
            >
              <span className="font-mono text-[13px]">{rule.partySizeMin}</span>
              <span className="font-mono text-[13px]">{rule.partySizeMax}</span>
              <span className="font-mono text-[13px]">
                {rule.durationMin} min
              </span>
              {isManager ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-destructive max-lg:h-11 max-lg:w-11"
                  aria-label={`Usuń regułę ${rule.partySizeMin}–${rule.partySizeMax}`}
                  disabled={isPending}
                  onClick={() => removeTurnTimeRule(rule.id)}
                >
                  ×
                </Button>
              ) : (
                <span className="w-8" />
              )}
            </div>
          ))}
          {isManager && (
            <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2 border-t border-border bg-muted/30 px-3 py-2">
              <Input
                type="number"
                min={1}
                aria-label="Liczba osób od"
                className="h-9 font-mono"
                placeholder="od"
                value={turnDraft.partySizeMin}
                onChange={(event) =>
                  setTurnDraft({ ...turnDraft, partySizeMin: event.target.value })
                }
              />
              <Input
                type="number"
                min={1}
                aria-label="Liczba osób do"
                className="h-9 font-mono"
                placeholder="do"
                value={turnDraft.partySizeMax}
                onChange={(event) =>
                  setTurnDraft({ ...turnDraft, partySizeMax: event.target.value })
                }
              />
              <Input
                type="number"
                min={15}
                step={15}
                aria-label="Czas w minutach"
                className="h-9 font-mono"
                placeholder="min"
                value={turnDraft.durationMin}
                onChange={(event) =>
                  setTurnDraft({ ...turnDraft, durationMin: event.target.value })
                }
              />
              <Button
                size="sm"
                className="h-9 rounded-full px-3 text-xs font-semibold"
                disabled={isPending}
                onClick={addTurnTimeRule}
              >
                Dodaj
              </Button>
            </div>
          )}
        </div>
      </section>

      <section className={SECTION}>
        <div className="meta-label mb-3">Pacing — tempo przyjmowania gości</div>
        <p className="mb-3 text-[12px] text-muted-foreground">
          Limit dotyczy rezerwacji zaczynających się w danym przedziale — bez
          niego kuchnia dostaje całą salę na 19:00.
        </p>

        <div className="flex flex-col gap-2">
          {pacingRules.length === 0 && (
            <div className="rounded-xl border border-border px-3 py-3 text-xs text-muted-foreground">
              Brak reguł — rezerwacje przyjmowane bez ograniczenia tempa.
            </div>
          )}
          {pacingRules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold">
                  {rule.weekday === null
                    ? "Codziennie"
                    : WEEKDAY_LABELS[rule.weekday]}
                  <span className="ml-2 font-mono text-[11.5px] font-normal text-muted-foreground">
                    {minutesToTimeValue(rule.startMinute)}–
                    {minutesToTimeValue(rule.endMinute)}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  co {rule.intervalMin} min ·{" "}
                  {[
                    rule.maxCovers !== null ? `max ${rule.maxCovers} osób` : null,
                    rule.maxBookings !== null
                      ? `max ${rule.maxBookings} rezerwacji`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              {isManager && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 shrink-0 p-0 text-destructive max-lg:h-11 max-lg:w-11"
                  aria-label="Usuń regułę pacingu"
                  disabled={isPending}
                  onClick={() => removePacingRule(rule.id)}
                >
                  ×
                </Button>
              )}
            </div>
          ))}
        </div>

        {isManager && (
          <div className="mt-3 rounded-xl border border-border bg-muted/30 p-3">
            <div className="meta-label mb-2">Nowa reguła</div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
                <Label htmlFor="pacing-weekday">Dzień</Label>
                <Select
                  value={pacingDraft.weekday}
                  onValueChange={(value) =>
                    setPacingDraft({ ...pacingDraft, weekday: value })
                  }
                >
                  <SelectTrigger id="pacing-weekday" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Codziennie</SelectItem>
                    {WEEKDAY_LABELS.map((label, index) => (
                      <SelectItem key={label} value={String(index)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pacing-start">Od</Label>
                <Input
                  id="pacing-start"
                  type="time"
                  step={900}
                  className="font-mono"
                  value={pacingDraft.start}
                  onChange={(event) =>
                    setPacingDraft({ ...pacingDraft, start: event.target.value })
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pacing-end">Do</Label>
                <Input
                  id="pacing-end"
                  type="time"
                  step={900}
                  className="font-mono"
                  value={pacingDraft.end}
                  onChange={(event) =>
                    setPacingDraft({ ...pacingDraft, end: event.target.value })
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pacing-interval">Interwał (min)</Label>
                <Input
                  id="pacing-interval"
                  type="number"
                  min={5}
                  step={5}
                  className="font-mono"
                  value={pacingDraft.intervalMin}
                  onChange={(event) =>
                    setPacingDraft({
                      ...pacingDraft,
                      intervalMin: event.target.value,
                    })
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pacing-covers">Maks. osób</Label>
                <Input
                  id="pacing-covers"
                  type="number"
                  min={1}
                  className="font-mono"
                  placeholder="np. 12"
                  value={pacingDraft.maxCovers}
                  onChange={(event) =>
                    setPacingDraft({
                      ...pacingDraft,
                      maxCovers: event.target.value,
                    })
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pacing-bookings">Maks. rezerwacji</Label>
                <Input
                  id="pacing-bookings"
                  type="number"
                  min={1}
                  className="font-mono"
                  placeholder="opcjonalnie"
                  value={pacingDraft.maxBookings}
                  onChange={(event) =>
                    setPacingDraft({
                      ...pacingDraft,
                      maxBookings: event.target.value,
                    })
                  }
                />
              </div>
            </div>
            <Button
              className="mt-3 h-9 rounded-full px-4 text-xs font-semibold max-lg:h-11"
              disabled={isPending}
              onClick={addPacingRule}
            >
              Dodaj regułę
            </Button>
          </div>
        )}
      </section>

      <section className={`${SECTION} xl:col-span-2`}>
        <div className="meta-label mb-3">Ustawienia lokalu</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-turn-time">Domyślny turn time (min)</Label>
            <Input
              id="settings-turn-time"
              type="number"
              min={15}
              step={15}
              className="font-mono"
              disabled={!isManager}
              value={form.defaultTurnTimeMin}
              onChange={(event) =>
                setForm({ ...form, defaultTurnTimeMin: event.target.value })
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-buffer">Przerwa na sprzątnięcie (min)</Label>
            <Input
              id="settings-buffer"
              type="number"
              min={0}
              step={5}
              className="font-mono"
              disabled={!isManager}
              value={form.tableBufferMin}
              onChange={(event) =>
                setForm({ ...form, tableBufferMin: event.target.value })
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-max-party">Maks. grupa online</Label>
            <Input
              id="settings-max-party"
              type="number"
              min={1}
              className="font-mono"
              placeholder="bez limitu"
              disabled={!isManager}
              value={form.maxPartySizeOnline}
              onChange={(event) =>
                setForm({ ...form, maxPartySizeOnline: event.target.value })
              }
            />
          </div>
        </div>

        <label className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5">
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold">
              Lista oczekujących
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
              Gdy brak wolnego stolika, klient może zapisać się na listę i
              dostanie powiadomienie o zwolnionym miejscu.
            </span>
          </span>
          <Switch
            checked={form.waitlistEnabled}
            disabled={!isManager}
            onCheckedChange={(checked) =>
              setForm({ ...form, waitlistEnabled: checked === true })
            }
          />
        </label>

        {isManager && (
          <Button
            className="mt-4 h-9 rounded-full px-5 font-semibold max-lg:h-11"
            disabled={isPending}
            onClick={saveSettings}
          >
            {isPending ? "Zapisywanie…" : "Zapisz ustawienia"}
          </Button>
        )}
      </section>
    </div>
  );
}
