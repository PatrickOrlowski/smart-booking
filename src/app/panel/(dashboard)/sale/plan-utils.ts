import type { RestaurantArea, TableShape } from "@/generated/prisma/enums";

/**
 * Słowniki etykiet i geometria planu sali.
 *
 * Moduł bez zależności serwerowych — te same reguły kolizji obowiązują
 * w komponencie klienckim (natychmiastowy komunikat przy upuszczeniu kafla)
 * i w server action (ostateczne słowo, bo klient da się oszukać).
 */

export const AREA_LABELS: Record<RestaurantArea, string> = {
  INDOOR: "Wewnątrz",
  OUTDOOR: "Taras / ogródek",
  BAR: "Bar",
  PRIVATE: "Sala prywatna",
};

export const AREA_SHORT: Record<RestaurantArea, string> = {
  INDOOR: "wewnątrz",
  OUTDOOR: "taras",
  BAR: "bar",
  PRIVATE: "prywatna",
};

export const SHAPE_LABELS: Record<TableShape, string> = {
  ROUND: "Okrągły",
  SQUARE: "Kwadratowy",
  RECTANGLE: "Prostokątny",
};

export const GRID_MIN = 4;
export const GRID_MAX = 40;
export const SPAN_MIN = 1;
export const SPAN_MAX = 8;

/** Prostokąt zajmowany przez stolik w jednostkach siatki. */
export type PlanRect = {
  posX: number;
  posY: number;
  spanX: number;
  spanY: number;
};

/** Stolik na planie — kształt danych wspólny dla strony i komponentów. */
export type PlanTable = PlanRect & {
  id: string;
  roomId: string;
  tableNumber: string;
  capacityMin: number;
  capacityMax: number;
  shape: TableShape;
  area: RestaurantArea;
  combinable: boolean;
  isActive: boolean;
  hasBookings: boolean;
};

/** Sala wraz ze swoim planem. */
export type PlanRoom = {
  id: string;
  name: string;
  gridWidth: number;
  gridHeight: number;
  tables: PlanTable[];
};

/** Czy kafel mieści się w całości w siatce sali. */
export function fitsInGrid(
  rect: PlanRect,
  gridWidth: number,
  gridHeight: number,
): boolean {
  return (
    rect.posX >= 0 &&
    rect.posY >= 0 &&
    rect.spanX >= 1 &&
    rect.spanY >= 1 &&
    rect.posX + rect.spanX <= gridWidth &&
    rect.posY + rect.spanY <= gridHeight
  );
}

/** Czy dwa kafle na siebie zachodzą (styk krawędziami jest dozwolony). */
export function rectsOverlap(a: PlanRect, b: PlanRect): boolean {
  return (
    a.posX < b.posX + b.spanX &&
    b.posX < a.posX + a.spanX &&
    a.posY < b.posY + b.spanY &&
    b.posY < a.posY + a.spanY
  );
}

/** Pierwszy stolik, na który nachodzi `rect`, albo null. */
export function findCollision<T extends PlanRect>(
  rect: PlanRect,
  others: T[],
): T | null {
  return others.find((other) => rectsOverlap(rect, other)) ?? null;
}

/**
 * Pierwsze wolne miejsce na kafel `spanX × spanY` — skan wierszami od
 * lewego górnego rogu. null, gdy plan jest już szczelnie zapełniony.
 */
export function firstFreeCell(
  occupied: PlanRect[],
  gridWidth: number,
  gridHeight: number,
  spanX: number,
  spanY: number,
): { posX: number; posY: number } | null {
  for (let posY = 0; posY + spanY <= gridHeight; posY += 1) {
    for (let posX = 0; posX + spanX <= gridWidth; posX += 1) {
      const rect = { posX, posY, spanX, spanY };
      if (!findCollision(rect, occupied)) return { posX, posY };
    }
  }
  return null;
}

/** Minuty od północy → "18:00" (wartość dla <input type="time">). */
export function minutesToTimeValue(minutes: number): string {
  const safe = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "18:30" → 1110. null, gdy format się nie zgadza. */
export function timeValueToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) return null;
  const total = hours * 60 + minutes;
  return total <= 24 * 60 ? total : null;
}
