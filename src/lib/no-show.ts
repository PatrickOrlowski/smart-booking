import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

/**
 * Polityka no-show: klient, który nie przychodzi na wizyty, po przekroczeniu
 * limitu firmy (Business.noShowLimit) traci możliwość rezerwacji online
 * w tej firmie (Customer.isBlocked). Blokada dotyczy wyłącznie profilu CRM
 * w danej firmie — goście bez wiersza Customer nie są liczeni.
 *
 * Zdejmowanie i ręczne nakładanie blokady przechodzi przez ten moduł,
 * żeby każda zmiana zostawiała ślad w AuditLog (CUSTOMER_BLOCKED /
 * CUSTOMER_UNBLOCKED).
 */

export type NoShowResult = {
  /** Czy klient jest po tej nieobecności zablokowany (także gdy był już wcześniej). */
  blocked: boolean;
  /** Liczba wizyt NO_SHOW klienta w tej firmie. */
  count: number;
  /** Limit firmy (Business.noShowLimit). */
  limit: number;
};

/** „po 1 nieobecności", „po 3 nieobecnościach" — poprawna odmiana w powodzie blokady. */
const noShowPhrase = (count: number): string =>
  count === 1 ? "1 nieobecności" : `${count} nieobecnościach`;

/**
 * Rejestruje skutki oznaczenia wizyty jako NO_SHOW: liczy nieobecności
 * klienta w firmie i przy osiągnięciu limitu blokuje go automatycznie.
 *
 * Wywoływać PO zapisaniu statusu NO_SHOW na rezerwacji. Rezerwacje gości
 * (bez customerId) są pomijane — nie ma kogo blokować. Idempotentne:
 * ponowne wywołanie dla już zablokowanego klienta niczego nie zmienia
 * i nie dubluje wpisu audytu.
 */
export async function registerNoShow(
  bookingId: string,
  options: { actorUserId?: string | null } = {},
): Promise<NoShowResult> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      customerId: true,
      businessId: true,
      business: { select: { noShowLimit: true } },
      customer: { select: { isBlocked: true } },
    },
  });
  if (!booking) return { blocked: false, count: 0, limit: 0 };

  const limit = booking.business.noShowLimit;
  if (!booking.customerId || !booking.customer) {
    // Gość bez profilu CRM — polityka go nie obejmuje.
    return { blocked: false, count: 0, limit };
  }

  const count = await prisma.booking.count({
    where: {
      businessId: booking.businessId,
      customerId: booking.customerId,
      status: "NO_SHOW",
    },
  });

  if (count < limit) {
    return { blocked: booking.customer.isBlocked, count, limit };
  }

  // Strażnik isBlocked=false w WHERE: równoległe oznaczenia nie nadpiszą
  // sobie blokady ani nie zdublują wpisu audytu.
  const reason = `Automatyczna blokada po ${noShowPhrase(count)}`;
  const updated = await prisma.customer.updateMany({
    where: { id: booking.customerId, isBlocked: false },
    data: { isBlocked: true, blockedAt: new Date(), blockedReason: reason },
  });

  if (updated.count > 0) {
    await logAudit({
      businessId: booking.businessId,
      actorUserId: options.actorUserId ?? null,
      action: "CUSTOMER_BLOCKED",
      entityType: "Customer",
      entityId: booking.customerId,
      metadata: { bookingId, reason, noShowCount: count, limit, automatic: true },
    });
  }

  return { blocked: true, count, limit };
}

/**
 * Zdejmuje blokadę klienta (decyzja właściciela/menedżera). Autoryzację
 * do firmy sprawdza wywołujący — tu tylko mutacja + audyt.
 * Zwraca false, gdy klient nie istnieje albo nie był zablokowany.
 */
export async function unblockCustomer(
  customerId: string,
  actorUserId: string,
): Promise<boolean> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { businessId: true, blockedReason: true },
  });
  if (!customer) return false;

  const updated = await prisma.customer.updateMany({
    where: { id: customerId, isBlocked: true },
    data: { isBlocked: false, blockedAt: null, blockedReason: null },
  });
  if (updated.count === 0) return false;

  await logAudit({
    businessId: customer.businessId,
    actorUserId,
    action: "CUSTOMER_UNBLOCKED",
    entityType: "Customer",
    entityId: customerId,
    metadata: { previousReason: customer.blockedReason },
  });
  return true;
}

/**
 * Ręczna blokada klienta przez właściciela/menedżera — niezależna od licznika
 * nieobecności. Zwraca false, gdy klient nie istnieje albo już jest zablokowany.
 */
export async function blockCustomer(
  customerId: string,
  actorUserId: string,
  reason: string,
): Promise<boolean> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { businessId: true },
  });
  if (!customer) return false;

  const updated = await prisma.customer.updateMany({
    where: { id: customerId, isBlocked: false },
    data: { isBlocked: true, blockedAt: new Date(), blockedReason: reason },
  });
  if (updated.count === 0) return false;

  await logAudit({
    businessId: customer.businessId,
    actorUserId,
    action: "CUSTOMER_BLOCKED",
    entityType: "Customer",
    entityId: customerId,
    metadata: { reason, automatic: false },
  });
  return true;
}
