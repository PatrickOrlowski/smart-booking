import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPanelBusiness } from "@/app/panel/data";
import {
  TableCombinationsView,
  type CombinationTableOption,
  type PanelCombination,
} from "@/components/panel/table-combinations-view";

/** Zestawienia stolików — zestawy, które obsługa zsuwa dla większych grup. */
export default async function CombinationsPage() {
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

  const [combinations, tables] = await Promise.all([
    prisma.tableCombination.findMany({
      where: { locationId: location.id },
      orderBy: { name: "asc" },
      include: { members: { select: { resourceId: true } } },
    }),
    prisma.resource.findMany({
      where: { locationId: location.id, type: "TABLE" },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        tableNumber: true,
        capacityMin: true,
        capacityMax: true,
        combinable: true,
        room: { select: { name: true } },
      },
    }),
  ]);

  const rows: PanelCombination[] = combinations.map((combination) => ({
    id: combination.id,
    name: combination.name,
    capacityMin: combination.capacityMin,
    capacityMax: combination.capacityMax,
    isActive: combination.isActive,
    memberIds: combination.members.map((member) => member.resourceId),
  }));

  const options: CombinationTableOption[] = tables.map((table) => ({
    id: table.id,
    tableNumber: table.tableNumber ?? "?",
    roomName: table.room?.name ?? "Bez sali",
    capacityMin: table.capacityMin ?? 1,
    capacityMax: table.capacityMax ?? 1,
    combinable: table.combinable,
  }));

  return (
    <TableCombinationsView
      businessId={business.id}
      locationId={location.id}
      combinations={rows}
      tables={options}
      isManager={isManager}
    />
  );
}
