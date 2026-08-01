import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPanelBusiness } from "@/app/panel/data";
import { TableSettingsView } from "@/components/panel/table-settings-view";

/** Turn time, pacing i restauracyjne ustawienia lokalizacji. */
export default async function RestaurantSettingsPage() {
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

  const [turnTimeRules, pacingRules] = await Promise.all([
    prisma.turnTimeRule.findMany({
      where: { locationId: location.id },
      orderBy: { partySizeMin: "asc" },
      select: {
        id: true,
        partySizeMin: true,
        partySizeMax: true,
        durationMin: true,
      },
    }),
    prisma.pacingRule.findMany({
      where: { locationId: location.id },
      orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
      select: {
        id: true,
        weekday: true,
        startMinute: true,
        endMinute: true,
        intervalMin: true,
        maxCovers: true,
        maxBookings: true,
      },
    }),
  ]);

  return (
    <TableSettingsView
      businessId={business.id}
      locationId={location.id}
      settings={{
        defaultTurnTimeMin: location.defaultTurnTimeMin,
        tableBufferMin: location.tableBufferMin,
        maxPartySizeOnline: location.maxPartySizeOnline,
        waitlistEnabled: location.waitlistEnabled,
      }}
      turnTimeRules={turnTimeRules}
      pacingRules={pacingRules}
      isManager={isManager}
    />
  );
}
