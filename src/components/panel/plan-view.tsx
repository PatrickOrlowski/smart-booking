"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PanelDialogContent } from "@/components/panel/panel-dialog";
import { cn } from "@/lib/utils";
import { changePlanAction } from "@/app/panel/(dashboard)/plan/actions";
import type { SubscriptionPlan } from "@/generated/prisma/enums";

/**
 * Widok /panel/plan: obecna subskrypcja z paskami wykorzystania limitów
 * oraz trzy karty planów z przełączaniem przez dialog potwierdzenia.
 * Wszystkie dane (etykiety, limity, blokady downgrade'u) przychodzą
 * policzone z serwera — tu tylko prezentacja i wywołanie akcji.
 */

export type PlanUsageData = {
  label: string;
  used: number;
  /** null = bez limitu */
  limit: number | null;
};

export type CurrentPlanData = {
  name: string;
  statusLabel: string;
  statusTone: "success" | "warning" | "destructive" | "muted";
  /** np. "odnowienie 26.08.2026" / "okres próbny do 10.08.2026" */
  periodLabel: string | null;
  priceLabel: string;
  usage: PlanUsageData[];
  /**
   * Ostrzeżenie, gdy limity są liczone z niższego planu niż wykupiony
   * (wygasły trial / okres rozliczeniowy / anulowana subskrypcja).
   */
  expiredNote?: string | null;
};

export type PlanCardData = {
  plan: SubscriptionPlan;
  name: string;
  priceLabel: string;
  features: string[];
  isCurrent: boolean;
  isRecommended: boolean;
  isDowngrade: boolean;
  /** Komunikat blokady downgrade'u poniżej aktualnego użycia — null, gdy plan dostępny. */
  blockedReason: string | null;
};

const STATUS_TONE_CLASSES: Record<CurrentPlanData["statusTone"], string> = {
  success: "border-success-soft-border bg-success-soft text-success",
  warning: "border-warning-soft bg-warning-soft text-warning-strong",
  destructive: "border-destructive/25 bg-destructive/10 text-destructive",
  muted: "border-border bg-muted text-muted-foreground",
};

