import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import type { Prisma } from "@/generated/prisma/client";
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
  /** Plan handlowy — to, co firma widzi jako „swój plan". */
  plan: SubscriptionPlan;
  /**
   * Plan faktycznie egzekwowany w limitach. Różni się od `plan`, gdy
   * subskrypcja wygasła (patrz `effectivePlanOf`).
   */
  effectivePlan: SubscriptionPlan;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** true = firma nie ma wiersza w bazie, działa na domyślnym FREE. */
  isVirtual: boolean;
};

/** Klient Prisma albo transakcja — limity liczymy też pod advisory lockiem. */
type Db = Prisma.TransactionClient;

/**
 * Karencja po końcu okresu rozliczeniowego, zanim limity spadną do FREE —
 * opóźniona płatność nie może z dnia na dzień wyłączyć firmie pracowników.
 */
const GRACE_DAYS = 3;
const GRACE_MS = GRACE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Plan egzekwowany w limitach. Samo pole `plan` nie wystarcza: subskrypcja
 * anulowana, trial po `trialEndsAt` oraz okres rozliczeniowy (ACTIVE/PAST_DUE)
 * po `currentPeriodEnd` + karencji przestają dawać podwyższone limity.
 * Bez tego demo „PRO/TRIALING" trzymałoby limity 10/3 bezterminowo.
 */
function effectivePlanOf(
  subscription: {
    plan: SubscriptionPlan;
    status: SubscriptionStatus;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
  },
  now: Date,
): SubscriptionPlan {
  if (subscription.plan === "FREE") return "FREE";
  if (subscription.status === "CANCELLED") return "FREE";

  if (subscription.status === "TRIALING") {
    const trialEnd = subscription.trialEndsAt;
    return trialEnd !== null && trialEnd.getTime() <= now.getTime()
      ? "FREE"
      : subscription.plan;
  }

  // ACTIVE / PAST_DUE — decyduje koniec opłaconego okresu z karencją.
  const periodEnd = subscription.currentPeriodEnd;
  return periodEnd !== null && periodEnd.getTime() + GRACE_MS <= now.getTime()
    ? "FREE"
    : subscription.plan;
}

/**
 * Subskrypcja firmy: wiersz z bazy albo wirtualny FREE/ACTIVE, gdy go brak
 * (firmy sprzed wprowadzenia subskrypcji).
 */
export async function getBusinessSubscription(
  businessId: string,
  db: Db = prisma,
): Promise<BusinessSubscription> {
  const subscription = await db.subscription.findUnique({
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
      effectivePlan: "FREE",
      status: "ACTIVE",
      trialEndsAt: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      isVirtual: true,
    };
  }

  return {
    ...subscription,
    effectivePlan: effectivePlanOf(subscription, new Date()),
    isVirtual: false,
  };
}

/**
 * Serializacja operacji, które zależą od limitów planu (dodanie pracownika,
 * zmiana planu): advisory lock per firma trzymany do końca transakcji.
 * Bez niego „policz + zapisz" z dwóch równoległych żądań przepuszcza firmę
 * ponad limit (oba widzą stan sprzed wstawienia drugiego wiersza).
 */
