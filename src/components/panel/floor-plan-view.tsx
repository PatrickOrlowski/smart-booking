"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PanelDialogBody,
  PanelDialogContent,
} from "@/components/panel/panel-dialog";
import { FloorPlanGrid } from "@/components/panel/floor-plan-grid";
import { runAction } from "@/components/panel/run-action";
import {
  TableDialog,
  type TableEditorState,
} from "@/components/panel/table-dialog";
import { cn } from "@/lib/utils";
import {
  AREA_SHORT,
  GRID_MAX,
  GRID_MIN,
  SHAPE_LABELS,
  SPAN_MAX,
  SPAN_MIN,
  firstFreeCell,
  fitsInGrid,
  findCollision,
  type PlanRoom,
  type PlanTable,
} from "@/app/panel/(dashboard)/sale/plan-utils";

/** Górna granica pojemności stolika — lustro schematu Zod w sale/actions.ts. */
const CAPACITY_MAX = 50;
import {
  deleteRoomAction,
  deleteTableAction,
  moveTableAction,
  saveRoomAction,
  saveTableAction,
} from "@/app/panel/(dashboard)/sale/actions";

/**
 * Sale i plan sali — lista sal po lewej, edytor planu po prawej.
 *
 * Przesunięcie kafla zapisuje się optymistycznie: pozycja zmienia się od razu,
 * a odrzucenie przez serwer cofa ją i pokazuje powód.
 */

type RoomEditorState = {
  roomId: string | null;
  name: string;
  gridWidth: string;
  gridHeight: string;
  tableCount: number;
};

const numberOrNaN = (value: string) => {
  const parsed = Number(value.trim());
  return value.trim() === "" ? Number.NaN : parsed;
};

