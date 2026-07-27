import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Wspólny helper wpisów do AuditLog — śladu operacji wrażliwych
 * (anulowania, płatności, zwroty, blokady klientów).
 *
 * Nigdy nie rzuca: audyt jest obserwatorem, nie uczestnikiem transakcji.
 * Nieudany insert loguje się na konsolę i nie może wywrócić flow,
 * które właśnie dokumentuje.
 */

export type LogAuditInput = {
  businessId?: string | null;
  actorUserId?: string | null;
  /** np. BOOKING_CANCELLED, PAYMENT_PAID, PAYMENT_REFUNDED */
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
};

export async function logAudit(input: LogAuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        businessId: input.businessId ?? null,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata,
      },
    });
  } catch (error) {
    console.error("logAudit: nie udało się zapisać wpisu audytu:", error);
  }
}