export async function withBusinessPlanLock<T>(
  businessId: string,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${businessId}))`;
    return fn(tx);
  });
}

export type LimitCheck = {
  allowed: boolean;
  used: number;
  /** null = bez limitu */
  limit: number | null;
  plan: SubscriptionPlan;
};

/**
 * Czy plan firmy pozwala dodać kolejnego pracownika. Liczy się plan
 * efektywny — wygasła subskrypcja nie daje limitów PRO.
 * `db` pozwala policzyć to samo wewnątrz transakcji z advisory lockiem.
 */
export async function canAddStaff(
  businessId: string,
  db: Db = prisma,
): Promise<LimitCheck> {
  const [subscription, used] = await Promise.all([
    getBusinessSubscription(businessId, db),
    db.staffProfile.count({ where: { businessId, isActive: true } }),
  ]);
  const limit = PLAN_LIMITS[subscription.effectivePlan].staff;
  return {
    allowed: limit === null || used < limit,
    used,
    limit,
    plan: subscription.effectivePlan,
  };
}

/** Czy plan firmy pozwala dodać kolejną lokalizację (plan efektywny). */
export async function canAddLocation(
  businessId: string,
  db: Db = prisma,
): Promise<LimitCheck> {
  const [subscription, used] = await Promise.all([
    getBusinessSubscription(businessId, db),
    db.location.count({ where: { businessId, isActive: true } }),
  ]);
  const limit = PLAN_LIMITS[subscription.effectivePlan].locations;
  return {
    allowed: limit === null || used < limit,
    used,
    limit,
    plan: subscription.effectivePlan,
  };
}

/** Zmiana planu odrzucona, bo firma używa więcej, niż nowy plan pozwala. */
export class PlanLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanLimitError";
  }
}

/**
 * Zmiana planu odrzucona przez stan subskrypcji: wybrano obecny plan albo
 * subskrypcja czeka na rozliczenie (PAST_DUE/CANCELLED).
 */
export class PlanChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanChangeError";
  }
}

const PERIOD_DAYS = 30;

/**
 * Zmiana planu firmy — rozliczenie MANUAL (bez bramki płatniczej w tej fazie):
 * plan działa od razu, status ACTIVE, okres rozliczeniowy +30 dni.
 *
 * Rzuca `PlanChangeError` przy wyborze obecnego planu (no-op, który wcześniej
 * po cichu przedłużał okres) oraz gdy subskrypcja jest PAST_DUE/CANCELLED —
 * zaległość nie znika przez kliknięcie innego planu; jedyne wyjście bez
 * ścieżki rozliczenia to zejście na FREE.
 * Rzuca `PlanLimitError`, gdy firma używa więcej pracowników/lokalizacji,
 * niż docelowy plan pozwala — najpierw trzeba zdezaktywować pracowników.
 */
export async function changePlan(
  businessId: string,
  plan: SubscriptionPlan,
  actorUserId: string,
): Promise<void> {
  const previous = await getBusinessSubscription(businessId);

  if (plan === previous.plan) {
    throw new PlanChangeError(
      `Firma jest już na planie ${PLAN_LABELS[plan]} — nie ma czego zmieniać.`,
    );
  }
  if (
    (previous.status === "PAST_DUE" || previous.status === "CANCELLED") &&
    plan !== "FREE"
  ) {
    throw new PlanChangeError(
      previous.status === "PAST_DUE"
        ? "Subskrypcja ma zaległą płatność — ureguluj ją, zanim zmienisz plan. Możesz też zejść na plan Free."
        : "Subskrypcja jest anulowana — jej odnowienie wymaga kontaktu z obsługą. Możesz też zejść na plan Free.",
    );
  }

  const limits = PLAN_LIMITS[plan];
  // Plan FREE nie ma okresu rozliczeniowego — zejście na niego zamyka temat
  // płatności i dlatego jest dozwolone także przy zaległości.
  const currentPeriodEnd =
    plan === "FREE"
      ? null
      : new Date(Date.now() + PERIOD_DAYS * 24 * 60 * 60 * 1000);

  // Zliczenie użycia i zapis planu w JEDNEJ transakcji z advisory lockiem
  // per firma: równoległe addStaffAction (sprawdzone pod starym planem)
  // nie prześlizgnie się obok downgrade'u.
  await withBusinessPlanLock(businessId, async (tx) => {
    const [staffUsed, locationsUsed] = await Promise.all([
      tx.staffProfile.count({ where: { businessId, isActive: true } }),
      tx.location.count({ where: { businessId, isActive: true } }),
    ]);
    if (limits.staff !== null && staffUsed > limits.staff) {
      throw new PlanLimitError(
        `Plan ${PLAN_LABELS[plan]} pozwala na ${limits.staff} pracowników, a masz ${staffUsed}. Dezaktywuj pracowników w zakładce Zespół, aby zmienić plan.`,
      );
    }
    if (limits.locations !== null && locationsUsed > limits.locations) {
      throw new PlanLimitError(
        `Plan ${PLAN_LABELS[plan]} pozwala na ${limits.locations} lokalizacji, a masz ${locationsUsed}.`,
      );
    }

    await tx.subscription.upsert({
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
