"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  AREA_SHORT,
  fitsInGrid,
  findCollision,
  type PlanRoom,
  type PlanTable,
} from "@/app/panel/(dashboard)/sale/plan-utils";

/**
 * Siatka planu sali z przeciąganiem kafli (pointer events + snap do komórki).
 *
 * Rozmiar komórki żyje w zmiennej CSS `--cell`, więc pozycje da się wyliczyć
 * bez JS (poprawny render po stronie serwera), a matematyka przeciągania bierze
 * realny rozmiar komórki z `clientWidth / gridWidth`.
 *
 * Poniżej `md` (telefon) przeciąganie jest wyłączone przez `dragEnabled` —
 * plan służy do podglądu, a pozycję zmienia się polami X/Y w dialogu stolika.
 */

type DragState = {
  tableId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  cellW: number;
  cellH: number;
  originX: number;
  originY: number;
  posX: number;
  posY: number;
  moved: boolean;
};

const AREA_TILE: Record<PlanTable["area"], string> = {
  INDOOR: "bg-secondary border-border-strong",
  OUTDOOR: "bg-success-soft border-success-soft-border",
  BAR: "bg-warning-soft border-warning",
  PRIVATE: "bg-accent border-primary/40",
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export function FloorPlanGrid({
  room,
  canEdit,
  dragEnabled,
  movingId,
  onMove,
  onSelect,
}: {
  room: PlanRoom;
  canEdit: boolean;
  dragEnabled: boolean;
  movingId: string | null;
  onMove: (table: PlanTable, posX: number, posY: number) => void;
  onSelect: (table: PlanTable) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const [drag, setDrag] = useState<DragState | null>(null);

  const othersOf = (tableId: string) =>
    room.tables.filter((table) => table.id !== tableId);

  /** Wspólna walidacja dla przeciągania i klawiatury. */
  const validate = (table: PlanTable, posX: number, posY: number) => {
    const rect = { posX, posY, spanX: table.spanX, spanY: table.spanY };
    if (!fitsInGrid(rect, room.gridWidth, room.gridHeight)) {
      return { ok: false as const, error: "Stolik wychodzi poza siatkę sali" };
    }
    const collision = findCollision(rect, othersOf(table.id));
    if (collision) {
      return {
        ok: false as const,
        error: `Miejsce zajęte przez stolik ${collision.tableNumber}`,
      };
    }
    return { ok: true as const };
  };

  const setDragState = (next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const handlePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    table: PlanTable,
  ) => {
    if (!dragEnabled || !canEdit) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const grid = gridRef.current;
    if (!grid) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({
      tableId: table.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      cellW: grid.clientWidth / room.gridWidth,
      cellH: grid.clientHeight / room.gridHeight,
      originX: table.posX,
      originY: table.posY,
      posX: table.posX,
      posY: table.posY,
      moved: false,
    });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;

    const deltaX = Math.round((event.clientX - current.startClientX) / current.cellW);
    const deltaY = Math.round((event.clientY - current.startClientY) / current.cellH);
    // Kotwica kafla nie opuszcza siatki — inaczej dałoby się „zgubić" stolik
    // poza kadrem. Wystawanie prawą/dolną krawędzią jest widoczne jako błąd.
    const posX = clamp(current.originX + deltaX, 0, room.gridWidth - 1);
    const posY = clamp(current.originY + deltaY, 0, room.gridHeight - 1);
    if (posX === current.posX && posY === current.posY) return;

    setDragState({
      ...current,
      posX,
      posY,
      moved: current.moved || posX !== current.originX || posY !== current.originY,
    });
  };

  const handlePointerUp = (
    event: React.PointerEvent<HTMLButtonElement>,
    table: PlanTable,
  ) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragState(null);
    if (!current.moved) return;

    // Kliknięcie kończące przeciąganie nie może otworzyć dialogu.
    suppressClickRef.current = true;

    const result = validate(table, current.posX, current.posY);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    onMove(table, current.posX, current.posY);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    setDragState(null);
  };

  /** Strzałki = alternatywa dla myszy (dostępność + precyzja o jedną komórkę). */
  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    table: PlanTable,
  ) => {
    if (!canEdit) return;
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const posX = table.posX + step[0];
    const posY = table.posY + step[1];
    const result = validate(table, posX, posY);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    onMove(table, posX, posY);
  };

  return (
    <div className="overflow-x-auto overscroll-x-contain pb-2">
      <div
        ref={gridRef}
        data-testid="floor-plan-grid"
        data-grid-width={room.gridWidth}
        data-grid-height={room.gridHeight}
        className="relative [--cell:18px] sm:[--cell:24px] lg:[--cell:30px] xl:[--cell:40px]"
        style={{
          width: `calc(var(--cell) * ${room.gridWidth})`,
          height: `calc(var(--cell) * ${room.gridHeight})`,
          backgroundImage:
            "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
          backgroundSize: "var(--cell) var(--cell)",
        }}
      >
        {room.tables.map((table) => {
          const dragging = drag?.tableId === table.id;
          const posX = dragging ? drag.posX : table.posX;
          const posY = dragging ? drag.posY : table.posY;
          const invalid =
            dragging && !validate(table, drag.posX, drag.posY).ok;
          const compact = table.spanX < 2 || table.spanY < 2;

          return (
            <button
              key={table.id}
              type="button"
              data-testid={`table-tile-${table.tableNumber}`}
              data-table-id={table.id}
              data-pos-x={posX}
              data-pos-y={posY}
              aria-label={`Stolik ${table.tableNumber}, ${table.capacityMin}–${table.capacityMax} osób, ${AREA_SHORT[table.area]}`}
              disabled={!canEdit}
              onPointerDown={(event) => handlePointerDown(event, table)}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => handlePointerUp(event, table)}
              onPointerCancel={handlePointerCancel}
              onKeyDown={(event) => handleKeyDown(event, table)}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                onSelect(table);
              }}
              className={cn(
                "absolute p-[2px] transition-[left,top] duration-100",
                dragEnabled && canEdit
                  ? "cursor-grab touch-none active:cursor-grabbing"
                  : "cursor-pointer",
                dragging && "z-20 cursor-grabbing transition-none",
                movingId === table.id && "animate-pulse",
              )}
              style={{
                left: `calc(var(--cell) * ${posX})`,
                top: `calc(var(--cell) * ${posY})`,
                width: `calc(var(--cell) * ${table.spanX})`,
                height: `calc(var(--cell) * ${table.spanY})`,
              }}
            >
              <span
                className={cn(
                  "flex h-full w-full flex-col items-center justify-center overflow-hidden border-[1.5px] leading-none",
                  AREA_TILE[table.area],
                  table.shape === "ROUND" ? "rounded-full" : "rounded-lg",
                  !table.isActive && "opacity-45 grayscale",
                  dragging && "shadow-lg",
                  invalid &&
                    "border-destructive bg-destructive/20 text-destructive",
                )}
              >
                <span
                  className={cn(
                    "font-display font-extrabold tracking-tight",
                    compact ? "text-[9px]" : "text-[11px] sm:text-[13px]",
                  )}
                >
                  {table.tableNumber}
                </span>
                {!compact && (
                  <span className="mt-0.5 font-mono text-[8px] text-muted-foreground sm:text-[9px]">
                    {table.capacityMin}–{table.capacityMax}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
