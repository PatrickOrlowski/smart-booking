"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  ForbiddenError,
  UnauthorizedError,
  requireBusinessManager,
} from "@/lib/authz";
import { RestaurantArea, TableShape } from "@/generated/prisma/enums";
import {
  GRID_MAX,
  GRID_MIN,
  SPAN_MAX,
  SPAN_MIN,
  fitsInGrid,
  findCollision,
} from "./plan-utils";

/**
 * Server actions panelu restauracji: sale, stoliki, plan sali, zestawienia,
 * turn time i pacing.
 *
 * Każda mutacja przechodzi przez `requireBusinessManager`, a KAŻDY
 * identyfikator z formularza jest domykany warunkiem na firmę
 * (`location.businessId`), żeby cudza sala nie dała się edytować przez
 * podmianę id w żądaniu.
 */

type ActionResult = { ok: true } | { ok: false; error: string };

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
    return { ok: false, error: error.message };
  }
  console.error(fallback, error);
  return { ok: false, error: fallback };
}

function revalidate() {
  revalidatePath("/panel/sale");
  revalidatePath("/panel/sale/zestawienia");
  revalidatePath("/panel/sale/ustawienia");
  revalidatePath("/panel/dzis");
}

/**
 * Ile NADCHODZĄCYCH rezerwacji blokuje stolik.
 *
 * Liczy się wyłącznie to, co jeszcze się nie odbyło i nie zostało odwołane —
 * historia nie jest powodem, żeby zabraniać wyłączenia stolika, ale jutrzejsza
 * kolacja jak najbardziej (stolik zniknąłby z planu hosta i licznika zajętości,
 * a rezerwacja została w bazie).
 */
async function countUpcomingBookings(
  resourceId: string,
  now: Date,
): Promise<number> {
  return prisma.bookingItem.count({
    where: {
      resourceId,
      isBlocking: true,
      blockedEndAt: { gt: now },
      booking: { status: { in: ["PENDING", "CONFIRMED"] } },
    },
  });
}

/**
 * Przelicza pojemność zestawień, które straciły stolik.
 *
 * Zestawienie „9+10+11" (trzy czwórki, capacityMax 12) po usunięciu stolika 11
 * zostawało aktywne z limitem 12 osób i silnik sadzał dwunastkę przy ośmiu
 * miejscach. Zawężenie ręczne managera zostaje uszanowane — pojemność wyłącznie
 * SPADA do fizycznej sumy miejsc.
 */
async function recalculateCombinations(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  combinationIds: string[],
): Promise<void> {
  for (const combinationId of combinationIds) {
    const members = await tx.tableCombinationMember.findMany({
      where: { combinationId },
      select: {
        resource: { select: { capacityMin: true, capacityMax: true } },
      },
    });

    // Zestawienie z jednym stolikiem przestaje być zestawieniem.
    if (members.length < 2) {
      await tx.tableCombination.update({
        where: { id: combinationId },
        data: { isActive: false },
      });
      continue;
    }

    const seatsMax = members.reduce(
      (sum, member) =>
        sum + (member.resource.capacityMax ?? member.resource.capacityMin ?? 1),
      0,
    );
    const combination = await tx.tableCombination.findUnique({
      where: { id: combinationId },
      select: { capacityMin: true, capacityMax: true },
    });
    if (!combination) continue;

    const capacityMax = Math.min(combination.capacityMax, seatsMax);
    const capacityMin = Math.min(combination.capacityMin, capacityMax);
    if (
      capacityMax !== combination.capacityMax ||
      capacityMin !== combination.capacityMin
    ) {
      await tx.tableCombination.update({
        where: { id: combinationId },
        data: { capacityMin, capacityMax },
      });
    }
  }
}

/** Lokalizacja należąca do firmy — punkt wejścia wszystkich sprawdzeń. */
async function requireLocation(businessId: string, locationId: string) {
  await requireBusinessManager(businessId);
  const location = await prisma.location.findFirst({
    where: { id: locationId, businessId },
    select: { id: true, businessId: true },
  });
  if (!location) throw new ForbiddenError("Nie znaleziono lokalizacji");
  return location;
}

