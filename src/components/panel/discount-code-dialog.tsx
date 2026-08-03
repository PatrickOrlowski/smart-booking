"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PanelDialogBody,
  PanelDialogContent,
} from "@/components/panel/panel-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { runAction } from "@/components/panel/run-action";
import { normalizeDiscountCode } from "@/lib/discounts";
import type { DiscountType } from "@/generated/prisma/enums";
import {
  deleteDiscountCodeAction,
  saveDiscountCodeAction,
} from "@/app/panel/(dashboard)/promocje/actions";

/** Stan kodu wyprowadzony na serwerze — steruje pigułką statusu na liście. */
export type DiscountCodeState =
  | "active"
  | "inactive"
  | "expired"
  | "exhausted"
  | "scheduled";

export type PanelDiscountCode = {
  id: string;
  code: string;
  description: string | null;
  type: DiscountType;
  /** PERCENT: 1–100, AMOUNT: grosze. */
  value: number;
  minAmountCents: number | null;
  maxUses: number | null;
  maxUsesPerCustomer: number;
  usedCount: number;
  isActive: boolean;
  hasRedemptions: boolean;
  /** Wartości dla <input type="date"> w strefie lokalu ("" = brak). */
  validFromInput: string;
  validToInput: string;
  validityLabel: string;
  state: DiscountCodeState;
};

export type DiscountEditorState = {
  codeId: string | null;
  code: string;
  description: string;
  type: DiscountType;
  /** Procent jako liczba, kwota w zł — konwersja na grosze przy zapisie. */
  value: string;
  minAmountZl: string;
  maxUses: string;
  maxUsesPerCustomer: string;
  validFrom: string;
  validTo: string;
  isActive: boolean;
  hasRedemptions: boolean;
};

const centsToZlInput = (cents: number | null): string =>
  cents == null
    ? ""
    : cents % 100 === 0
      ? String(cents / 100)
      : (cents / 100).toFixed(2);

export const emptyDiscountEditor = (): DiscountEditorState => ({
  codeId: null,
  code: "",
  description: "",
  type: "PERCENT",
  value: "10",
  minAmountZl: "",
  maxUses: "",
  maxUsesPerCustomer: "1",
  validFrom: "",
  validTo: "",
  isActive: true,
  hasRedemptions: false,
});

export const discountEditorFor = (
  code: PanelDiscountCode,
): DiscountEditorState => ({
  codeId: code.id,
  code: code.code,
  description: code.description ?? "",
  type: code.type,
  value:
    code.type === "PERCENT" ? String(code.value) : centsToZlInput(code.value),
  minAmountZl: centsToZlInput(code.minAmountCents),
  maxUses: code.maxUses === null ? "" : String(code.maxUses),
  maxUsesPerCustomer: String(code.maxUsesPerCustomer),
  validFrom: code.validFromInput,
  validTo: code.validToInput,
  isActive: code.isActive,
  hasRedemptions: code.hasRedemptions,
});

const TYPE_OPTIONS: { value: DiscountType; label: string }[] = [
  { value: "PERCENT", label: "Procentowy" },
  { value: "AMOUNT", label: "Kwotowy" },
];

