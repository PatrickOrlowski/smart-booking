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
import { formatMinutes } from "@/components/panel/format";
import { turnTimeFor } from "@/components/restaurant/types";
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
  /**
   * Stolik zajęty (albo w buforze sprzątania) już w chwili startu walk-inu —
   * gotowa etykieta „zajęty do 21:00". null = wolny na starcie.
   */
  occupiedLabel: string | null;
  /**
   * Początek najbliższej rezerwacji PO starcie walk-inu (minuty czasu lokalu).
   * null = do końca dnia nic nie stoi na przeszkodzie. Turn time zależy od
   * liczby osób, więc dopiero dialog wie, czy pobyt się w tym zmieści.
   */
  freeUntilMin: number | null;
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
  tableBufferMin,
  startMin,
  closeMin,
  startLabel,
  disabled,
}: {
  businessId: string;
  tables: WalkInTableOption[];
  turnTimeRules: TurnTimeRuleView[];
  defaultTurnTimeMin: number;
  /** Bufor sprzątania doliczany po wyjściu gości. */
  tableBufferMin: number;
  /** Minuta startu walk-inu w czasie lokalu; null = lokal zamknięty. */
  startMin: number | null;
  /** Zamknięcie okna, w którym wypada walk-in; null = lokal zamknięty. */
  closeMin: number | null;
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

  // Jedno źródło reguły turn time dla klienta — łącznie z zachowaniem dla grup
  // powyżej najwyższej reguły (dostają jej czas, nie wartość domyślną).
  const turnTimeMin = useMemo(
    () => turnTimeFor(turnTimeRules, partySize, defaultTurnTimeMin),
    [turnTimeRules, partySize, defaultTurnTimeMin],
  );

  /**
   * Koniec blokady, jaką założy serwer: pobyt przycięty do zamknięcia plus
   * bufor sprzątania. Wcześniej lista sprawdzała kolizję tylko w bieżącej
   * minucie, więc stolik z rezerwacją za godzinę wyglądał na wolny, a akcja
   * i tak kończyła się błędem 23P01.
   */
  const blockedEndMin =
    startMin === null
      ? null
      : Math.min(startMin + turnTimeMin, closeMin ?? startMin + turnTimeMin) +
        tableBufferMin;

  const rows = useMemo(() => {
    const decorated = tables.map((table) => {
      const tooEarly = table.occupiedLabel !== null;
      const collides =
        !tooEarly &&
        blockedEndMin !== null &&
        table.freeUntilMin !== null &&
        table.freeUntilMin < blockedEndMin;
      return {
        table,
        busy: tooEarly || collides,
        busyLabel: tooEarly
          ? table.occupiedLabel
          : collides
            ? `wolny tylko do ${formatMinutes(table.freeUntilMin!)}`
            : null,
      };
    });
    // Wolne stoliki na górze listy, w każdej grupie sensowna pojemność najpierw.
    return decorated.sort((a, b) => {
      if (a.busy !== b.busy) return a.busy ? 1 : -1;
      const fitsA = (a.table.capacityMax ?? 99) >= partySize ? 0 : 1;
      const fitsB = (b.table.capacityMax ?? 99) >= partySize ? 0 : 1;
      if (fitsA !== fitsB) return fitsA - fitsB;
      return a.table.number.localeCompare(b.table.number, "pl", {
        numeric: true,
      });
    });
  }, [tables, partySize, blockedEndMin]);

  const selected = rows.find((row) => row.table.id === resourceId)?.table ?? null;
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
                {rows.map(({ table, busy, busyLabel }) => (
                  <SelectItem key={table.id} value={table.id} disabled={busy}>
                    <span className="font-mono">{table.number}</span>
                    <span className="text-muted-foreground">
                      {table.roomName}
                      {table.capacityMax !== null
                        ? ` · ${table.capacityMin ?? 1}–${table.capacityMax} os.`
                        : ""}
                      {busy && busyLabel ? ` · ${busyLabel}` : ""}
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