// ---------------------------------------------------------------------------
// Sale
// ---------------------------------------------------------------------------

/**
 * Wszystkie granice liczbowe mają WŁASNY polski komunikat: Zod 4 domyślnie
 * zwraca angielskie „Too big: expected number to be <=50", a te teksty trafiają
 * prosto do toastu w panelu.
 */
const saveRoomSchema = z.object({
  businessId: z.string().min(1),
  locationId: z.string().min(1),
  roomId: z.string().min(1).optional(),
  name: z.string().trim().min(2, "Podaj nazwę sali").max(80, "Nazwa sali: maksymalnie 80 znaków"),
  gridWidth: z
    .number()
    .int()
    .min(GRID_MIN, `Szerokość siatki: minimum ${GRID_MIN} komórek`)
    .max(GRID_MAX, `Szerokość siatki: maksymalnie ${GRID_MAX} komórek`),
  gridHeight: z
    .number()
    .int()
    .min(GRID_MIN, `Wysokość siatki: minimum ${GRID_MIN} komórek`)
    .max(GRID_MAX, `Wysokość siatki: maksymalnie ${GRID_MAX} komórek`),
});

/** Dodanie lub edycja sali (nazwa + rozmiar siatki planu). */
export async function saveRoomAction(input: unknown): Promise<ActionResult> {
  const parsed = saveRoomSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane sali",
    };
  }
  const data = parsed.data;

  try {
    await requireLocation(data.businessId, data.locationId);

    if (data.roomId) {
      const room = await prisma.room.findFirst({
        where: { id: data.roomId, locationId: data.locationId },
        select: { id: true, tables: { select: { posX: true, posY: true, spanX: true, spanY: true, tableNumber: true } } },
      });
      if (!room) return { ok: false, error: "Nie znaleziono sali" };

      // Zmniejszenie siatki nie może wypchnąć istniejących stolików poza plan.
      const outside = room.tables.filter(
        (table) =>
          !fitsInGrid(
            {
              posX: table.posX ?? 0,
              posY: table.posY ?? 0,
              spanX: table.spanX ?? 1,
              spanY: table.spanY ?? 1,
            },
            data.gridWidth,
            data.gridHeight,
          ),
      );
      if (outside.length > 0) {
        const numbers = outside
          .map((table) => table.tableNumber ?? "?")
          .join(", ");
        return {
          ok: false,
          error: `Mniejsza siatka wypchnęłaby stoliki poza plan: ${numbers}`,
        };
      }

      await prisma.room.update({
        where: { id: room.id },
        data: {
          name: data.name,
          gridWidth: data.gridWidth,
          gridHeight: data.gridHeight,
        },
      });
    } else {
      const max = await prisma.room.aggregate({
        where: { locationId: data.locationId },
        _max: { sortOrder: true },
      });
      await prisma.room.create({
        data: {
          locationId: data.locationId,
          name: data.name,
          gridWidth: data.gridWidth,
          gridHeight: data.gridHeight,
          sortOrder: (max._max.sortOrder ?? -1) + 1,
        },
      });
    }
  } catch (error) {
    return failure(error, "Nie udało się zapisać sali");
  }

  revalidate();
  return { ok: true };
}

const deleteRoomSchema = z.object({
  businessId: z.string().min(1),
  roomId: z.string().min(1),
});

