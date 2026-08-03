"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PanelDialogBody,
  PanelDialogContent,
} from "@/components/panel/panel-dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMinutes, timeOptions } from "@/components/panel/format";
import type { TurnTimeRuleView } from "@/components/panel/host-walkin-dialog";
import { turnTimeFor } from "@/components/restaurant/types";
import { convertWaitlistEntryAction } from "@/app/panel/(dashboard)/dzis/actions";

/**
 * „Zamień na rezerwację" — wpis z listy oczekujących staje się rezerwacją
 * stolika. Dialog liczy czas przy stole z reguł turn time i podpowiada, które
 * stoliki są w wybranym oknie zajęte; ostatecznie i tak decyduje baza
 * (ograniczenie wykluczające na pozycjach rezerwacji).
 */

export type ConvertTableOption = {
  id: string;
  number: string;
  roomName: string;
  capacityMin: number | null;
  capacityMax: number | null;
};

export type TableOccupancy = {
  tableId: string;
  startMin: number;
  /** Koniec blokady wraz z buforem sprzątania. */
  blockedEndMin: number;
};

export function WaitlistConvertDialog({
  businessId,
  open,
  onOpenChange,
  entry,
  tables,
  occupancy,
  turnTimeRules,
  defaultTurnTimeMin,
  tableBufferMin,
  openMin,
  closeMin,
}: {
  businessId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: {
    id: string;
    guestName: string;
    partySize: number;
    requestedMin: number;
    flexMin: number;
    note: string | null;
  };
  tables: ConvertTableOption[];
  occupancy: TableOccupancy[];
  turnTimeRules: TurnTimeRuleView[];
  defaultTurnTimeMin: number;
  tableBufferMin: number;
  openMin: number;
  closeMin: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const turnTimeMin = useMemo(
    () => turnTimeFor(turnTimeRules, entry.partySize, defaultTurnTimeMin),
    [turnTimeRules, entry.partySize, defaultTurnTimeMin],
  );

  // Rezerwacja musi w całości mieścić się w godzinach otwarcia lokalu. Gdy
  // czas przy stole nie zmieści się do zamknięcia, lista godzin zostaje PUSTA —
  // wcześniej `Math.max` podsuwał godzinę otwarcia, którą serwer i tak odrzucał.
  const fitsBeforeClose = closeMin - turnTimeMin >= openMin;
  const choices = useMemo(
    () =>
      fitsBeforeClose ? timeOptions(openMin, closeMin - turnTimeMin, 15) : [],
    [fitsBeforeClose, openMin, closeMin, turnTimeMin],
  );

  const defaultStart = useMemo(() => {
    if (choices.length === 0) return null;
    return choices.reduce((best, minute) =>
      Math.abs(minute - entry.requestedMin) < Math.abs(best - entry.requestedMin)
        ? minute
        : best,
    );
  }, [choices, entry.requestedMin]);

  const [startMin, setStartMin] = useState<number | null>(defaultStart);
  const [resourceId, setResourceId] = useState("");

  const effectiveStart = startMin ?? defaultStart;
  const endMin = effectiveStart === null ? null : effectiveStart + turnTimeMin;

  const busyTableIds = useMemo(() => {
    if (effectiveStart === null) return new Set<string>();
    const blockedEnd = effectiveStart + turnTimeMin + tableBufferMin;
    const busy = new Set<string>();
    for (const slot of occupancy) {
      if (slot.startMin < blockedEnd && effectiveStart < slot.blockedEndMin) {
        busy.add(slot.tableId);
      }
    }
    return busy;
  }, [occupancy, effectiveStart, turnTimeMin, tableBufferMin]);

  const options = useMemo(() => {
    return [...tables].sort((a, b) => {
      const busyA = busyTableIds.has(a.id) ? 1 : 0;
      const busyB = busyTableIds.has(b.id) ? 1 : 0;
      if (busyA !== busyB) return busyA - busyB;
      const fitsA = (a.capacityMax ?? 99) >= entry.partySize ? 0 : 1;
      const fitsB = (b.capacityMax ?? 99) >= entry.partySize ? 0 : 1;
      if (fitsA !== fitsB) return fitsA - fitsB;
      return a.number.localeCompare(b.number, "pl", { numeric: true });
    });
  }, [tables, busyTableIds, entry.partySize]);

  const submit = () => {
    if (!resourceId || effectiveStart === null) return;
    startTransition(async () => {
      const result = await convertWaitlistEntryAction({
        businessId,
        entryId: entry.id,
        resourceId,
        startMinute: effectiveStart,
      });
      if (result.ok) {
        toast.success(result.message ?? "Rezerwacja utworzona");
        onOpenChange(false);
        setResourceId("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <PanelDialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Zamień na rezerwację</DialogTitle>
          <DialogDescription>
            {entry.guestName} · {entry.partySize} os. · prosi o{" "}
            {formatMinutes(entry.requestedMin)} (±{entry.flexMin} min)
          </DialogDescription>
        </DialogHeader>

        <PanelDialogBody>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Godzina</Label>
              <Select
                value={effectiveStart === null ? "" : String(effectiveStart)}
                onValueChange={(value) => setStartMin(Number(value))}
              >
                <SelectTrigger className="w-full font-mono">
                  <SelectValue placeholder="--:--" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {choices.map((minute) => (
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
              <Label>Stolik</Label>
              <Select value={resourceId} onValueChange={setResourceId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Wybierz stolik" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {options.map((table) => {
                    const busy = busyTableIds.has(table.id);
                    return (
                      <SelectItem
                        key={table.id}
                        value={table.id}
                        disabled={busy}
                      >
                        <span className="font-mono">{table.number}</span>
                        <span className="text-muted-foreground">
                          {table.roomName}
                          {table.capacityMax !== null
                            ? ` · ${table.capacityMin ?? 1}–${table.capacityMax} os.`
                            : ""}
                          {busy ? " · zajęty" : ""}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>

          {choices.length === 0 ? (
            <p className="rounded-lg border border-warning bg-warning-soft px-3 py-2.5 text-xs leading-snug text-warning-strong">
              Do zamknięcia zostało za mało czasu: rezerwacja dla{" "}
              {entry.partySize} os. trwa {turnTimeMin} min i nie zmieści się
              w godzinach otwarcia ({formatMinutes(openMin)}–
              {formatMinutes(closeMin)}). Umów gościa na inny dzień.
            </p>
          ) : null}

          <div className="rounded-lg border border-dashed border-border bg-card px-3 py-2.5 text-xs text-foreground/80">
            Czas przy stole: <b className="font-mono">{turnTimeMin} min</b>
            {effectiveStart !== null && endMin !== null ? (
              <>
                {" "}
                ·{" "}
                <b className="font-mono">
                  {formatMinutes(effectiveStart)}–{formatMinutes(endMin)}
                </b>
              </>
            ) : null}
          </div>

          {entry.note ? (
            <p className="text-[12px] leading-snug text-muted-foreground">
              Notatka gościa: {entry.note}
            </p>
          ) : null}
        </PanelDialogBody>

        <DialogFooter>
          <Button
            variant="outline"
            className="rounded-full max-lg:h-11"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Anuluj
          </Button>
          <Button
            className="rounded-full font-semibold max-lg:h-11"
            onClick={submit}
            disabled={isPending || !resourceId || effectiveStart === null}
          >
            {isPending ? "Zapisywanie…" : "Utwórz rezerwację"}
          </Button>
        </DialogFooter>
      </PanelDialogContent>
    </Dialog>
  );
}
