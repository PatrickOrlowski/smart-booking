import { redirect } from "next/navigation";
import { getPanelBusiness } from "@/app/panel/data";
import {
  PLAN_LABELS,
  PLAN_LIMITS,
  PLAN_ORDER,
  PLAN_PRICES_CENTS,
  canAddLocation,
  canAddStaff,
  getBusinessSubscription,
} from "@/lib/subscription";
import { utcToZonedWallClock } from "@/lib/time";
import { formatPrice } from "@/components/panel/format";
import {
  PlanView,
  type CurrentPlanData,
  type PlanCardData,
} from "@/components/panel/plan-view";
import type { SubscriptionPlan } from "@/generated/prisma/enums";

/**
 * /panel/plan — subskrypcja firmy: obecny plan z wykorzystaniem limitów
 * i trzy karty planów (FREE / PRO / TEAM). Wszystkie etykiety i blokady
 * downgrade'u liczone tu, na serwerze — klient tylko renderuje.
 */

const PLAN_FEATURES: Record<SubscriptionPlan, string[]> = {
  FREE: [
    "2 pracowników",
    "1 lokalizacja",
    "Kalendarz i rezerwacje online",
    "Powiadomienia e-mail",
  ],
  PRO: [
    "10 pracowników",
    "3 lokalizacje",
    "Zadatki za usługi premium",
    "Wszystko z planu Free",
  ],
  TEAM: [
    "Pracownicy bez limitu",
    "Lokalizacje bez limitu",
    "Priorytetowe wsparcie",
    "Wszystko z planu Pro",
  ],
};

const ALL_PLANS: SubscriptionPlan[] = ["FREE", "PRO", "TEAM"];

/** Data w strefie lokalizacji: "26.08.2026". */
function formatDay(date: Date, timeZone: string): string {
  const wall = utcToZonedWallClock(date, timeZone);
  return `${String(wall.day).padStart(2, "0")}.${String(wall.month).padStart(2, "0")}.${wall.year}`;
}

/**
 * Komunikat blokady downgrade'u, gdy firma używa więcej pracowników /
 * lokalizacji, niż docelowy plan pozwala. null = plan można wybrać.
 */
function blockedReason(
  plan: SubscriptionPlan,
  staffUsed: number,
  locationsUsed: number,
): string | null {
  const limits = PLAN_LIMITS[plan];
  const problems: string[] = [];
  if (limits.staff !== null && staffUsed > limits.staff) {
    problems.push(
      `masz ${staffUsed} pracowników, plan pozwala na ${limits.staff}`,
    );
  }
  if (limits.locations !== null && locationsUsed > limits.locations) {
    problems.push(
      `masz ${locationsUsed} lokalizacji, plan pozwala na ${limits.locations}`,
    );
  }
  if (problems.length === 0) return null;
  // Konkretna, wykonalna instrukcja: dezaktywacja pracownika siedzi
  // w zakładce Zespół (akcja deactivateStaffAction).
  return `Niedostępny: ${problems.join("; ")}. Dezaktywuj pracowników w zakładce Zespół, aby przejść na ten plan.`;
}

export default async function PlanPage() {
  const panel = await getPanelBusiness();
  if (!panel) redirect("/panel/nowa");

  const { business, location, isManager } = panel;
  const tz = location?.timezone ?? "Europe/Warsaw";

  const [subscription, staffLimit, locationLimit] = await Promise.all([
    getBusinessSubscription(business.id),
    canAddStaff(business.id),
    canAddLocation(business.id),
  ]);

  const statusByCode: Record<
    typeof subscription.status,
    { label: string; tone: CurrentPlanData["statusTone"] }
  > = {
    TRIALING: { label: "Okres próbny", tone: "warning" },
    ACTIVE: { label: "Aktywny", tone: "success" },
    PAST_DUE: { label: "Zaległa płatność", tone: "destructive" },
    CANCELLED: { label: "Anulowany", tone: "muted" },
  };

  const periodLabel =
    subscription.status === "TRIALING" && subscription.trialEndsAt
      ? `okres próbny do ${formatDay(subscription.trialEndsAt, tz)}`
      : subscription.currentPeriodEnd
        ? subscription.cancelAtPeriodEnd
          ? `wygasa ${formatDay(subscription.currentPeriodEnd, tz)}`
          : `odnowienie ${formatDay(subscription.currentPeriodEnd, tz)}`
        : null;

  const current: CurrentPlanData = {
    name: PLAN_LABELS[subscription.plan],
    statusLabel: statusByCode[subscription.status].label,
    statusTone: statusByCode[subscription.status].tone,
    periodLabel,
    priceLabel: formatPrice(PLAN_PRICES_CENTS[subscription.plan]),
    usage: [
      {
        label: "Pracownicy",
        used: staffLimit.used,
        limit: staffLimit.limit,
      },
      {
        label: "Lokalizacje",
        used: locationLimit.used,
        limit: locationLimit.limit,
      },
    ],
    // Limity liczy plan efektywny — wygasła subskrypcja spada do FREE,
    // więc paski nad limitem muszą mieć wyjaśnienie.
    expiredNote:
      subscription.effectivePlan !== subscription.plan
        ? `Subskrypcja ${PLAN_LABELS[subscription.plan]} nie jest opłacona — limity działają jak w planie ${PLAN_LABELS[subscription.effectivePlan]}.`
        : null,
  };

  const cards: PlanCardData[] = ALL_PLANS.map((plan) => {
    const isCurrent = plan === subscription.plan;
    return {
      plan,
      name: PLAN_LABELS[plan],
      priceLabel: formatPrice(PLAN_PRICES_CENTS[plan]),
      features: PLAN_FEATURES[plan],
      isCurrent,
      isRecommended: plan === "PRO" && !isCurrent,
      isDowngrade: PLAN_ORDER[plan] < PLAN_ORDER[subscription.plan],
      blockedReason: isCurrent
        ? null
        : blockedReason(plan, staffLimit.used, locationLimit.used),
    };
  });

  return (
    <PlanView
      businessId={business.id}
      isManager={isManager}
      current={current}
      cards={cards}
    />
  );
}