/** Usunięcie sali. Sala ze stolikami zostaje — najpierw trzeba je przenieść. */
export async function deleteRoomAction(input: unknown): Promise<ActionResult> {
  const parsed = deleteRoomSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  try {
    await requireBusinessManager(data.businessId);
    const room = await prisma.room.findFirst({
      where: { id: data.roomId, location: { businessId: data.businessId } },
      select: { id: true, _count: { select: { tables: true } } },
    });
    if (!room) return { ok: false, error: "Nie znaleziono sali" };
    if (room._count.tables > 0) {
      return {
        ok: false,
        error: "Sala ma stoliki — najpierw przenieś je do innej sali albo usuń",
      };
    }
    await prisma.room.delete({ where: { id: room.id } });
  } catch (error) {
    return failure(error, "Nie udało się usunąć sali");
  }

  revalidate();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Stoliki
// ---------------------------------------------------------------------------

const saveTableSchema = z
  .object({
    businessId: z.string().min(1),
    locationId: z.string().min(1),
    tableId: z.string().min(1).optional(),
    roomId: z.string().min(1),
    tableNumber: z
      .string()
      .trim()
      .min(1, "Podaj numer stolika")
      .max(10, "Numer stolika: maksymalnie 10 znaków"),
    capacityMin: z
      .number()
      .int()
      .min(1, "Pojemność od: minimum 1 osoba")
      .max(50, "Pojemność od: maksymalnie 50 osób"),
    capacityMax: z
      .number()
      .int()
      .min(1, "Pojemność do: minimum 1 osoba")
      .max(50, "Pojemność do: maksymalnie 50 osób"),
    shape: z.enum(TableShape),
    area: z.enum(RestaurantArea),
    combinable: z.boolean(),
    posX: z
      .number()
      .int()
      .min(0, "Pozycja X musi być w siatce")
      .max(GRID_MAX, `Pozycja X: maksymalnie ${GRID_MAX}`),
    posY: z
      .number()
      .int()
      .min(0, "Pozycja Y musi być w siatce")
      .max(GRID_MAX, `Pozycja Y: maksymalnie ${GRID_MAX}`),
    spanX: z
      .number()
      .int()
      .min(SPAN_MIN, `Szerokość kafla: minimum ${SPAN_MIN}`)
      .max(SPAN_MAX, `Szerokość kafla: maksymalnie ${SPAN_MAX}`),
    spanY: z
      .number()
      .int()
      .min(SPAN_MIN, `Wysokość kafla: minimum ${SPAN_MIN}`)
      .max(SPAN_MAX, `Wysokość kafla: maksymalnie ${SPAN_MAX}`),
    isActive: z.boolean(),
  })
  .refine((value) => value.capacityMin <= value.capacityMax, {
    message: "Pojemność minimalna nie może przekraczać maksymalnej",
  });

/** Dodanie lub edycja stolika wraz z jego miejscem na planie sali. */
export async function saveTableAction(input: unknown): Promise<ActionResult> {
  const parsed = saveTableSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane stolika",
    };
  }
  const data = parsed.data;

  try {
    await requireLocation(data.businessId, data.locationId);

    const room = await prisma.room.findFirst({
      where: { id: data.roomId, locationId: data.locationId },
      select: { id: true, gridWidth: true, gridHeight: true },
    });
    if (!room) return { ok: false, error: "Nie znaleziono sali" };

    if (data.tableId) {
      const existing = await prisma.resource.findFirst({
        where: {
          id: data.tableId,
          type: "TABLE",
          locationId: data.locationId,
        },
        select: { id: true, isActive: true },
      });
      if (!existing) return { ok: false, error: "Nie znaleziono stolika" };

      // Przełącznik „Stolik dostępny" wyłączał stolik bez ostrzeżenia, mimo
      // przyszłych rezerwacji — te znikały z planu hosta, ale zostawały w bazie.
      if (existing.isActive && !data.isActive) {
        const upcoming = await countUpcomingBookings(existing.id, new Date());
        if (upcoming > 0) {
          return {
            ok: false,
            error: `Stolik ma ${upcoming} nadchodzących rezerwacji — najpierw przenieś je na inny stolik albo odwołaj`,
          };
        }
      }
    }

    const duplicate = await prisma.resource.findFirst({
      where: {
        locationId: data.locationId,
        type: "TABLE",
        tableNumber: data.tableNumber,
        ...(data.tableId ? { id: { not: data.tableId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      return {
        ok: false,
        error: `Stolik o numerze ${data.tableNumber} już istnieje w tym lokalu`,
      };
    }

    const rect = {
      posX: data.posX,
      posY: data.posY,
      spanX: data.spanX,
      spanY: data.spanY,
    };
    if (!fitsInGrid(rect, room.gridWidth, room.gridHeight)) {
      return {
        ok: false,
        error: `Stolik nie mieści się w siatce ${room.gridWidth}×${room.gridHeight}`,
      };
    }

    const siblings = await prisma.resource.findMany({
      where: {
        roomId: room.id,
        type: "TABLE",
        ...(data.tableId ? { id: { not: data.tableId } } : {}),
      },
      select: {
        tableNumber: true,
        posX: true,
        posY: true,
        spanX: true,
        spanY: true,
      },
    });
    const collision = findCollision(
      rect,
      siblings.map((table) => ({
        tableNumber: table.tableNumber,
        posX: table.posX ?? 0,
        posY: table.posY ?? 0,
        spanX: table.spanX ?? 1,
        spanY: table.spanY ?? 1,
      })),
    );
    if (collision) {
      return {
        ok: false,
        error: `Miejsce zajęte przez stolik ${collision.tableNumber ?? "?"}`,
      };
    }

    const tableData = {
      name: `Stolik ${data.tableNumber}`,
      roomId: room.id,
      tableNumber: data.tableNumber,
      capacityMin: data.capacityMin,
      capacityMax: data.capacityMax,
      shape: data.shape,
      area: data.area,
      combinable: data.combinable,
      posX: data.posX,
      posY: data.posY,
      spanX: data.spanX,
      spanY: data.spanY,
      isActive: data.isActive,
    };

    if (data.tableId) {
      await prisma.resource.update({
        where: { id: data.tableId },
        data: tableData,
      });
    } else {
      const max = await prisma.resource.aggregate({
        where: { locationId: data.locationId, type: "TABLE" },
        _max: { sortOrder: true },
      });
      await prisma.resource.create({
        data: {
          ...tableData,
          locationId: data.locationId,
          type: "TABLE",
          sortOrder: (max._max.sortOrder ?? -1) + 1,
        },
      });
    }
  } catch (error) {
    return failure(error, "Nie udało się zapisać stolika");
  }

  revalidate();
  return { ok: true };
}

const moveTableSchema = z.object({
  businessId: z.string().min(1),
  tableId: z.string().min(1),
  posX: z
    .number()
    .int()
    .min(0, "Pozycja X musi być w siatce")
    .max(GRID_MAX, `Pozycja X: maksymalnie ${GRID_MAX}`),
  posY: z
    .number()
    .int()
    .min(0, "Pozycja Y musi być w siatce")
    .max(GRID_MAX, `Pozycja Y: maksymalnie ${GRID_MAX}`),
});

/**
 * Zapis pozycji po przeciągnięciu kafla. Osobna, wąska akcja — przeciąganie
 * nie może przy okazji zmienić pojemności ani numeru stolika.
 */
export async function moveTableAction(input: unknown): Promise<ActionResult> {
  const parsed = moveTableSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowa pozycja" };
  const data = parsed.data;

  try {
    await requireBusinessManager(data.businessId);

    const table = await prisma.resource.findFirst({
      where: {
        id: data.tableId,
        type: "TABLE",
        location: { businessId: data.businessId },
      },
      select: {
        id: true,
        spanX: true,
        spanY: true,
        roomId: true,
        room: { select: { id: true, gridWidth: true, gridHeight: true } },
      },
    });
    if (!table?.room) {
      return { ok: false, error: "Nie znaleziono stolika w żadnej sali" };
    }

    const rect = {
      posX: data.posX,
      posY: data.posY,
      spanX: table.spanX ?? 1,
      spanY: table.spanY ?? 1,
    };
    if (!fitsInGrid(rect, table.room.gridWidth, table.room.gridHeight)) {
      return { ok: false, error: "Stolik wychodzi poza siatkę sali" };
    }

    const siblings = await prisma.resource.findMany({
      where: { roomId: table.room.id, type: "TABLE", id: { not: table.id } },
      select: {
        tableNumber: true,
        posX: true,
        posY: true,
        spanX: true,
        spanY: true,
      },
    });
    const collision = findCollision(
      rect,
      siblings.map((sibling) => ({
        tableNumber: sibling.tableNumber,
        posX: sibling.posX ?? 0,
        posY: sibling.posY ?? 0,
        spanX: sibling.spanX ?? 1,
        spanY: sibling.spanY ?? 1,
      })),
    );
    if (collision) {
      return {
        ok: false,
        error: `Miejsce zajęte przez stolik ${collision.tableNumber ?? "?"}`,
      };
    }

    await prisma.resource.update({
      where: { id: table.id },
      data: { posX: data.posX, posY: data.posY },
    });
  } catch (error) {
    return failure(error, "Nie udało się zapisać pozycji stolika");
  }

  revalidate();
  return { ok: true };
}

const deleteTableSchema = z.object({
  businessId: z.string().min(1),
  tableId: z.string().min(1),
});

/**
 * Usunięcie stolika. Stolik z rezerwacjami w historii nie znika z bazy —
 * zostaje dezaktywowany, żeby nie osierocić BookingItem. Stolik z rezerwacjami
 * NADCHODZĄCYMI nie znika ani nie gaśnie: zniknąłby z planu hosta i licznika
 * zajętości, a goście nadal mieliby na niego potwierdzenie.
 */
export async function deleteTableAction(
  input: unknown,
): Promise<{ ok: true; deactivated: boolean } | { ok: false; error: string }> {
  const parsed = deleteTableSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  let deactivated = false;
  try {
    await requireBusinessManager(data.businessId);
    const table = await prisma.resource.findFirst({
      where: {
        id: data.tableId,
        type: "TABLE",
        location: { businessId: data.businessId },
      },
      select: {
        id: true,
        locationId: true,
        _count: { select: { bookingItems: true } },
      },
    });
    if (!table) return { ok: false, error: "Nie znaleziono stolika" };

    const upcoming = await countUpcomingBookings(table.id, new Date());
    if (upcoming > 0) {
      return {
        ok: false,
        error: `Stolik ma ${upcoming} nadchodzących rezerwacji — najpierw przenieś je na inny stolik albo odwołaj`,
      };
    }

    if (table._count.bookingItems > 0) {
      await prisma.resource.update({
        where: { id: table.id },
        data: { isActive: false },
      });
      deactivated = true;
    } else {
      await prisma.$transaction(async (tx) => {
        // Zestawienia, do których stolik należał — czytamy PRZED kasowaniem,
        // bo członkostwa znikają kaskadowo.
        const memberships = await tx.tableCombinationMember.findMany({
          where: { resourceId: table.id },
          select: { combinationId: true },
        });
        await tx.resource.delete({ where: { id: table.id } });
        await recalculateCombinations(
          tx,
          memberships.map((membership) => membership.combinationId),
        );
      });
    }
  } catch (error) {
    return failure(error, "Nie udało się usunąć stolika");
  }

  revalidate();
  return { ok: true, deactivated };
}

// ---------------------------------------------------------------------------
// Zestawienia stolików
// ---------------------------------------------------------------------------

const saveCombinationSchema = z
  .object({
    businessId: z.string().min(1),
    locationId: z.string().min(1),
    combinationId: z.string().min(1).optional(),
    name: z
      .string()
      .trim()
      .min(1, "Podaj nazwę zestawienia")
      .max(60, "Nazwa zestawienia: maksymalnie 60 znaków"),
    capacityMin: z
      .number()
      .int()
      .min(1, "Pojemność od: minimum 1 osoba")
      .max(100, "Pojemność od: maksymalnie 100 osób"),
    capacityMax: z
      .number()
      .int()
      .min(1, "Pojemność do: minimum 1 osoba")
      .max(100, "Pojemność do: maksymalnie 100 osób"),
    resourceIds: z
      .array(z.string().min(1))
      .min(2, "Zestawienie musi mieć co najmniej 2 stoliki")
      .max(12, "Zestawienie: maksymalnie 12 stolików"),
    isActive: z.boolean(),
  })
  .refine((value) => value.capacityMin <= value.capacityMax, {
    message: "Pojemność minimalna nie może przekraczać maksymalnej",
  });

/** Dodanie lub edycja zestawienia stolików (TableCombination + członkowie). */
export async function saveCombinationAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = saveCombinationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane zestawienia",
    };
  }
  const data = parsed.data;
  const resourceIds = [...new Set(data.resourceIds)];
  if (resourceIds.length < 2) {
    return { ok: false, error: "Zestawienie musi mieć co najmniej 2 stoliki" };
  }

  try {
    await requireLocation(data.businessId, data.locationId);

    // Stoliki muszą należeć do TEJ lokalizacji — inaczej dałoby się zestawić
    // stolik z cudzego lokalu i zablokować go rezerwacją.
    const chosen = await prisma.resource.findMany({
      where: {
        id: { in: resourceIds },
        type: "TABLE",
        locationId: data.locationId,
      },
      select: {
        id: true,
        tableNumber: true,
        combinable: true,
        capacityMin: true,
        capacityMax: true,
      },
    });
    if (chosen.length !== resourceIds.length) {
      return { ok: false, error: "Wybrane stoliki nie należą do tego lokalu" };
    }

    // `Resource.combinable` była dotąd martwą daną: dialog pisał „nie zestawia
    // się", ale checkbox i tak działał, a silnik proponował gościom układ,
    // którego obsługa fizycznie nie zestawi.
    const notCombinable = chosen.filter((table) => !table.combinable);
    if (notCombinable.length > 0) {
      const numbers = notCombinable
        .map((table) => table.tableNumber ?? "?")
        .join(", ");
      return {
        ok: false,
        error: `Stoliki oznaczone jako niezestawialne: ${numbers}. Odznacz je albo zmień ustawienie stolika.`,
      };
    }

    // Zestawienie nie może obiecywać więcej miejsc, niż jest przy stołach.
    const seatsMax = chosen.reduce(
      (sum, table) => sum + (table.capacityMax ?? table.capacityMin ?? 1),
      0,
    );
    if (data.capacityMax > seatsMax) {
      return {
        ok: false,
        error: `Wybrane stoliki mają razem ${seatsMax} miejsc — „pojemność do" nie może być większa`,
      };
    }

    if (data.combinationId) {
      const existing = await prisma.tableCombination.findFirst({
        where: { id: data.combinationId, locationId: data.locationId },
        select: { id: true },
      });
      if (!existing) return { ok: false, error: "Nie znaleziono zestawienia" };
    }

    await prisma.$transaction(async (tx) => {
      let combinationId = data.combinationId;
      if (combinationId) {
        await tx.tableCombination.update({
          where: { id: combinationId },
          data: {
            name: data.name,
            capacityMin: data.capacityMin,
            capacityMax: data.capacityMax,
            isActive: data.isActive,
          },
        });
        await tx.tableCombinationMember.deleteMany({
          where: { combinationId },
        });
      } else {
        const created = await tx.tableCombination.create({
          data: {
            locationId: data.locationId,
            name: data.name,
            capacityMin: data.capacityMin,
            capacityMax: data.capacityMax,
            isActive: data.isActive,
          },
        });
        combinationId = created.id;
      }
      await tx.tableCombinationMember.createMany({
        data: resourceIds.map((resourceId) => ({
          combinationId: combinationId!,
          resourceId,
        })),
      });
    });
  } catch (error) {
    return failure(error, "Nie udało się zapisać zestawienia");
  }

  revalidate();
  return { ok: true };
}

const deleteCombinationSchema = z.object({
  businessId: z.string().min(1),
  combinationId: z.string().min(1),
});

/** Usunięcie zestawienia stolików (członkowie znikają kaskadowo). */
export async function deleteCombinationAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = deleteCombinationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  try {
    await requireBusinessManager(data.businessId);
    const deleted = await prisma.tableCombination.deleteMany({
      where: {
        id: data.combinationId,
        location: { businessId: data.businessId },
      },
    });
    if (deleted.count === 0) {
      return { ok: false, error: "Nie znaleziono zestawienia" };
    }
  } catch (error) {
    return failure(error, "Nie udało się usunąć zestawienia");
  }

  revalidate();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Turn time
// ---------------------------------------------------------------------------

const saveTurnTimeSchema = z
  .object({
    businessId: z.string().min(1),
    locationId: z.string().min(1),
    ruleId: z.string().min(1).optional(),
    partySizeMin: z
      .number()
      .int()
      .min(1, "Liczba osób od: minimum 1")
      .max(100, "Liczba osób od: maksymalnie 100"),
    partySizeMax: z
      .number()
      .int()
      .min(1, "Liczba osób do: minimum 1")
      .max(100, "Liczba osób do: maksymalnie 100"),
    durationMin: z
      .number()
      .int()
      .min(15, "Czas zajęcia stolika: minimum 15 minut")
      .max(600, "Czas zajęcia stolika: maksymalnie 600 minut"),
  })
  .refine((value) => value.partySizeMin <= value.partySizeMax, {
    message: "Zakres osób jest odwrócony (od > do)",
  });

/** Dodanie lub edycja reguły turn time; zakresy nie mogą się nakładać. */
export async function saveTurnTimeRuleAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = saveTurnTimeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowa reguła",
    };
  }
  const data = parsed.data;

  try {
    await requireLocation(data.businessId, data.locationId);

    // Nakładające się zakresy dają niedeterministyczny czas trwania —
    // „pierwsza pasująca reguła" przestaje być jednoznaczna.
    const overlapping = await prisma.turnTimeRule.findFirst({
      where: {
        locationId: data.locationId,
        ...(data.ruleId ? { id: { not: data.ruleId } } : {}),
        partySizeMin: { lte: data.partySizeMax },
        partySizeMax: { gte: data.partySizeMin },
      },
      select: { partySizeMin: true, partySizeMax: true },
    });
    if (overlapping) {
      return {
        ok: false,
        error: `Zakres nakłada się na regułę ${overlapping.partySizeMin}–${overlapping.partySizeMax} osób`,
      };
    }

    if (data.ruleId) {
      const updated = await prisma.turnTimeRule.updateMany({
        where: { id: data.ruleId, locationId: data.locationId },
        data: {
          partySizeMin: data.partySizeMin,
          partySizeMax: data.partySizeMax,
          durationMin: data.durationMin,
        },
      });
      if (updated.count === 0) {
        return { ok: false, error: "Nie znaleziono reguły" };
      }
    } else {
      await prisma.turnTimeRule.create({
        data: {
          locationId: data.locationId,
          partySizeMin: data.partySizeMin,
          partySizeMax: data.partySizeMax,
          durationMin: data.durationMin,
        },
      });
    }
  } catch (error) {
    return failure(error, "Nie udało się zapisać reguły turn time");
  }

  revalidate();
  return { ok: true };
}

