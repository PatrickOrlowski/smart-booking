import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { utcToZonedWallClock } from "@/lib/time";
import { getPanelBusiness } from "@/app/panel/data";
import { TeamView, type TeamMember } from "@/components/panel/team-view";
import { formatMinutes } from "@/components/panel/format";

/** Zespół — karty pracowników, grafiki tygodniowe i urlopy. */
export default async function TeamPage() {
  const panel = await getPanelBusiness();
  if (!panel) redirect("/panel/nowa");

  const { business, location, isManager } = panel;

  const staffResources = location
    ? await prisma.resource.findMany({
        where: { locationId: location.id, type: "STAFF", isActive: true },
        orderBy: { sortOrder: "asc" },
        include: {
          staffProfile: true,
          workingHours: {
            orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
          },
          timeOff: {
            where: { endAt: { gte: new Date() } },
            orderBy: { startAt: "asc" },
          },
        },
      })
    : [];

  const tz = location?.timezone ?? "Europe/Warsaw";
  const now = new Date();
  const nowUtcDayNumber = (() => {
    const wall = utcToZonedWallClock(now, tz);
    return Date.UTC(wall.year, wall.month - 1, wall.day);
  })();

  const formatRange = (startAt: Date, endAt: Date): string => {
    const start = utcToZonedWallClock(startAt, tz);
    // endAt jest wyłączne (00:00 dnia po ostatnim) — dla etykiety cofamy minutę.
    const end = utcToZonedWallClock(new Date(endAt.getTime() - 60_000), tz);
    const dayLabel = (wall: { day: number; month: number }) =>
      `${String(wall.day).padStart(2, "0")}.${String(wall.month).padStart(2, "0")}`;
    const startTime =
      start.hour !== 0 || start.minute !== 0
        ? ` ${formatMinutes(start.hour * 60 + start.minute)}`
        : "";
    const endIsFullDay = end.hour === 23 && end.minute === 59;
    const endTime = endIsFullDay
      ? ""
      : ` ${formatMinutes(end.hour * 60 + end.minute + 1)}`;
    return `${dayLabel(start)}${startTime} → ${dayLabel(end)}${endTime}`;
  };

  const members: TeamMember[] = staffResources.map((resource) => ({
    resourceId: resource.id,
    name: resource.name,
    title: resource.staffProfile?.title ?? null,
    role: resource.staffProfile?.role ?? "EMPLOYEE",
    invitedEmail: resource.staffProfile?.invitedEmail ?? null,
    hasAccount: resource.staffProfile?.userId != null,
    schedule: resource.workingHours
      .filter(
        (row) =>
          (row.validFrom === null ||
            row.validFrom.getTime() <= nowUtcDayNumber) &&
          (row.validTo === null || row.validTo.getTime() >= nowUtcDayNumber),
      )
      .map((row) => ({
        weekday: row.weekday,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
      })),
    timeOff: resource.timeOff.map((entry) => ({
      id: entry.id,
      type: entry.type,
      rangeLabel: formatRange(entry.startAt, entry.endAt),
      reason: entry.reason,
    })),
  }));

  return (
    <TeamView
      businessId={business.id}
      members={members}
      isManager={isManager}
    />
  );
}
