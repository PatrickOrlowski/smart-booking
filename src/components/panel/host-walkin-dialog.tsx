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
import { createWalkInBookingAction } from "@/app/panel/(dashboard)/dzis/actions";

/**
 * „Gość z ulicy" — rezerwacja od teraz na czas z turn time, od razu
 * potwierdzona. Godzinę startu wylicza wyłącznie serwer; dialog pokazuje
 * jedynie podgląd (`startLabel`), żeby host wiedział, co zapisuje.
 */

export type WalkInTableOption = {
  id: string;
  number: string;
  roomName: string;
  capacityMin: number | null;
  capacityMax: number | null;
  /** Stolik zajęty albo w buforze sprzątania — nie da się go teraz posadzić. */
  busy: boolean;
  busyLabel: string | null;
};

export type TurnTimeRuleView = {
  partySizeMin: number;
  partySizeMax: number;
  durationMin: number;
};

const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12];

export function HostWalkInDialog({
  businessId,
  tables,
  turnTimeRules,
  defaultTurnTimeMin,
  startLabel,
  disabled,
}: {
  businessId: string;
  tables: WalkInTableOption[];
  turnTimeRules: TurnTimeRuleView[];
  defaultTurnTimeMin: number;
  /** „teraz (18:20)" albo „od otwarcia (12:00)" — policzone w strefie lokalu. */
  startLabel: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [partySize, setPartySize] = useState(2);
  const [resourceId, setResourceId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [note, setNote] = useState("");

  const turnTimeMin = useMemo(() => {
    const rule = turnTimeRules
      .filter(
        (entry) =>
          entry.partySizeMin <= partySize && partySize <= entry.partySizeMax,
      )
      .sort((a, b) => a.partySizeMin - b.partySizeMin)[0];
    return rule?.durationMin ?? defaultTurnTimeMin;
  }, [turnTimeRules, partySize, defaultTurnTimeMin]);

  // Wolne stoliki na górze listy, w każdej grupie sensowna pojemność najpierw.
  const options = useMemo(() => {
    return [...tables].sort((a, b) => {
      if (a.busy !== b.busy) return a.busy ? 1 : -1;
      const fitsA = (a.capacityMax ?? 99) >= partySize ? 0 : 1;
      const fitsB = (b.capacityMax ?? 99) >= partySize ? 0 : 1;
      if (fitsA !== fitsB) return fitsA - fitsB;
      return a.number.localeCompare(b.number, "pl", { numeric: true });
    });
  }, [tables, partySize]);

  const selected = options.find((table) => table.id === resourceId) ?? null;
  const tooSmall =
    selected !== null &&
    selected.capacityMax !== null &&
    partySize > selected.capacityMax;

  const submit = () => {
    if (!resourceId) return;
    startTransition(async () => {
      const result = await createWalkInBookingAction({
        businessId,
        resourceId,
        partySize,
        guestName: guestName.trim() || undefined,
        note: note.trim() || undefined,
      });
      if (result.ok) {
        toast.success(result.message ?? "Gość posadzony");
        setOpen(false);
        setGuestName("");
        setNote("");
        setResourceId("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          disabled={disabled}
          className="h-11 rounded-full px-5 font-semibold max-sm:shadow-lg lg:h-8 lg:px-4"
        >
          + Gość z ulicy
        </Button>
      </DialogTrigger>
      <PanelDialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Gość z ulicy</DialogTitle>
          <DialogDescription>
            Rezerwacja od razu potwierdzona, start {startLabel}. Czas przy stole
            liczony z reguł turn time.
          </DialogDescription>
        </DialogHeader>

        <PanelDialogBody>
          <div className="flex flex-col gap-1.5">
            <Label>Liczba osób</Label>
            <div className="flex flex-wrap gap-1.5">
              {PARTY_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setPartySize(size)}
                  aria-pressed={partySize === size}
                  className={
                    partySize === size
                      ? "min-h-11 min-w-11 rounded-full bg-primary px-3 font-mono text-[13px] font-semibold text-primary-foreground lg:min-h-9 lg:min-w-9"
                      : "min-h-11 min-w-11 rounded-full border border-border bg-card px-3 font-mono text-[13px] text-foreground/80 hover:bg-muted lg:min-h-9 lg:min-w-9"
                  }
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Stolik</Label>
            <Select value={resourceId} onValueChange={setResourceId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Wybierz stolik" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {options.map((table) => (
                  <SelectItem
                    key={table.id}
                    value={table.id}
                    disabled={table.busy}
                  >
                    <span className="font-mono">{table.number}</span>
                    <span className="text-muted-foreground">
                      {table.roomName}
                      {table.capacityMax !== null
                        ? ` · ${table.capacityMin ?? 1}–${table.capacityMax} os.`
                        : ""}
                      {table.busy && table.busyLabel
                        ? ` · ${table.busyLabel}`
                        : ""}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border border-dashed border-border bg-card px-3 py-2.5 text-xs text-foreground/80">
            Czas przy stole dla {partySize} os.:{" "}
            <b className="font-mono">{turnTimeMin} min</b> · start{" "}
            <b className="font-mono">{startLabel}</b>
          </div>

          {tooSmall ? (
            <p className="text-[12px] leading-snug text-warning-strong dark:text-warning">
              Wybrany stolik jest mniejszy niż liczba osób — posadzisz gości, ale
              sprawdź, czy się zmieszczą.
            </p>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="walkin-name">Nazwisko (opcjonalnie)</Label>
            <Input
              id="walkin-name"
              value={guestName}
              onChange={(event) => setGuestName(event.target.value)}
              placeholder="Gość z ulicy"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="walkin-note">Notatka (opcjonalnie)</Label>
            <Textarea
              id="walkin-note"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="np. przy oknie, płaci kartą"
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
            disabled={isPending || !resourceId}
          >
            {isPending ? "Zapisywanie…" : "Posadź gościa"}
          </Button>
        </DialogFooter>
      </PanelDialogContent>
    </Dialog>
  );
}
