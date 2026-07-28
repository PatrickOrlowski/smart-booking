"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import {
  ForbiddenError,
  UnauthorizedError,
  requireBusinessManager,
} from "@/lib/authz";
import { localDayMinutesToUtc } from "@/lib/time";
import {
  PLAN_LABELS,
  canAddStaff,
  withBusinessPlanLock,
} from "@/lib/subscription";

type ActionResult = { ok: true } | { ok: false; error: string };

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
    return { ok: false, error: error.message };
  }
  console.error(fallback, error);
  return { ok: false, error: fallback };
}

function revalidateTeam() {
  revalidatePath("/panel/zespol");
  revalidatePath("/panel");
}

/** Zasób STAFF musi należeć do lokalizacji tej firmy — nigdy nie ufamy id z formularza. */
async function findBusinessStaffResource(businessId: string, resourceId: string) {
  return prisma.resource.findFirst({
    where: {
      id: resourceId,
      type: "STAFF",
      location: { businessId },
    },
    include: { location: { select: { timezone: true } } },
  });
}

const addStaffSchema = z.object({
  businessId: z.string().min(1),
  name: z.string().trim().min(2, "Podaj imię pracownika").max(80),
  title: z.string().trim().max(80).optional(),
  invitedEmail: z
    .email("Nieprawidłowy e-mail zaproszenia")
    .optional()
    .or(z.literal("")),
});

/**
 * Dodanie pracownika: Resource typu STAFF + StaffProfile bez userId.
 * Konto dowiąże się później po invitedEmail.
 */
export async function addStaffAction(input: unknown): Promise<ActionResult> {
  const parsed = addStaffSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane",
    };
  }
  const data = parsed.data;

  try {
    await requireBusinessManager(data.businessId);

    const location = await prisma.location.findFirst({
      where: { businessId: data.businessId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!location) {
      return { ok: false, error: "Firma nie ma lokalizacji" };
    }

    // Sprawdzenie limitu i wstawienie pracownika w jednej transakcji
    // z advisory lockiem per firma — inaczej dwa równoległe żądania przy
    // used = limit-1 oba przechodzą check i firma ląduje ponad limitem planu.
    const limited = await withBusinessPlanLock(data.businessId, async (tx) => {
      const staffLimit = await canAddStaff(data.businessId, tx);
      if (!staffLimit.allowed) return staffLimit;

      const maxSort = await tx.resource.aggregate({
        where: { locationId: location.id, type: "STAFF" },
        _max: { sortOrder: true },
      });

      await tx.resource.create({
        data: {
          locationId: location.id,
          type: "STAFF",
          name: data.name,
          sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
          staffProfile: {
            create: {
              businessId: data.businessId,
              role: "EMPLOYEE",
              title: data.title || null,
              invitedEmail: data.invitedEmail || null,
            },
          },
        },
      });
      return null;
    });

    if (limited) {
      return {
        ok: false,
        error: `Limit pracowników planu ${PLAN_LABELS[limited.plan]} (${limited.used}/${limited.limit}). Przejdź na wyższy plan w /panel/plan.`,
      };
    }
  } catch (error) {
    return failure(error, "Nie udało się dodać pracownika");
  }

  revalidateTeam();
  return { ok: true };
}

const deactivateStaffSchema = z.object({
  businessId: z.string().min(1),
  resourceId: z.string().min(1),
});

/**
 * Dezaktywacja pracownika — jedyna droga zejścia poniżej limitu niższego
 * planu (downgrade odrzuca `changePlan`, dopóki zespół jest za duży).
 *
 * Nie kasujemy wierszy (osierociłyby historię rezerwacji), tylko gasimy
 * Resource.isActive i StaffProfile.isActive: pracownik znika z kalendarza,
 * dostępności i limitów planu. Przyszłe wizyty muszą być wcześniej odwołane
 * albo przepisane na kogoś innego — inaczej klient przyszedłby na termin,
 * którego nikt nie obsłuży.
 */
export async function deactivateStaffAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = deactivateStaffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  try {
    const { user } = await requireBusinessManager(data.businessId);

    const resource = await findBusinessStaffResource(
      data.businessId,
      data.resourceId,
    );
    if (!resource) return { ok: false, error: "Nie znaleziono pracownika" };
    if (!resource.isActive) {
      return { ok: false, error: "Pracownik jest już nieaktywny" };
    }

    const upcoming = await prisma.bookingItem.count({
      where: {
        resourceId: resource.id,
        endAt: { gt: new Date() },
        booking: { status: { in: ["PENDING", "CONFIRMED"] } },
      },
    });
    if (upcoming > 0) {
      return {
        ok: false,
        error: `Pracownik ma ${upcoming} nadchodzących wizyt. Odwołaj je albo przepisz na inną osobę, zanim go dezaktywujesz.`,
      };
    }

    await prisma.$transaction([
      prisma.resource.update({
        where: { id: resource.id },
        data: { isActive: false },
      }),
      prisma.staffProfile.updateMany({
        where: { resourceId: resource.id },
        data: { isActive: false },
      }),
    ]);

    await logAudit({
      businessId: data.businessId,
      actorUserId: user.id,
      action: "STAFF_DEACTIVATED",
      entityType: "Resource",
      entityId: resource.id,
      metadata: { name: resource.name },
    });
  } catch (error) {
    return failure(error, "Nie udało się dezaktywować pracownika");
  }

  revalidateTeam();
  revalidatePath("/panel/plan");
  return { ok: true };
}

const scheduleBlockSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((block) => block.startMinute < block.endMinute, {
    message: "Koniec bloku musi być po jego początku",
  });

const saveScheduleSchema = z.object({
  businessId: z.string().min(1),
  resourceId: z.string().min(1),
  blocks: z.array(scheduleBlockSchema).max(14),
});

/**
 * Zapis tygodniowego grafiku: w transakcji kasujemy stare wiersze
 * WorkingHours zasobu i wstawiamy nowy szablon (bez wersjonowania od daty —
 * uproszczenie fazy 1).
 */
export async function saveScheduleAction(input: unknown): Promise<ActionResult> {
  const parsed = saveScheduleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowy grafik",
    };
  }
  const data = parsed.data;

  // Maksymalnie 2 bloki dziennie, bez nakładania się w obrębie dnia.
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const dayBlocks = data.blocks
      .filter((block) => block.weekday === weekday)
      .sort((a, b) => a.startMinute - b.startMinute);
    if (dayBlocks.length > 2) {
      return { ok: false, error: "Maksymalnie 2 bloki pracy na dzień" };
    }
    if (
      dayBlocks.length === 2 &&
      dayBlocks[1].startMinute < dayBlocks[0].endMinute
    ) {
      return { ok: false, error: "Bloki pracy w jednym dniu nakładają się" };
    }
  }

  try {
    await requireBusinessManager(data.businessId);

    const resource = await findBusinessStaffResource(
      data.businessId,
      data.resourceId,
    );
    if (!resource) return { ok: false, error: "Nie znaleziono pracownika" };

    await prisma.$transaction([
      prisma.workingHours.deleteMany({ where: { resourceId: resource.id } }),
      prisma.workingHours.createMany({
        data: data.blocks.map((block) => ({
          resourceId: resource.id,
          weekday: block.weekday,
          startMinute: block.startMinute,
          endMinute: block.endMinute,
        })),
      }),
    ]);
  } catch (error) {
    return failure(error, "Nie udało się zapisać grafiku");
  }

  revalidateTeam();
  return { ok: true };
}

const addTimeOffSchema = z
  .object({
    businessId: z.string().min(1),
    resourceId: z.string().min(1),
    type: z.enum(["VACATION", "SICK_LEAVE", "BLOCKED"]),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Nieprawidłowa data od"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Nieprawidłowa data do"),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((value) => value.startDate <= value.endDate, {
    message: "Data końca nie może być przed datą początku",
  });

/**
 * Urlop / L4 / blokada zasobu — zakres dat traktowany włącznie:
 * [00:00 pierwszego dnia, 00:00 dnia po ostatnim] w strefie lokalizacji.
 */
export async function addTimeOffAction(input: unknown): Promise<ActionResult> {
  const parsed = addTimeOffSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane urlopu",
    };
  }
  const data = parsed.data;

  try {
    await requireBusinessManager(data.businessId);

    const resource = await findBusinessStaffResource(
      data.businessId,
      data.resourceId,
    );
    if (!resource) return { ok: false, error: "Nie znaleziono pracownika" };

    const tz = resource.location.timezone;
    const [startYear, startMonth, startDay] = data.startDate
      .split("-")
      .map(Number);
    const [endYear, endMonth, endDay] = data.endDate.split("-").map(Number);
    const startAt = localDayMinutesToUtc(
      { year: startYear, month: startMonth, day: startDay },
      0,
      tz,
    );
    const dayAfterEnd = new Date(Date.UTC(endYear, endMonth - 1, endDay + 1));
    const endAt = localDayMinutesToUtc(
      {
        year: dayAfterEnd.getUTCFullYear(),
        month: dayAfterEnd.getUTCMonth() + 1,
        day: dayAfterEnd.getUTCDate(),
      },
      0,
      tz,
    );

    await prisma.timeOff.create({
      data: {
        resourceId: resource.id,
        type: data.type,
        startAt,
        endAt,
        reason: data.reason || null,
      },
    });
  } catch (error) {
    return failure(error, "Nie udało się dodać urlopu");
  }

  revalidateTeam();
  return { ok: true };
}

const deleteTimeOffSchema = z.object({
  businessId: z.string().min(1),
  timeOffId: z.string().min(1),
});

/** Usunięcie urlopu/blokady — po weryfikacji, że należy do zasobu tej firmy. */
export async function deleteTimeOffAction(input: unknown): Promise<ActionResult> {
  const parsed = deleteTimeOffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  try {
    await requireBusinessManager(data.businessId);

    const deleted = await prisma.timeOff.deleteMany({
      where: {
        id: data.timeOffId,
        resource: { location: { businessId: data.businessId } },
      },
    });
    if (deleted.count === 0) {
      return { ok: false, error: "Nie znaleziono wpisu urlopu" };
    }
  } catch (error) {
    return failure(error, "Nie udało się usunąć urlopu");
  }

  revalidateTeam();
  return { ok: true };
}
