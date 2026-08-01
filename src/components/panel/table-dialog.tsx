"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  PanelDialogBody,
  PanelDialogContent,
} from "@/components/panel/panel-dialog";
import { cn } from "@/lib/utils";
import { RestaurantArea, TableShape } from "@/generated/prisma/enums";
import {
  AREA_LABELS,
  SHAPE_LABELS,
  SPAN_MAX,
  type PlanRoom,
} from "@/app/panel/(dashboard)/sale/plan-utils";

/**
 * Dialog dodania/edycji stolika.
 *
 * Pola X/Y są jedyną drogą ustawienia pozycji na telefonie (tam plan jest
 * tylko do podglądu), więc są dostępne na każdym rozmiarze — także wtedy,
 * gdy na desktopie kafel przesuwa się myszą.
 */

export type TableEditorState = {
  tableId: string | null;
  roomId: string;
  tableNumber: string;
  capacityMin: string;
  capacityMax: string;
  shape: TableShape;
  area: RestaurantArea;
  combinable: boolean;
  isActive: boolean;
  /** Pozycja i rozmiar w jednostkach siatki — X/Y prezentowane od 1. */
  posX: string;
  posY: string;
  spanX: string;
  spanY: string;
  hasBookings: boolean;
};

export function TableDialog({
  editor,
  rooms,
  isPending,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  editor: TableEditorState | null;
  rooms: PlanRoom[];
  isPending: boolean;
  onChange: (next: TableEditorState) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const room = rooms.find((candidate) => candidate.id === editor?.roomId);

  return (
    <Dialog
      open={editor !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PanelDialogContent className="sm:max-h-[90vh] sm:max-w-lg sm:overflow-y-auto">
        {editor && (
          <>
            <DialogHeader>
              <DialogTitle>
                {editor.tableId
                  ? `Stolik ${editor.tableNumber || "—"}`
                  : "Nowy stolik"}
              </DialogTitle>
              <DialogDescription>
                Pojemność steruje doborem stolika pod liczbę osób, pozycja X/Y —
                miejscem kafla na planie sali.
              </DialogDescription>
            </DialogHeader>

            <PanelDialogBody>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="table-number">Numer</Label>
                  <Input
                    id="table-number"
                    className="font-mono"
                    value={editor.tableNumber}
                    maxLength={10}
                    onChange={(event) =>
                      onChange({ ...editor, tableNumber: event.target.value })
                    }
                    placeholder="np. 12 albo T3"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="table-room">Sala</Label>
                  <Select
                    value={editor.roomId}
                    onValueChange={(value) =>
                      onChange({ ...editor, roomId: value })
                    }
                  >
                    <SelectTrigger id="table-room" className="w-full">
                      <SelectValue placeholder="Wybierz salę" />
                    </SelectTrigger>
                    <SelectContent>
                      {rooms.map((candidate) => (
                        <SelectItem key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="table-capacity-min">Pojemność od</Label>
                  <Input
                    id="table-capacity-min"
                    type="number"
                    min={1}
                    max={50}
                    className="font-mono"
                    value={editor.capacityMin}
                    onChange={(event) =>
                      onChange({ ...editor, capacityMin: event.target.value })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="table-capacity-max">Pojemność do</Label>
                  <Input
                    id="table-capacity-max"
                    type="number"
                    min={1}
                    max={50}
                    className="font-mono"
                    value={editor.capacityMax}
                    onChange={(event) =>
                      onChange({ ...editor, capacityMax: event.target.value })
                    }
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Kształt</Label>
                <div className="flex flex-wrap gap-1.5">
                  {Object.values(TableShape).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => onChange({ ...editor, shape: value })}
                      className={cn(
                        "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors max-lg:min-h-11",
                        editor.shape === value
                          ? "bg-ink text-ink-foreground"
                          : "border border-border bg-card text-foreground/80",
                      )}
                    >
                      {SHAPE_LABELS[value]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="table-area">Strefa</Label>
                <Select
                  value={editor.area}
                  onValueChange={(value) =>
                    onChange({ ...editor, area: value as RestaurantArea })
                  }
                >
                  <SelectTrigger id="table-area" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(RestaurantArea).map((value) => (
                      <SelectItem key={value} value={value}>
                        {AREA_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-xl border border-border bg-card p-3.5">
                <div className="meta-label mb-2.5">Miejsce na planie</div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="table-pos-x">X (kolumna)</Label>
                    <Input
                      id="table-pos-x"
                      type="number"
                      min={1}
                      max={room?.gridWidth ?? 40}
                      className="font-mono"
                      value={editor.posX}
                      onChange={(event) =>
                        onChange({ ...editor, posX: event.target.value })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="table-pos-y">Y (wiersz)</Label>
                    <Input
                      id="table-pos-y"
                      type="number"
                      min={1}
                      max={room?.gridHeight ?? 40}
                      className="font-mono"
                      value={editor.posY}
                      onChange={(event) =>
                        onChange({ ...editor, posY: event.target.value })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="table-span-x">Szerokość</Label>
                    <Input
                      id="table-span-x"
                      type="number"
                      min={1}
                      max={SPAN_MAX}
                      className="font-mono"
                      value={editor.spanX}
                      onChange={(event) =>
                        onChange({ ...editor, spanX: event.target.value })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="table-span-y">Wysokość</Label>
                    <Input
                      id="table-span-y"
                      type="number"
                      min={1}
                      max={SPAN_MAX}
                      className="font-mono"
                      value={editor.spanY}
                      onChange={(event) =>
                        onChange({ ...editor, spanY: event.target.value })
                      }
                    />
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {room
                    ? `Siatka sali ${room.name}: ${room.gridWidth} × ${room.gridHeight} komórek.`
                    : "Wybierz salę, żeby poznać rozmiar siatki."}{" "}
                  Na komputerze kafel przesuniesz też myszą.
                </p>
              </div>

              <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">
                    Można zestawiać
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                    Stolik wchodzi w skład zestawień dla większych grup.
                  </span>
                </span>
                <Switch
                  checked={editor.combinable}
                  onCheckedChange={(checked) =>
                    onChange({ ...editor, combinable: checked === true })
                  }
                />
              </label>

              <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">
                    Stolik dostępny
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                    Wyłączony nie przyjmuje nowych rezerwacji, ale zostaje na
                    planie.
                  </span>
                </span>
                <Switch
                  checked={editor.isActive}
                  onCheckedChange={(checked) =>
                    onChange({ ...editor, isActive: checked === true })
                  }
                />
              </label>
            </PanelDialogBody>

            <DialogFooter className="sm:justify-between">
              {editor.tableId ? (
                <Button
                  variant="destructive"
                  className="rounded-full max-lg:h-11"
                  onClick={onDelete}
                  disabled={isPending}
                >
                  {editor.hasBookings ? "Wyłącz stolik" : "Usuń stolik"}
                </Button>
              ) : (
                <span className="max-sm:hidden" />
              )}
              <div className="flex gap-2 max-sm:flex-col-reverse">
                <Button
                  variant="outline"
                  className="rounded-full max-lg:h-11"
                  onClick={onClose}
                  disabled={isPending}
                >
                  Anuluj
                </Button>
                <Button
                  className="rounded-full font-semibold max-lg:h-11"
                  onClick={onSave}
                  disabled={isPending || editor.tableNumber.trim().length === 0}
                >
                  {isPending ? "Zapisywanie…" : "Zapisz"}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </PanelDialogContent>
    </Dialog>
  );
}
