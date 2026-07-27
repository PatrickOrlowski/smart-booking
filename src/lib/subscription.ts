import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import type {
  SubscriptionPlan,
  SubscriptionStatus,
} from "@/generated/prisma/enums";

/**
 * Plany i limity subskrypcji firm.
 *
 * Limity (liczba pracowników, lokalizacji) egzekwowane w kodzie — patrz
 * komentarz przy modelu Subscription w schemacie. Firma bez wiersza
 * Subscription działa na wirtualnym planie FREE/ACTIVE, więc żaden flow
 * nie może zakładać, że wiersz istnieje.
 */

export type PlanLimits = {
  /** null = bez limitu */
  staff: number | null;
  locations: number | null;
};

export const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  FREE: { staff: 2, locations: 1 },
  PRO: { staff: 10, locations: 3 },
  TEAM: { staff: null, locations: null },
};

/** Ceny prezentacyjne w groszach za miesiąc (rozliczenie MANUAL w tej fazie). */
export const PLAN_PRICES_CENTS: Record<SubscriptionPlan, number> = {
  FREE: 0,
  PRO: 4900,
  TEAM: 14900,
};

export const PLAN_LABELS: Record<SubscriptionPlan, string> = {
  FREE: "Free",
  PRO: "Pro",
  TEAM: "Team",
};

/** Kolejność planów — do rozróżniania upgrade/downgrade w UI. */
export const PLAN_ORDER: Record<SubscriptionPlan, number> = {
  FREE: 0,
  PRO: 1,
  TEAM: 2,
};

export type BusinessSubscription = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** true = firma nie ma wiersza w bazie, działa na domyślnym FREE. */
  isVirtual: boolean;
};

/**
 * Subskrypcja firmy: wiersz z bazy albo wirtualny FREE/ACTIVE, gdy go brak
 * (firmy sprzed wprowadzenia subskrypcji).
 */
export async function getBusinessSubscription(
  businessId: string,
): Promise<BusinessSubscription> {
  const subscription = await prisma.subscription.findUnique({
    where: { businessId },
    select: {
      plan: true,
      status: true,
      trialEndsAt: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
    },
  });

  if (!subscription) {
    return {
      plan: "FREE",
      status: "ACTIVE",
      trialEndsAt: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      isVirtual: true,
    };
  }

  return { ...subscription, isVirtual: false };
}

export type LimitCheck = {
  allowed: boolean;
  used: number;
  /** null = bez limitu */
  limit: number | null;
  plan: SubscriptionPlan;
};

/** Czy plan firmy pozwala dodać kolejnego pracownika. */
export async function canAddStaff(businessId: string): Promise<LimitCheck> {
  const [subscription, used] = await Promise.all([
    getBusinessSubscription(businessId),
    prisma.staffProfile.count({ where: { businessId, isActive: true } }),
  ]);
  const limit = PLAN_LIMITS[subscription.plan].staff;
  return {
    allowed: limit === null || used < limit,
    used,
    limit,
    plan: subscription.plan,
  };
}

/** Czy plan firmy pozwala dodać kolejną lokalizację. */
export async function canAddLocation(businessId: string): Promise<LimitCheck> {
  const [subscription, used] = await Promise.all([
    getBusinessSubscription(businessId),
    prisma.location.count({ where: { businessId, isActive: true } }),
  ]);
  const limit = PLAN_LIMITS[subscription.plan].locations;
  return {
    allowed: limit === null || used < limit,
    used,
    limit,
    plan: subscription.plan,
  };
}

/** Zmiana planu odrzucona, bo firma używa więcej, niż nowy plan pozwala. */
export class PlanLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanLimitError";
  }
}

const PERIOD_DAYS = 30;

/**
 * Zmiana planu firmy — rozliczenie MANUAL (bez bramki płatniczej w tej fazie):
 * plan działa od razu, status ACTIVE, okres rozliczeniowy +30 dni.
 *
 * Rzuca `PlanLimitError`, gdy firma używa więcej pracowników/lokalizacji,
 * niż docelowy plan pozwala — najpierw trzeba zredukować zespół.
 */
export async function changePlan(
  businessId: string,
  plan: SubscriptionPlan,
  actorUserId: string,
): Promise<void> {
  const previous = await getBusinessSubscription(businessId);

  const limits = PLAN_LIMITS[plan];
  const [staffUsed, locationsUsed] = await Promise.all([
    prisma.staffProfile.count({ where: { businessId, isActive: true } }),
    prisma.location.count({ where: { businessId, isActive: true } }),
  ]);
  if (limits.staff !== null && staffUsed > limits.staff) {
    throw new PlanLimitError(
      `Plan ${PLAN_LABELS[plan]} pozwala na ${limits.staff} pracowników, a masz ${staffUsed}. Zmniejsz zespół, aby zmienić plan.`,
    );
  }
  if (limits.locations !== null && locationsUsed > limits.locations) {
    throw new PlanLimitError(
      `Plan ${PLAN_LABELS[plan]} pozwala na ${limits.locations} lokalizacji, a masz ${locationsUsed}.`,
    );
  }

  const currentPeriodEnd = new Date(
    Date.now() + PERIOD_DAYS * 24 * 60 * 60 * 1000,
  );

  await prisma.subscription.upsert({
    where: { businessId },
    create: {
      businessId,
      plan,
      status: "ACTIVE",
      provider: "MANUAL",
      currentPeriodEnd,
    },
    update: {
      plan,
      status: "ACTIVE",
      provider: "MANUAL",
      currentPeriodEnd,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
    },
  });

  await logAudit({
    businessId,
    actorUserId,
    action: "PLAN_CHANGED",
    entityType: "Subscription",
    entityId: businessId,
    metadata: { from: previous.plan, to: plan },
  });
}