export function FloorPlanView({
  businessId,
  locationId,
  rooms,
  unassignedTables,
  isManager,
}: {
  businessId: string;
  locationId: string;
  rooms: PlanRoom[];
  /** Stoliki bez sali — nie renderują się na żadnym planie, ale istnieją. */
  unassignedTables: PlanTable[];
  isManager: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(
    rooms[0]?.id ?? null,
  );
  const [roomEditor, setRoomEditor] = useState<RoomEditorState | null>(null);
  const [tableEditor, setTableEditor] = useState<TableEditorState | null>(null);
  const [overrides, setOverrides] = useState<
    Record<string, { posX: number; posY: number }>
  >({});
  const [movingId, setMovingId] = useState<string | null>(null);
  const [dragEnabled, setDragEnabled] = useState(false);

  // Przeciąganie tylko od tabletu w górę — na telefonie plan jest do podglądu,
  // a pozycję ustawia się polami X/Y w dialogu stolika.
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const sync = () => setDragEnabled(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const roomsWithOverrides = useMemo(
    () =>
      rooms.map((room) => ({
        ...room,
        tables: room.tables.map((table) => ({
          ...table,
          ...(overrides[table.id] ?? {}),
        })),
      })),
    [rooms, overrides],
  );

  const selectedRoom =
    roomsWithOverrides.find((room) => room.id === selectedRoomId) ??
    roomsWithOverrides[0] ??
    null;

  const emptyRoomEditor = (): RoomEditorState => ({
    roomId: null,
    name: "",
    gridWidth: "20",
    gridHeight: "14",
    tableCount: 0,
  });

  const saveRoom = () => {
    if (!roomEditor) return;
    const gridWidth = numberOrNaN(roomEditor.gridWidth);
    const gridHeight = numberOrNaN(roomEditor.gridHeight);
    if (
      !Number.isFinite(gridWidth) ||
      !Number.isFinite(gridHeight) ||
      gridWidth < GRID_MIN ||
      gridHeight < GRID_MIN ||
      gridWidth > GRID_MAX ||
      gridHeight > GRID_MAX
    ) {
      toast.error(`Rozmiar siatki: od ${GRID_MIN} do ${GRID_MAX} komórek`);
      return;
    }
    startTransition(async () => {
      const result = await runAction(() =>
        saveRoomAction({
          businessId,
          locationId,
          roomId: roomEditor.roomId ?? undefined,
          name: roomEditor.name.trim(),
          gridWidth,
          gridHeight,
        }),
      );
      if (result.ok) {
        toast.success(roomEditor.roomId ? "Zapisano salę" : "Sala dodana");
        setRoomEditor(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const removeRoom = () => {
    if (!roomEditor?.roomId) return;
    startTransition(async () => {
      const result = await runAction(() =>
        deleteRoomAction({ businessId, roomId: roomEditor.roomId! }),
      );
      if (result.ok) {
        toast.success("Sala usunięta");
        setRoomEditor(null);
        setSelectedRoomId(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const openNewTable = () => {
    if (!selectedRoom) return;
    const spot = firstFreeCell(
      selectedRoom.tables,
      selectedRoom.gridWidth,
      selectedRoom.gridHeight,
      2,
      2,
    );
    if (!spot) {
      toast.error("Brak wolnego miejsca na planie — powiększ salę");
      return;
    }
    setTableEditor({
      tableId: null,
      roomId: selectedRoom.id,
      tableNumber: "",
      capacityMin: "2",
      capacityMax: "4",
      shape: "SQUARE",
      area: "INDOOR",
      combinable: false,
      isActive: true,
      posX: String(spot.posX + 1),
      posY: String(spot.posY + 1),
      spanX: "2",
      spanY: "2",
      hasBookings: false,
    });
  };

  const openTable = (table: PlanTable) => {
    setTableEditor({
      tableId: table.id,
      roomId: table.roomId,
      tableNumber: table.tableNumber,
      capacityMin: String(table.capacityMin),
      capacityMax: String(table.capacityMax),
      shape: table.shape,
      area: table.area,
      combinable: table.combinable,
      isActive: table.isActive,
      posX: String(table.posX + 1),
      posY: String(table.posY + 1),
      spanX: String(table.spanX),
      spanY: String(table.spanY),
      hasBookings: table.hasBookings,
    });
  };

  const saveTable = () => {
    if (!tableEditor) return;
    const capacityMin = numberOrNaN(tableEditor.capacityMin);
    const capacityMax = numberOrNaN(tableEditor.capacityMax);
    const posX = numberOrNaN(tableEditor.posX) - 1;
    const posY = numberOrNaN(tableEditor.posY) - 1;
    const spanX = numberOrNaN(tableEditor.spanX);
    const spanY = numberOrNaN(tableEditor.spanY);

    // Te same granice co w schemacie Zod na serwerze — atrybut `max` na
    // <Input type="number"> niczego nie blokuje, bo zapis idzie z onClick,
    // a nie z submitu formularza.
    if (
      !Number.isFinite(capacityMin) ||
      !Number.isFinite(capacityMax) ||
      capacityMin < 1 ||
      capacityMax < capacityMin
    ) {
      toast.error("Pojemność: minimum 1 osoba, a „do” nie mniej niż „od”");
      return;
    }
    if (capacityMax > CAPACITY_MAX) {
      toast.error(`Pojemność: maksymalnie ${CAPACITY_MAX} osób przy stoliku`);
      return;
    }
    if (
      !Number.isFinite(posX) ||
      !Number.isFinite(posY) ||
      !Number.isFinite(spanX) ||
      !Number.isFinite(spanY)
    ) {
      toast.error("Podaj pozycję i rozmiar kafla");
      return;
    }
    if (
      spanX < SPAN_MIN ||
      spanY < SPAN_MIN ||
      spanX > SPAN_MAX ||
      spanY > SPAN_MAX
    ) {
      toast.error(`Rozmiar kafla: od ${SPAN_MIN} do ${SPAN_MAX} komórek`);
      return;
    }

    const targetRoom = roomsWithOverrides.find(
      (room) => room.id === tableEditor.roomId,
    );
    if (!targetRoom) {
      toast.error("Wybierz salę");
      return;
    }
    const rect = { posX, posY, spanX, spanY };
    if (!fitsInGrid(rect, targetRoom.gridWidth, targetRoom.gridHeight)) {
      toast.error(
        `Stolik nie mieści się w siatce ${targetRoom.gridWidth} × ${targetRoom.gridHeight}`,
      );
      return;
    }
    const collision = findCollision(
      rect,
      targetRoom.tables.filter((table) => table.id !== tableEditor.tableId),
    );
    if (collision) {
      toast.error(`Miejsce zajęte przez stolik ${collision.tableNumber}`);
      return;
    }

    startTransition(async () => {
      const result = await runAction(() =>
        saveTableAction({
          businessId,
          locationId,
          tableId: tableEditor.tableId ?? undefined,
          roomId: tableEditor.roomId,
          tableNumber: tableEditor.tableNumber.trim(),
          capacityMin,
          capacityMax,
          shape: tableEditor.shape,
          area: tableEditor.area,
          combinable: tableEditor.combinable,
          isActive: tableEditor.isActive,
          posX,
          posY,
          spanX,
          spanY,
        }),
      );
      if (result.ok) {
        toast.success(tableEditor.tableId ? "Zapisano stolik" : "Stolik dodany");
        setTableEditor(null);
        setSelectedRoomId(tableEditor.roomId);
        setOverrides({});
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const removeTable = () => {
    if (!tableEditor?.tableId) return;
    startTransition(async () => {
      const result = await runAction(() =>
        deleteTableAction({ businessId, tableId: tableEditor.tableId! }),
      );
      if (result.ok) {
        toast.success(
          "deactivated" in result && result.deactivated
            ? "Stolik ma rezerwacje w historii — został wyłączony"
            : "Stolik usunięty",
        );
        setTableEditor(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const moveTable = (table: PlanTable, posX: number, posY: number) => {
    setOverrides((prev) => ({ ...prev, [table.id]: { posX, posY } }));
    setMovingId(table.id);
    startTransition(async () => {
      const result = await runAction(() =>
        moveTableAction({ businessId, tableId: table.id, posX, posY }),
      );
      // Zawsze — także po błędzie sieci — inaczej kafel pulsuje bez końca.
      setMovingId(null);
      if (result.ok) {
        toast.success(
          `Stolik ${table.tableNumber} → kolumna ${posX + 1}, wiersz ${posY + 1}`,
        );
        router.refresh();
      } else {
        setOverrides((prev) => {
          const next = { ...prev };
          delete next[table.id];
          return next;
        });
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {unassignedTables.length > 0 && (
        <div className="rounded-xl border border-warning bg-warning-soft px-3.5 py-2.5 text-[12.5px] text-warning-strong">
          <p>
            {unassignedTables.length} stolik(ów) nie ma przypisanej sali — nie
            widać ich na żadnym planie ani w rezerwacjach online.
            {isManager
              ? " Otwórz stolik i wskaż salę, żeby wrócił na plan."
              : ""}
          </p>
          {/* Baner musi prowadzić do naprawy: osierocony stolik nie renderuje
              się na żadnym planie ani na liście sali, więc bez tej sekcji nie
              da się go w ogóle otworzyć w dialogu. */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {unassignedTables.map((table) => (
              <button
                key={table.id}
                type="button"
                disabled={!isManager}
                onClick={() => openTable(table)}
                className="flex min-h-11 items-center gap-1.5 rounded-full border border-warning bg-card px-3 font-mono text-[11.5px] font-semibold text-foreground disabled:opacity-60 lg:min-h-8"
              >
                {table.tableNumber}
                <span className="text-muted-foreground">
                  {table.capacityMin}–{table.capacityMax} os.
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="meta-label">Sale ({rooms.length})</span>
            {isManager && (
              <Button
                variant="outline"
                className="h-8 rounded-full px-3 text-xs font-semibold max-lg:h-11"
                onClick={() => setRoomEditor(emptyRoomEditor())}
              >
                + Dodaj salę
              </Button>
            )}
          </div>

          {rooms.length === 0 ? (
            <p className="rounded-xl border border-border bg-card px-3.5 py-4 text-[12.5px] text-muted-foreground">
              Brak sal. Dodaj pierwszą — plan sali powstaje na jej siatce.
            </p>
          ) : (
            <div className="flex gap-2.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
              {roomsWithOverrides.map((room) => {
                const seats = room.tables.reduce(
                  (sum, table) => sum + table.capacityMax,
                  0,
                );
                const areas = [...new Set(room.tables.map((t) => t.area))];
                const active = selectedRoom?.id === room.id;
                return (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => setSelectedRoomId(room.id)}
                    className={cn(
                      "shrink-0 rounded-2xl bg-card px-3.5 py-3 text-left transition-colors lg:w-full lg:shrink",
                      active
                        ? "border-[1.5px] border-border-strong"
                        : "border border-border hover:bg-muted",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13.5px] font-semibold">
                        {room.name}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {room.gridWidth}×{room.gridHeight}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {room.tables.length} stolik
                      {room.tables.length === 1
                        ? ""
                        : room.tables.length < 5
                          ? "i"
                          : "ów"}{" "}
                      · {seats} miejsc
                    </div>
                    {areas.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {areas.map((area) => (
                          <span
                            key={area}
                            className="rounded-full bg-muted px-2 py-0.5 font-mono text-[9px] tracking-[0.06em] uppercase"
                          >
                            {AREA_SHORT[area]}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <section className="min-w-0 rounded-2xl border border-border bg-card p-4">
          {!selectedRoom ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <h2 className="font-display text-xl font-extrabold tracking-tight">
                Nie ma jeszcze planu
              </h2>
              <p className="max-w-sm text-[13px] text-muted-foreground">
                Dodaj salę, a potem rozstaw na niej stoliki — z tego planu
                korzysta dobór stolika przy rezerwacji.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate font-display text-[17px] font-extrabold tracking-tight">
                    {selectedRoom.name}
                  </h2>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    siatka {selectedRoom.gridWidth} × {selectedRoom.gridHeight} ·{" "}
                    {selectedRoom.tables.length} stolików
                  </p>
                </div>
                {isManager && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="h-8 rounded-full px-3.5 text-xs font-semibold max-lg:h-11"
                      onClick={() =>
                        setRoomEditor({
                          roomId: selectedRoom.id,
                          name: selectedRoom.name,
                          gridWidth: String(selectedRoom.gridWidth),
                          gridHeight: String(selectedRoom.gridHeight),
                          tableCount: selectedRoom.tables.length,
                        })
                      }
                    >
                      Edytuj salę
                    </Button>
                    <Button
                      className="h-8 rounded-full px-3.5 text-xs font-semibold max-lg:h-11"
                      onClick={openNewTable}
                    >
                      + Dodaj stolik
                    </Button>
                  </div>
                )}
              </div>

              <p className="mb-2.5 text-[11.5px] text-muted-foreground">
                {dragEnabled
                  ? "Przeciągnij kafel, żeby zmienić miejsce — pozycja zapisuje się po upuszczeniu. Strzałki przesuwają o jedną komórkę."
                  : "Na telefonie plan jest do podglądu — pozycję zmienisz polami X/Y w edycji stolika."}
              </p>

              <FloorPlanGrid
                room={selectedRoom}
                canEdit={isManager}
                dragEnabled={dragEnabled && isManager}
                movingId={movingId}
                onMove={moveTable}
                onSelect={openTable}
              />

              {selectedRoom.tables.length > 0 && (
                <div className="mt-4">
                  <div className="meta-label mb-1.5">Stoliki</div>
                  <div className="overflow-hidden rounded-xl border border-border xl:grid xl:grid-cols-2">
                    {[...selectedRoom.tables]
                      .sort((a, b) =>
                        a.tableNumber.localeCompare(b.tableNumber, "pl", {
                          numeric: true,
                        }),
                      )
                      .map((table) => (
                        <button
                          key={table.id}
                          type="button"
                          disabled={!isManager}
                          onClick={() => openTable(table)}
                          className={cn(
                            "flex min-h-11 w-full items-center gap-3 border-b border-muted px-3 py-2 text-left last:border-b-0 disabled:opacity-70 xl:odd:border-r",
                            isManager && "hover:bg-muted",
                            !table.isActive && "opacity-55",
                          )}
                        >
                          <span className="w-10 shrink-0 font-display text-[13px] font-extrabold">
                            {table.tableNumber}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                            {SHAPE_LABELS[table.shape]} ·{" "}
                            {AREA_SHORT[table.area]}
                            {table.combinable ? " · zestawialny" : ""}
                            {table.isActive ? "" : " · wyłączony"}
                          </span>
                          <span className="shrink-0 font-mono text-[11.5px]">
                            {table.capacityMin}–{table.capacityMax} os.
                          </span>
                          <span className="hidden shrink-0 font-mono text-[10.5px] text-muted-foreground sm:block">
                            X{table.posX + 1} Y{table.posY + 1}
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <Dialog
        open={roomEditor !== null}
        onOpenChange={(open) => {
          if (!open) setRoomEditor(null);
        }}
      >
        <PanelDialogContent className="sm:max-w-md">
          {roomEditor && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {roomEditor.roomId ? "Edycja sali" : "Nowa sala"}
                </DialogTitle>
                <DialogDescription>
                  Siatka to układ współrzędnych planu — im większa, tym
                  precyzyjniej rozstawisz stoliki.
                </DialogDescription>
              </DialogHeader>

              <PanelDialogBody>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="room-name">Nazwa sali</Label>
                  <Input
                    id="room-name"
                    value={roomEditor.name}
                    onChange={(event) =>
                      setRoomEditor({ ...roomEditor, name: event.target.value })
                    }
                    placeholder="np. Sala główna"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="room-grid-width">Szerokość siatki</Label>
                    <Input
                      id="room-grid-width"
                      type="number"
                      min={GRID_MIN}
                      max={GRID_MAX}
                      className="font-mono"
                      value={roomEditor.gridWidth}
                      onChange={(event) =>
                        setRoomEditor({
                          ...roomEditor,
                          gridWidth: event.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="room-grid-height">Wysokość siatki</Label>
                    <Input
                      id="room-grid-height"
                      type="number"
                      min={GRID_MIN}
                      max={GRID_MAX}
                      className="font-mono"
                      value={roomEditor.gridHeight}
                      onChange={(event) =>
                        setRoomEditor({
                          ...roomEditor,
                          gridHeight: event.target.value,
                        })
                      }
                    />
                  </div>
                </div>
                {roomEditor.roomId && roomEditor.tableCount > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Sala ma {roomEditor.tableCount} stolików — zmniejszenie
                    siatki nie może wypchnąć żadnego poza plan.
                  </p>
                )}
              </PanelDialogBody>

              <DialogFooter className="sm:justify-between">
                {roomEditor.roomId ? (
                  <Button
                    variant="destructive"
                    className="rounded-full max-lg:h-11"
                    onClick={removeRoom}
                    disabled={isPending}
                  >
                    Usuń salę
                  </Button>
                ) : (
                  <span className="max-sm:hidden" />
                )}
                <div className="flex gap-2 max-sm:flex-col-reverse">
                  <Button
                    variant="outline"
                    className="rounded-full max-lg:h-11"
                    onClick={() => setRoomEditor(null)}
                    disabled={isPending}
                  >
                    Anuluj
                  </Button>
                  <Button
                    className="rounded-full font-semibold max-lg:h-11"
                    onClick={saveRoom}
                    disabled={isPending || roomEditor.name.trim().length < 2}
                  >
                    {isPending ? "Zapisywanie…" : "Zapisz"}
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </PanelDialogContent>
      </Dialog>

      <TableDialog
        editor={tableEditor}
        rooms={roomsWithOverrides}
        isPending={isPending}
        onChange={setTableEditor}
        onClose={() => setTableEditor(null)}
        onSave={saveTable}
        onDelete={removeTable}
      />
    </div>
  );
}
