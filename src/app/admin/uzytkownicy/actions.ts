"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requirePlatformAdminAction } from "@/lib/admin-auth";
import { ForbiddenError, UnauthorizedError } from "@/lib/authz";
import type { ActionResult } from "@/components/admin/action-result";
import { USER_ROLE_LABELS } from "@/components/admin/format";

/**
 * Zmiana roli konta — najbardziej wybuchowa operacja w panelu.
 *
 * Dwie bezpieczniki po stronie serwera (UI ich nie zastąpi, bo akcję można
 * wywołać fetchem):
 *  1. nie da się zmienić własnej roli — administrator nie odetnie sam sobie
 *     dostępu jednym kliknięciem ani nie „awansuje się" po cichu,
 *  2. nie da się zdjąć roli ostatniemu administratorowi platformy — panel
 *     bez ani jednego admina to zamknięte drzwi bez klucza.
 */

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
    return { ok: false, error: error.message };
  }
  console.error(fallback, error);
  return { ok: false, error: fallback };
}

const schema = z.object({
  userId: z.string().min(1),
  role: z.enum(["CUSTOMER", "BUSINESS_OWNER", "STAFF", "PLATFORM_ADMIN"]),
});

/** Sygnał z transakcji: degradacja zdjęłaby ostatniego admina platformy. */
class LastAdminError extends Error {
  constructor() {
    super("LAST_PLATFORM_ADMIN");
    this.name = "LastAdminError";
  }
}

export async function changeUserRoleAction(input: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  try {
    const admin = await requirePlatformAdminAction();

    if (admin.id === data.userId) {
      return {
        ok: false,
        error:
          "Nie możesz zmienić własnej roli — poproś innego administratora platformy",
      };
    }

    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      select: { id: true, email: true, role: true },
    });
    if (!user) return { ok: false, error: "Nie znaleziono użytkownika" };
    if (user.role === data.role) {
      return {
        ok: false,
        error: `Konto ma już rolę „${USER_ROLE_LABELS[data.role]}"`,
      };
    }

    // Bezpiecznik „ostatni admin" i sam zapis idą w JEDNEJ transakcji
    // Serializable: dwóch adminów degradujących się nawzajem równolegle
    // widziałoby (count + update bez transakcji) po dwóch adminów i platforma
    // zostałaby z zerem — a rolę nadaje się wyłącznie z tego panelu.
    // Serializable każe Postgresowi zerwać jedną z takich transakcji.
    await prisma.$transaction(
      async (tx) => {
        if (user.role === "PLATFORM_ADMIN" && data.role !== "PLATFORM_ADMIN") {
          const admins = await tx.user.count({
            where: { role: "PLATFORM_ADMIN" },
          });
          if (admins <= 1) throw new LastAdminError();
        }
        await tx.user.update({
          where: { id: user.id },
          data: { role: data.role },
        });
      },
      { isolationLevel: "Serializable" },
    );

    await logAudit({
      actorUserId: admin.id,
      action: "USER_ROLE_CHANGED",
      entityType: "User",
      entityId: user.id,
      metadata: {
        from: user.role,
        to: data.role,
        ...(user.email ? { email: user.email } : {}),
      },
    });
  } catch (error) {
    if (error instanceof LastAdminError) {
      return {
        ok: false,
        error: "To ostatni administrator platformy — najpierw wyznacz następcę",
      };
    }
    return failure(error, "Nie udało się zmienić roli konta");
  }

  revalidatePath("/admin");
  revalidatePath("/admin/uzytkownicy");
  revalidatePath(`/admin/uzytkownicy/${data.userId}`);
  return { ok: true };
}