const deleteRuleSchema = z.object({
  businessId: z.string().min(1),
  ruleId: z.string().min(1),
});

/** Usunięcie reguły turn time. */
export async function deleteTurnTimeRuleAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = deleteRuleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  try {
    await requireBusinessManager(data.businessId);
    const deleted = await prisma.turnTimeRule.deleteMany({
      where: { id: data.ruleId, location: { businessId: data.businessId } },
    });
    if (deleted.count === 0) return { ok: false, error: "Nie znaleziono reguły" };
  } catch (error) {
    return failure(error, "Nie udało się usunąć reguły");
  }

  revalidate();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

const savePacingSchema = z
  .object({
    businessId: z.string().min(1),
    locationId: z.string().min(1),
    ruleId: z.string().min(1).optional(),
    weekday: z
      .number()
      .int()
      .min(0, "Nieprawidłowy dzień tygodnia")
      .max(6, "Nieprawidłowy dzień tygodnia")
      .nullable(),
    startMinute: z
      .number()
      .int()
      .min(0, "Godzina początku jest poza dobą")
      .max(24 * 60, "Godzina początku jest poza dobą"),
    endMinute: z
      .number()
      .int()
      .min(0, "Godzina końca jest poza dobą")
      .max(24 * 60, "Godzina końca jest poza dobą"),
    intervalMin: z
      .number()
      .int()
      .min(5, "Interwał: minimum 5 minut")
      .max(240, "Interwał: maksymalnie 240 minut"),
    maxCovers: z
      .number()
      .int()
      .min(1, "Limit osób: minimum 1")
      .max(999, "Limit osób: maksymalnie 999")
      .nullable(),
    maxBookings: z
      .number()
      .int()
      .min(1, "Limit rezerwacji: minimum 1")
      .max(999, "Limit rezerwacji: maksymalnie 999")
      .nullable(),
  })
  .refine((value) => value.startMinute < value.endMinute, {
    message: "Okno godzinowe musi się kończyć później, niż zaczyna",
  })
  .refine((value) => value.maxCovers !== null || value.maxBookings !== null, {
    message: "Ustaw limit osób albo limit rezerwacji",
  });