function UsageBar({ usage }: { usage: PlanUsageData }) {
  const unlimited = usage.limit === null;
  const full = usage.limit !== null && usage.used >= usage.limit;
  const pct = unlimited
    ? 100
    : Math.min((usage.used / Math.max(usage.limit!, 1)) * 100, 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold">{usage.label}</span>
        <span
          className={cn(
            "font-mono text-xs",
            full ? "text-warning-strong" : "text-muted-foreground",
          )}
        >
          {unlimited ? `${usage.used} · bez limitu` : `${usage.used}/${usage.limit}`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            unlimited ? "bg-primary/25" : full ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function PlanView({
  businessId,
  isManager,
  current,
  cards,
}: {
  businessId: string;
  isManager: boolean;
  current: CurrentPlanData;
  cards: PlanCardData[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingPlan, setPendingPlan] = useState<PlanCardData | null>(null);

  const confirmChange = () => {
    if (!pendingPlan) return;
    const target = pendingPlan;
    startTransition(async () => {
      const result = await changePlanAction({ businessId, plan: target.plan });
      if (result.ok) {
        toast.success(`Plan zmieniony na ${target.name}`);
        setPendingPlan(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight sm:text-[27px]">
        Plan
      </h1>
      <p className="mt-0.5 mb-6 text-[12.5px] text-muted-foreground">
        Subskrypcja firmy — limity zespołu i lokalizacji rosną z planem.
        Rozliczenie na miejscu, bez płatności online w tej fazie.
      </p>

      {/* Obecny plan + wykorzystanie limitów */}
      <section className="rounded-2xl border-[1.5px] border-border-strong bg-card p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0">
            <div className="meta-label">Obecny plan</div>
            <div className="mt-0.5 flex items-baseline gap-2.5">
              <span className="font-display text-xl font-extrabold tracking-tight">
                {current.name}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {current.priceLabel} / mies.
              </span>
            </div>
          </div>
          <div className="ml-auto flex flex-col items-start gap-1 sm:items-end">
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em]",
                STATUS_TONE_CLASSES[current.statusTone],
              )}
            >
              {current.statusLabel}
            </span>
            {current.periodLabel && (
              <span className="font-mono text-[11px] text-muted-foreground">
                {current.periodLabel}
              </span>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {current.usage.map((usage) => (
            <UsageBar key={usage.label} usage={usage} />
          ))}
        </div>

        {current.expiredNote && (
          <p className="mt-4 rounded-lg border border-warning-soft bg-warning-soft px-3 py-2 text-[12px] leading-snug text-warning-strong">
            {current.expiredNote}
          </p>
        )}
      </section>

      {/* Karty planów */}
      <div className="meta-label mt-8 mb-3">Dostępne plany</div>
      <div className="grid gap-3 md:grid-cols-3">
        {cards.map((card) => (
          <article
            key={card.plan}
            className={cn(
              "flex flex-col rounded-2xl bg-card p-5",
              card.isCurrent
                ? "border-[1.5px] border-border-strong"
                : "border border-border",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-lg font-bold tracking-tight">
                {card.name}
              </h2>
              {card.isCurrent ? (
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] text-foreground/70">
                  Obecny plan
                </span>
              ) : card.isRecommended ? (
                <span className="rounded bg-primary px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] text-primary-foreground">
                  Polecany
                </span>
              ) : null}
            </div>

            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="font-display text-[26px] font-extrabold leading-none tracking-tight">
                {card.priceLabel}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                / mies.
              </span>
            </div>

            <ul className="mt-4 flex flex-col gap-1.5 text-[13px]">
              {card.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <CheckIcon
                    aria-hidden
                    className="mt-0.5 size-3.5 shrink-0 text-success"
                  />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            {isManager && (
              <div className="mt-auto pt-5">
                {card.isCurrent ? (
                  <Button
                    variant="outline"
                    disabled
                    className="h-11 w-full rounded-full text-[13px] font-semibold lg:h-10"
                  >
                    Obecny plan
                  </Button>
                ) : (
                  <>
                    <Button
                      variant={card.isRecommended ? "default" : "outline"}
                      disabled={card.blockedReason !== null || isPending}
                      onClick={() => setPendingPlan(card)}
                      className={cn(
                        "h-11 w-full rounded-full text-[13px] font-semibold lg:h-10",
                        card.blockedReason === null &&
                          !card.isRecommended &&
                          "border-[1.5px] border-border-strong",
                      )}
                    >
                      Wybierz plan
                    </Button>
                    {card.blockedReason && (
                      <p className="mt-2 text-[11.5px] leading-snug text-warning-strong">
                        {card.blockedReason}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </article>
        ))}
      </div>

      {!isManager && (
        <p className="mt-4 text-[12.5px] text-muted-foreground">
          Zmiana planu dostępna tylko dla właściciela i menedżerów firmy.
        </p>
      )}

      {/* Dialog potwierdzenia zmiany planu */}
      <Dialog
        open={pendingPlan !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPlan(null);
        }}
      >
        <PanelDialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {pendingPlan?.isDowngrade
                ? `Przejść na niższy plan ${pendingPlan?.name}?`
                : `Zmienić plan na ${pendingPlan?.name}?`}
            </DialogTitle>
            <DialogDescription>
              Nowy plan zacznie obowiązywać od razu, okres rozliczeniowy to 30
              dni ({pendingPlan?.priceLabel} / mies., rozliczenie na miejscu).
              {pendingPlan?.isDowngrade &&
                " Limity pracowników i lokalizacji zmniejszą się natychmiast."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="max-sm:mt-auto">
            <Button
              variant="ghost"
              disabled={isPending}
              onClick={() => setPendingPlan(null)}
              className="h-11 rounded-full text-[13px] font-semibold sm:h-9"
            >
              Anuluj
            </Button>
            <Button
              disabled={isPending}
              onClick={confirmChange}
              className="h-11 rounded-full text-[13px] font-semibold sm:h-9"
            >
              {isPending ? "Zmieniam…" : "Potwierdź zmianę"}
            </Button>
          </DialogFooter>
        </PanelDialogContent>
      </Dialog>
    </div>
  );
}
