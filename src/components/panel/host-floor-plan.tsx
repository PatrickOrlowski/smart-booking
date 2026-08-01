"use client";

import { cn } from "@/lib/utils";
import type { RestaurantArea, TableShape } from "@/generated/prisma/enums";

/**
 * Plan sali restauracji — stoliki rozłożone na siatce `Room.gridWidth ×
 * gridHeight`. Pozycje idą w procentach kontenera o stałym `aspect-ratio`,
 * dzięki czemu ten sam plan skaluje się od 390 px do desktopu bez poziomego
 * przewijania strony.
 *
 * Komponent jest czysto prezentacyjny: statusy stolików wylicza
 * `HostDayView` dla wybranej chwili (w strefie lokalu).
 */

export type TableStatus = "free" | "reserved" | "occupied" | "cleaning";

export type HostTable = {
  id: string;
  /** Numer widoczny dla obsługi: „12", „T3". */
  number: string;
  name: string;
  capacityMin: number | null;
  capacityMax: number | null;
  area: RestaurantArea | null;
  shape: TableShape | null;
  posX: number | null;
  posY: number | null;
  spanX: number;
  spanY: number;
};

export type HostRoom = {
  id: string;
  name: string;
  gridWidth: number;
  gridHeight: number;
  tables: HostTable[];
};

export type TableState = {
  status: TableStatus;
  /** Krótki opis do dymka i podpisu: „Nowak · 4 os. · 19:30–21:15". */
  detail: string | null;
  /** Godzina, od której stolik jest zajęty/zarezerwowany. */
  timeLabel: string | null;
};

export const TABLE_STATUS_LABELS: Record<TableStatus, string> = {
  free: "wolny",
  reserved: "zarezerwowany",
  occupied: "zajęty",
  cleaning: "do posprzątania",
};

const STATUS_CLASSES: Record<TableStatus, string> = {
  free: "border-border bg-card text-muted-foreground",
  reserved:
    "border-warning/60 bg-warning-soft text-warning-strong dark:text-warning",
  occupied: "border-primary bg-primary text-primary-foreground",
  cleaning: "photo-placeholder border-border text-muted-foreground",
};

export const STATUS_SWATCH: Record<TableStatus, string> = {
  free: "border border-border bg-card",
  reserved: "border border-warning/60 bg-warning-soft",
  occupied: "bg-primary",
  cleaning: "photo-placeholder border border-border",
};

function shapeClass(shape: TableShape | null, spanX: number, spanY: number) {
  if (shape === "ROUND" && spanX === spanY) return "rounded-full";
  if (shape === "ROUND") return "rounded-[999px]";
  return "rounded-md";
}

function capacityLabel(table: HostTable): string {
  if (table.capacityMin === null && table.capacityMax === null) return "";
  if (table.capacityMax === null) return `${table.capacityMin}+`;
  if (table.capacityMin === null || table.capacityMin === table.capacityMax) {
    return `${table.capacityMax}`;
  }
  return `${table.capacityMin}–${table.capacityMax}`;
}

export function HostFloorPlan({
  room,
  states,
  selectedLabel,
}: {
  room: HostRoom;
  states: Map<string, TableState>;
  /** Godzina podglądu — pokazywana w nagłówku sali. */
  selectedLabel: string;
}) {
  const placed = room.tables.filter(
    (table) => table.posX !== null && table.posY !== null,
  );
  const unplaced = room.tables.filter(
    (table) => table.posX === null || table.posY === null,
  );

  return (
    <section className="flex flex-col gap-2">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className="font-display text-[15px] font-extrabold tracking-tight">
          {room.name}
        </h3>
        <span className="meta-label">
          {room.tables.length} stolików · {selectedLabel}
        </span>
      </header>

      {placed.length === 0 ? null : (
      <div
        className="relative w-full overflow-hidden rounded-2xl border border-border bg-muted/50 [background-image:linear-gradient(to_right,color-mix(in_oklab,var(--border)_55%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--border)_55%,transparent)_1px,transparent_1px)]"
        style={{
          aspectRatio: `${room.gridWidth} / ${room.gridHeight}`,
          backgroundSize: `${100 / room.gridWidth}% ${100 / room.gridHeight}%`,
        }}
      >
        {placed.map((table) => {
          const state = states.get(table.id);
          const status = state?.status ?? "free";
          const capacity = capacityLabel(table);
          const title = [
            `Stolik ${table.number}`,
            capacity ? `${capacity} os.` : null,
            TABLE_STATUS_LABELS[status],
            state?.detail,
          ]
            .filter(Boolean)
            .join(" · ");

          return (
            <div
              key={table.id}
              className="absolute p-[1.5px]"
              style={{
                left: `${((table.posX ?? 0) / room.gridWidth) * 100}%`,
                top: `${((table.posY ?? 0) / room.gridHeight) * 100}%`,
                width: `${(table.spanX / room.gridWidth) * 100}%`,
                height: `${(table.spanY / room.gridHeight) * 100}%`,
              }}
            >
              <div
                title={title}
                aria-label={title}
                className={cn(
                  "flex size-full flex-col items-center justify-center overflow-hidden border-[1.5px] text-center transition-colors",
                  shapeClass(table.shape, table.spanX, table.spanY),
                  STATUS_CLASSES[status],
                )}
              >
                <span className="font-mono text-[10px] leading-none font-medium sm:text-[11px]">
                  {table.number}
                </span>
                {table.spanX >= 3 && table.spanY >= 3 && state?.timeLabel ? (
                  <span className="mt-0.5 font-mono text-[8px] leading-none opacity-80 sm:text-[9px]">
                    {state.timeLabel}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {unplaced.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="meta-label">poza planem</span>
          {unplaced.map((table) => {
            const status = states.get(table.id)?.status ?? "free";
            return (
              <span
                key={table.id}
                className={cn(
                  "rounded-full border px-2 py-1 font-mono text-[11px]",
                  STATUS_CLASSES[status],
                )}
              >
                {table.number}
              </span>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
