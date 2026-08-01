import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPanelBusiness } from "@/app/panel/data";
import { FloorPlanView } from "@/components/panel/floor-plan-view";
import type { PlanRoom } from "./plan-utils";

/** Sale lokalu i edytor planu sali (siatka + kafle stolików). */
export default async function RoomsPage() {
  const panel = await getPanelBusiness();
  if (!panel) redirect("/panel/nowa");

  const { business, location, isManager } = panel;
  if (!location) {
    return (
      <p className="rounded-2xl border border-border bg-card px-5 py-10 text-center text-[13px] text-muted-foreground">
        Firma nie ma jeszcze lokalizacji — dodaj ją w onboardingu.
      </p>
    );
  }

  const [rooms, unassignedCount] = await Promise.all([
    prisma.room.findMany({
      where: { locationId: location.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        tables: {
          where: { type: "TABLE" },
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            roomId: true,
            tableNumber: true,
            capacityMin: true,
            capacityMax: true,
            shape: true,
            area: true,
            combinable: true,
            posX: true,
            posY: true,
            spanX: true,
            spanY: true,
            isActive: true,
            _count: { select: { bookingItems: true } },
          },
        },
      },
    }),
    prisma.resource.count({
      where: { locationId: location.id, type: "TABLE", roomId: null },
    }),
  ]);

  // Pola stolika są w schemacie opcjonalne (dzieli model z pracownikami),
  // więc domykamy je bezpiecznymi wartościami tuż przy granicy widoku.
  const planRooms: PlanRoom[] = rooms.map((room) => ({
    id: room.id,
    name: room.name,
    gridWidth: room.gridWidth,
    gridHeight: room.gridHeight,
    tables: room.tables.map((table) => ({
      id: table.id,
      roomId: table.roomId ?? room.id,
      tableNumber: table.tableNumber ?? "?",
      capacityMin: table.capacityMin ?? 1,
      capacityMax: table.capacityMax ?? 1,
      shape: table.shape ?? "SQUARE",
      area: table.area ?? "INDOOR",
      combinable: table.combinable,
      posX: table.posX ?? 0,
      posY: table.posY ?? 0,
      spanX: table.spanX ?? 1,
      spanY: table.spanY ?? 1,
      isActive: table.isActive,
      hasBookings: table._count.bookingItems > 0,
    })),
  }));

  return (
    <FloorPlanView
      businessId={business.id}
      locationId={location.id}
      rooms={planRooms}
      unassignedCount={unassignedCount}
      isManager={isManager}
    />
  );
}
