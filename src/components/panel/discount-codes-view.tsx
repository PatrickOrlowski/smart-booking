"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EllipsisVerticalIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/components/panel/format";
import { runAction } from "@/components/panel/run-action";
import { discountValueLabel } from "@/lib/discounts";
import {
  DiscountCodeDialog,
  discountEditorFor,
  emptyDiscountEditor,
  type DiscountCodeState,
  type DiscountEditorState,
  type PanelDiscountCode,
} from "@/components/panel/discount-code-dialog";
import { toggleDiscountCodeAction } from "@/app/panel/(dashboard)/promocje/actions";

export type { PanelDiscountCode, DiscountCodeState };

const STATE_BADGE: Record<
  DiscountCodeState,
  { label: string; className: string }
> = {
  active: { label: "AKTYWNY", className: "bg-success-soft text-success" },
  scheduled: { label: "ZAPLANOWANY", className: "bg-accent text-primary" },
  expired: { label: "WYGASŁ", className: "bg-warning-soft text-warning-strong" },
  exhausted: {
    label: "WYCZERPANY",
    className: "bg-secondary text-foreground/70",
  },
  inactive: { label: "WYŁĄCZONY", className: "bg-muted text-muted-foreground" },
};

const ROW_GRID =
  "grid grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,1.2fr)_auto_auto_auto] items-center gap-x-4 gap-y-2";

function StateBadge({ state }: { state: DiscountCodeState }) {
  const badge = STATE_BADGE[state];
  return (
    <span
      className={cn(
        // `w-fit` — w komórce siatki span rozciągnąłby tło na całą kolumnę.
        "inline-flex w-fit flex-none items-center justify-self-start rounded-md px-2 py-1 font-mono text-[10px] tracking-wide",
        badge.className,
      )}
    >
      {badge.label}
    </span>
  );
}

/** „12 / 100" albo „12 / ∞" — licznik użyć kodu. */
const usesLabel = (used: number, max: number | null) =>
  `${used} / ${max ?? "∞"}`;

/**
 * Zakładka „Kody rabatowe": lista kodów firmy z licznikiem użyć, ważnością
 * i statusem + CRUD w dialogu. Desktop = wiersze tabeli (jak cennik),
 * telefon/tablet = karty; szeroka siatka nigdy nie scrolluje strony poziomo.
 */
export function DiscountCodesView({
  businessId,
  currency,
  codes,
  isManager,
}: {
  businessId: string;
  currency: string;
  codes: PanelDiscountCode[];
  isManager: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editor, setEditor] = useState<DiscountEditorState | null>(null);

  const toggleActive = (code: PanelDiscountCode, isActive: boolean) => {
    startTransition(async () => {
      const result = await runAction(() =>
        toggleDiscountCodeAction({ businessId, codeId: code.id, isActive }),
      );
      if (result.ok) {
        toast.success(isActive ? "Kod włączony" : "Kod wyłączony");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted-foreground">
          {codes.length === 0
            ? "Brak kodów"
            : `${codes.length} ${codes.length === 1 ? "kod" : codes.length < 5 ? "kody" : "kodów"} · rabat liczony od ceny usługi`}
        </p>
        {isManager && (
          <Button
            className="h-11 rounded-full px-5 font-semibold lg:h-8 lg:px-4"
            onClick={() => setEditor(emptyDiscountEditor())}
          >
            + Nowy kod
          </Button>
        )}
      </div>

      {codes.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-16 text-center">
          <h2 className="font-display text-2xl font-extrabold tracking-tight">
            Jeszcze bez promocji
          </h2>
          <p className="max-w-sm text-[13px] text-muted-foreground">
            Kod rabatowy działa w podsumowaniu rezerwacji online — ustal
            wartość, ważność i limit użyć.
          </p>
          {isManager && (
            <Button
              className="rounded-full px-5 font-semibold max-lg:h-11"
              onClick={() => setEditor(emptyDiscountEditor())}
            >
              + Nowy kod
            </Button>
          )}
        </div>
      ) : (
        <>
          <div
            className={cn(
              ROW_GRID,
              "hidden border-b border-border px-3 pb-2 font-mono text-[10px] tracking-[0.08em] text-muted-foreground lg:grid",
            )}
          >
            <span>KOD</span>
            <span>WARTOŚĆ</span>
            <span>UŻYCIA</span>
            <span>WAŻNOŚĆ</span>
            <span>STATUS</span>
            <span>AKTYWNY</span>
            <span />
          </div>

          {codes.map((code) => (
            <Fragment key={code.id}>
              {/* Wiersz tabeli — desktop (lg+) */}
              <div
                className={cn(
                  ROW_GRID,
                  "hidden border-b border-muted px-3 py-3 lg:grid",
                  !code.isActive && "opacity-55",
                )}
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-[13.5px] font-medium tracking-wider">
                    {code.code}
                  </div>
                  {code.description && (
                    <div className="truncate text-[11.5px] text-muted-foreground">
                      {code.description}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="font-mono text-[13px]">
                    {discountValueLabel(code.type, code.value, currency)}
                  </div>
                  {code.minAmountCents !== null && (
                    <div className="truncate text-[11px] text-muted-foreground">
                      od {formatPrice(code.minAmountCents, currency)}
                    </div>
                  )}
                </div>
                <span className="font-mono text-[13px] tabular-nums">
                  {usesLabel(code.usedCount, code.maxUses)}
                </span>
                <span className="truncate font-mono text-[12px] text-muted-foreground">
                  {code.validityLabel}
                </span>
                <StateBadge state={code.state} />
                <Switch
                  checked={code.isActive}
                  disabled={!isManager || isPending}
                  onCheckedChange={(checked) =>
                    toggleActive(code, checked === true)
                  }
                  aria-label={`Aktywność kodu ${code.code}`}
                />
                {isManager ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-self-end"
                    onClick={() => setEditor(discountEditorFor(code))}
                  >
                    Edytuj
                  </Button>
                ) : (
                  <span />
                )}
              </div>

              {/* Karta — telefon/tablet (<lg) */}
              <div
                className={cn(
                  "flex flex-col gap-1.5 border-b border-muted px-1 py-3 lg:hidden",
                  !code.isActive && "opacity-55",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[14px] font-medium tracking-wider">
                    {code.code}
                  </span>
                  <span className="shrink-0 font-mono text-[13px] font-medium">
                    {discountValueLabel(code.type, code.value, currency)}
                  </span>
                  {isManager && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="-my-2 -mr-1 size-11 shrink-0"
                          aria-label={`Akcje kodu ${code.code}`}
                        >
                          <EllipsisVerticalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => setEditor(discountEditorFor(code))}
                        >
                          Edytuj
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={isPending}
                          onClick={() => toggleActive(code, !code.isActive)}
                        >
                          {code.isActive ? "Wyłącz kod" : "Włącz kod"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                {code.description && (
                  <div className="truncate text-[11.5px] text-muted-foreground">
                    {code.description}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-muted-foreground">
                  <StateBadge state={code.state} />
                  <span className="font-mono">
                    {usesLabel(code.usedCount, code.maxUses)} użyć
                  </span>
                  <span className="font-mono">{code.validityLabel}</span>
                  {code.minAmountCents !== null && (
                    <span className="font-mono">
                      od {formatPrice(code.minAmountCents, currency)}
                    </span>
                  )}
                </div>
              </div>
            </Fragment>
          ))}
        </>
      )}

      <DiscountCodeDialog
        businessId={businessId}
        editor={editor}
        onChange={setEditor}
        onClose={() => setEditor(null)}
      />
    </div>
  );
}
