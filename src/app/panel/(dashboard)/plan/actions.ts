"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ForbiddenError,
  UnauthorizedError,
  requireBusinessManager,
} from "@/lib/authz";
import { SubscriptionPlan } from "@/generated/prisma/enums";
import { PlanChangeError, PlanLimitError, changePlan } from "@/lib/subscription";

type ActionResult = { ok: true } | { ok: false; error: string };

const changePlanSchema = z.object({
  businessId: z.string().min(1),
  plan: z.enum(SubscriptionPlan),
});

/**
 * Zmiana planu subskrypcji firmy. Downgrade poniżej aktualnego użycia
 * (pracownicy/lokalizacje) odrzuca `changePlan` — UI blokuje to samo
 * wcześniej, ale serwer jest źródłem prawdy.
 */
export async function changePlanAction(input: unknown): Promise<ActionResult> {
  const parsed = changePlanSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Nieprawidłowe dane zmiany planu" };
  }
  const data = parsed.data;

  try {
    const { user } = await requireBusinessManager(data.businessId);
    await changePlan(data.businessId, data.plan, user.id);
  } catch (error) {
    if (
      error instanceof UnauthorizedError ||
      error instanceof ForbiddenError ||
      error instanceof PlanLimitError ||
      error instanceof PlanChangeError
    ) {
      return { ok: false, error: error.message };
    }
    console.error("changePlanAction", error);
    return { ok: false, error: "Nie udało się zmienić planu. Spróbuj ponownie." };
  }

  revalidatePath("/panel/plan");
  revalidatePath("/panel/zespol");
  return { ok: true };
}
