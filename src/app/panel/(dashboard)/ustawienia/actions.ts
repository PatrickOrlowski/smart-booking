"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  ForbiddenError,
  UnauthorizedError,
  requireBusinessManager,
} from "@/lib/authz";

type ActionResult = { ok: true } | { ok: false; error: string };

const noShowLimitSchema = z.object({
  businessId: z.string().min(1),
  noShowLimit: z
    .number()
    .int("Limit musi być liczbą całkowitą")
    .min(1, "Limit nieobecności: minimum 1")
    .max(10, "Limit nieobecności: maksymalnie 10"),
});

/**
 * Zmiana limitu nieobecności firmy (Business.noShowLimit) — po tylu
 * nieodwołanych NO_SHOW klient jest automatycznie blokowany dla rezerwacji
 * online. Jedyne edytowalne pole ustawień w tej fazie.
 */
export async function updateNoShowLimitAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = noShowLimitSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowy limit",
    };
  }
  const data = parsed.data;

  try {
    await requireBusinessManager(data.businessId);
    await prisma.business.update({
      where: { id: data.businessId },
      data: { noShowLimit: data.noShowLimit },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return { ok: false, error: error.message };
    }
    console.error("updateNoShowLimitAction", error);
    return { ok: false, error: "Nie udało się zapisać limitu nieobecności" };
  }

  revalidatePath("/panel/ustawienia");
  return { ok: true };
}