/** Dodanie lub edycja reguły pacingu (limit gości na przedział czasu). */
export async function savePacingRuleAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = savePacingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowa reguła",
    };
  }
  const data = parsed.data;

  try {
    await requireLocation(data.businessId, data.locationId);

    if (data.ruleId) {
      const updated = await prisma.pacingRule.updateMany({
        where: { id: data.ruleId, locationId: data.locationId },
        data: {
          weekday: data.weekday,
          startMinute: data.startMinute,
          endMinute: data.endMinute,
          intervalMin: data.intervalMin,
          maxCovers: data.maxCovers,
          maxBookings: data.maxBookings,
        },
      });
      if (updated.count === 0) {
        return { ok: false, error: "Nie znaleziono reguły" };
      }
    } else {
      await prisma.pacingRule.create({
        data: {
          locationId: data.locationId,
          weekday: data.weekday,
          startMinute: data.startMinute,
          endMinute: data.endMinute,
          intervalMin: data.intervalMin,
          maxCovers: data.maxCovers,
          maxBookings: data.maxBookings,
        },
      });
    }
  } catch (error) {
    return failure(error, "Nie udało się zapisać reguły pacingu");
  }

  revalidate();
  return { ok: true };
}

/** Usunięcie reguły pacingu. */
export async function deletePacingRuleAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = deleteRuleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  try {
    await requireBusinessManager(data.businessId);
    const deleted = await prisma.pacingRule.deleteMany({
      where: { id: data.ruleId, location: { businessId: data.businessId } },
    });
    if (deleted.count === 0) return { ok: false, error: "Nie znaleziono reguły" };
  } catch (error) {
    return failure(error, "Nie udało się usunąć reguły");
  }

  revalidate();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Ustawienia restauracyjne lokalizacji