/** Dialog dodania/edycji kodu rabatowego — CRUD zakładki „Kody rabatowe". */
export function DiscountCodeDialog({
  businessId,
  editor,
  onChange,
  onClose,
}: {
  businessId: string;
  /** Stan formularza żyje w widoku listy — dialog jest w pełni kontrolowany. */
  editor: DiscountEditorState | null;
  onChange: (next: DiscountEditorState) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const draft = editor;
  const setDraft = onChange;
  const close = onClose;

  const save = () => {
    if (!draft) return;
    const code = normalizeDiscountCode(draft.code);
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
      toast.error("Kod: 3–32 znaki, litery, cyfry, myślnik lub podkreślenie");
      return;
    }

    const rawValue = Number(draft.value.replace(",", "."));
    if (!Number.isFinite(rawValue) || rawValue <= 0) {
      toast.error("Podaj wartość rabatu większą od zera");
      return;
    }
    if (draft.type === "PERCENT" && (rawValue < 1 || rawValue > 100)) {
      toast.error("Rabat procentowy mieści się w przedziale 1–100%");
      return;
    }
    const value =
      draft.type === "PERCENT"
        ? Math.round(rawValue)
        : Math.round(rawValue * 100);

    const minAmountZl = draft.minAmountZl.trim();
    const minAmountNumber = Number(minAmountZl.replace(",", "."));
    if (minAmountZl !== "" && (!Number.isFinite(minAmountNumber) || minAmountNumber < 0)) {
      toast.error("Nieprawidłowa kwota minimalna");
      return;
    }
    const maxUsesNumber = Number(draft.maxUses);
    if (draft.maxUses.trim() !== "" && (!Number.isFinite(maxUsesNumber) || maxUsesNumber < 1)) {
      toast.error("Limit użyć musi być liczbą większą od zera");
      return;
    }
    const perCustomer = Number(draft.maxUsesPerCustomer || "0");
    if (!Number.isFinite(perCustomer) || perCustomer < 0) {
      toast.error("Nieprawidłowy limit użyć na klienta");
      return;
    }
    if (draft.validFrom && draft.validTo && draft.validTo < draft.validFrom) {
      toast.error("Koniec ważności nie może wypadać przed początkiem");
      return;
    }

    startTransition(async () => {
      const result = await runAction(() =>
        saveDiscountCodeAction({
          businessId,
          codeId: draft.codeId ?? undefined,
          code,
          description: draft.description.trim() || undefined,
          type: draft.type,
          value,
          minAmountCents:
            minAmountZl === "" ? null : Math.round(minAmountNumber * 100),
          maxUses: draft.maxUses.trim() === "" ? null : Math.round(maxUsesNumber),
          maxUsesPerCustomer: Math.round(perCustomer),
          validFrom: draft.validFrom || null,
          validTo: draft.validTo || null,
          isActive: draft.isActive,
        }),
      );
      if (result.ok) {
        toast.success(draft.codeId ? "Zapisano zmiany" : `Kod ${code} dodany`);
        close();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const remove = () => {
    if (!draft?.codeId) return;
    startTransition(async () => {
      const result = await runAction(() =>
        deleteDiscountCodeAction({ businessId, codeId: draft.codeId! }),
      );
      if (result.ok) {
        toast.success(
          "deactivated" in result && result.deactivated
            ? "Kod ma historię użyć — został wyłączony zamiast usunięty"
            : "Kod usunięty",
        );
        close();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog
      open={editor !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <PanelDialogContent className="sm:max-h-[90vh] sm:max-w-lg sm:overflow-y-auto">
        {draft && (
          <>
            <DialogHeader>
              <DialogTitle>
                {draft.codeId ? "Edycja kodu" : "Nowy kod rabatowy"}
              </DialogTitle>
              <DialogDescription>
                Klient wpisuje kod w podsumowaniu rezerwacji — rabat schodzi
                z ceny od razu.
              </DialogDescription>
            </DialogHeader>

            <PanelDialogBody>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="discount-code">Kod</Label>
                <Input
                  id="discount-code"
                  className="font-mono tracking-wider uppercase"
                  value={draft.code}
                  onChange={(event) =>
                    setDraft({ ...draft, code: event.target.value })
                  }
                  placeholder="np. LATO20"
                  autoCapitalize="characters"
                  autoComplete="off"
                />
                <p className="text-[11px] text-muted-foreground">
                  Wielkość liter i spacje nie mają znaczenia — „lato 20” trafi
                  w ten sam kod.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="discount-description">
                  Opis (widoczny tylko dla firmy)
                </Label>
                <Textarea
                  id="discount-description"
                  rows={2}
                  value={draft.description}
                  onChange={(event) =>
                    setDraft({ ...draft, description: event.target.value })
                  }
                  placeholder="np. Rabat wakacyjny na wszystkie usługi"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Typ rabatu</Label>
                <div className="flex flex-wrap gap-1.5">
                  {TYPE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setDraft({ ...draft, type: option.value })}
                      className={cn(
                        "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors max-lg:min-h-11",
                        draft.type === option.value
                          ? "bg-ink text-ink-foreground"
                          : "border border-border bg-card text-foreground/80",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="discount-value">
                    {draft.type === "PERCENT" ? "Wartość (%)" : "Wartość (zł)"}
                  </Label>
                  <div className="relative">
                    <Input
                      id="discount-value"
                      className="pr-9 font-mono"
                      inputMode="decimal"
                      value={draft.value}
                      onChange={(event) =>
                        setDraft({ ...draft, value: event.target.value })
                      }
                      placeholder={draft.type === "PERCENT" ? "20" : "50"}
                    />
                    <span className="absolute top-1/2 right-3 -translate-y-1/2 font-mono text-xs text-muted-foreground">
                      {draft.type === "PERCENT" ? "%" : "zł"}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="discount-min">Kwota minimalna (zł)</Label>
                  <div className="relative">
                    <Input
                      id="discount-min"
                      className="pr-9 font-mono"
                      inputMode="decimal"
                      value={draft.minAmountZl}
                      onChange={(event) =>
                        setDraft({ ...draft, minAmountZl: event.target.value })
                      }
                      placeholder="bez limitu"
                    />
                    <span className="absolute top-1/2 right-3 -translate-y-1/2 font-mono text-xs text-muted-foreground">
                      zł
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="discount-max-uses">Limit użyć łącznie</Label>
                  <Input
                    id="discount-max-uses"
                    type="number"
                    min={1}
                    className="font-mono"
                    value={draft.maxUses}
                    onChange={(event) =>
                      setDraft({ ...draft, maxUses: event.target.value })
                    }
                    placeholder="bez limitu"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="discount-per-customer">
                    Limit na klienta
                  </Label>
                  <Input
                    id="discount-per-customer"
                    type="number"
                    min={0}
                    className="font-mono"
                    value={draft.maxUsesPerCustomer}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        maxUsesPerCustomer: event.target.value,
                      })
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    0 = bez limitu na jednego klienta.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="discount-from">Ważny od</Label>
                  <Input
                    id="discount-from"
                    type="date"
                    value={draft.validFrom}
                    onChange={(event) =>
                      setDraft({ ...draft, validFrom: event.target.value })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="discount-to">Ważny do (włącznie)</Label>
                  <Input
                    id="discount-to"
                    type="date"
                    value={draft.validTo}
                    onChange={(event) =>
                      setDraft({ ...draft, validTo: event.target.value })
                    }
                  />
                </div>
              </div>

              <label className="flex items-center justify-between rounded-xl border border-border bg-card px-3.5 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">
                    Kod aktywny
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                    Wyłączony kod przestaje działać natychmiast, ale historia
                    użyć zostaje.
                  </span>
                </span>
                <Switch
                  checked={draft.isActive}
                  onCheckedChange={(checked) =>
                    setDraft({ ...draft, isActive: checked === true })
                  }
                />
              </label>
            </PanelDialogBody>

            <DialogFooter className="sm:justify-between">
              {draft.codeId ? (
                <Button
                  variant="destructive"
                  className="rounded-full max-lg:h-11"
                  onClick={remove}
                  disabled={isPending}
                >
                  {draft.hasRedemptions ? "Wyłącz kod" : "Usuń kod"}
                </Button>
              ) : (
                <span className="max-sm:hidden" />
              )}
              <div className="flex gap-2 max-sm:flex-col-reverse">
                <Button
                  variant="outline"
                  className="rounded-full max-lg:h-11"
                  onClick={close}
                  disabled={isPending}
                >
                  Anuluj
                </Button>
                <Button
                  className="rounded-full font-semibold max-lg:h-11"
                  onClick={save}
                  disabled={isPending || draft.code.trim().length < 3}
                >
                  {isPending ? "Zapisywanie…" : "Zapisz"}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </PanelDialogContent>
    </Dialog>
  );
}