// ---------------------------------------------------------------------------

const saveSettingsSchema = z.object({
  businessId: z.string().min(1),
  locationId: z.string().min(1),
  defaultTurnTimeMin: z
    .number()
    .int()
    .min(15, "Domyślny czas: minimum 15 minut")
    .max(600, "Domyślny czas: maksymalnie 600 minut"),
  tableBufferMin: z
    .number()
    .int()
    .min(0, "Bufor sprzątania nie może być ujemny")
    .max(120, "Bufor sprzątania: maksymalnie 120 minut"),
  maxPartySizeOnline: z
    .number()
    .int()
    .min(1, "Limit grupy online: minimum 1 osoba")
    .max(100, "Limit grupy online: maksymalnie 100 osób")
    .nullable(),
  waitlistEnabled: z.boolean(),
});

/** Zapis ustawień restauracyjnych lokalizacji. */
export async function saveRestaurantSettingsAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = saveSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe ustawienia",
    };
  }
  const data = parsed.data;

  try {
    await requireLocation(data.businessId, data.locationId);
    await prisma.location.update({
      where: { id: data.locationId },
      data: {
        defaultTurnTimeMin: data.defaultTurnTimeMin,
        tableBufferMin: data.tableBufferMin,
        maxPartySizeOnline: data.maxPartySizeOnline,
        waitlistEnabled: data.waitlistEnabled,
      },
    });
  } catch (error) {
    return failure(error, "Nie udało się zapisać ustawień");
  }

  revalidate();
  return { ok: true };
}
