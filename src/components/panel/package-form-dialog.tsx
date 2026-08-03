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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { runAction } from "@/components/panel/run-action";
import {
  deletePackageAction,
  savePackageAction,
} from "@/app/panel/(dashboard)/promocje/actions";

export type PackageEditorState = {
  packageId: string | null;
  name: string;
  description: string;
  /** "any" = karnet na dowolną usługę firmy. */
  serviceChoice: string;
  entries: string;
  priceZl: string;
  validityDays: string;
  isActive: boolean;
  soldCount: number;
};

export const emptyPackageEditor = (): PackageEditorState => ({
  packageId: null,
  name: "",
  description: "",
  serviceChoice: "any",
  entries: "5",
  priceZl: "",
  validityDays: "365",
  isActive: true,
  soldCount: 0,
});

/** Dialog dodania/edycji karnetu w ofercie firmy. */
export function PackageFormDialog({
  businessId,
  services,
  editor,
  onChange,
  onClose,
}: {
  businessId: string;
  services: { id: string; name: string }[];
  editor: PackageEditorState | null;
  onChange: (next: PackageEditorState) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const draft = editor;

  const save = () => {
    if (!draft) return;
    const entries = Number(draft.entries);
    const priceZl = Number(draft.priceZl.replace(",", "."));
    const validityDays = Number(draft.validityDays);

    if (draft.name.trim().length < 3) {
      toast.error("Podaj nazwę karnetu (min. 3 znaki)");
      return;
    }
    if (!Number.isFinite(entries) || entries < 1) {
      toast.error("Karnet musi mieć minimum 1 wejście");
      return;
    }
    if (!Number.isFinite(priceZl) || priceZl < 0) {
      toast.error("Podaj poprawną cenę karnetu");
      return;
    }
    if (!Number.isFinite(validityDays) || validityDays < 1) {
      toast.error("Ważność karnetu: minimum 1 dzień");
      return;
    }

    startTransition(async () => {
      const result = await runAction(() =>
        savePackageAction({
          businessId,
          packageId: draft.packageId ?? undefined,
          name: draft.name.trim(),
          description: draft.description.trim() || undefined,
          serviceId: draft.serviceChoice === "any" ? null : draft.serviceChoice,
          entries: Math.round(entries),
          priceCents: Math.round(priceZl * 100),
          validityDays: Math.round(validityDays),
          isActive: draft.isActive,
        }),
      );
      if (result.ok) {
        toast.success(draft.packageId ? "Zapisano zmiany" : "Karnet dodany");
        onClose();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const remove = () => {
    if (!draft?.packageId) return;
    startTransition(async () => {
      const result = await runAction(() =>
        deletePackageAction({ businessId, packageId: draft.packageId! }),
      );
      if (result.ok) {
        toast.success(
          "deactivated" in result && result.deactivated
            ? "Karnet jest w obiegu u klientów — został wyłączony ze sprzedaży"
            : "Karnet usunięty",
        );
        onClose();
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
        if (!open) onClose();
      }}
    >
      <PanelDialogContent className="sm:max-h-[90vh] sm:max-w-lg sm:overflow-y-auto">
        {draft && (
          <>
            <DialogHeader>
              <DialogTitle>
                {draft.packageId ? "Edycja karnetu" : "Nowy karnet"}
              </DialogTitle>
              <DialogDescription>
                Zmiana liczby wejść nie rusza karnetów już sprzedanych — te
                mają własną pulę utrwaloną przy zakupie.
              </DialogDescription>
            </DialogHeader>

            <PanelDialogBody>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="package-name">Nazwa</Label>
                <Input
                  id="package-name"
                  value={draft.name}
                  onChange={(event) =>
                    onChange({ ...draft, name: event.target.value })
                  }
                  placeholder="np. Karnet: 5 strzyżeń"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="package-description">Opis (opcjonalnie)</Label>
                <Textarea
                  id="package-description"
                  rows={2}
                  value={draft.description}
                  onChange={(event) =>
                    onChange({ ...draft, description: event.target.value })
                  }
                  placeholder="np. Pięć strzyżeń w cenie czterech."
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Usługa objęta karnetem</Label>
                <Select
                  value={draft.serviceChoice}
                  onValueChange={(value) =>
                    onChange({ ...draft, serviceChoice: value })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Dowolna usługa firmy</SelectItem>
                    {services.map((service) => (
                      <SelectItem key={service.id} value={service.id}>
                        {service.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="package-entries">Wejścia</Label>
                  <Input
                    id="package-entries"
                    type="number"
                    min={1}
                    className="font-mono"
                    value={draft.entries}
                    onChange={(event) =>
                      onChange({ ...draft, entries: event.target.value })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="package-price">Cena (zł)</Label>
                  <div className="relative">
                    <Input
                      id="package-price"
                      className="pr-9 font-mono"
                      inputMode="decimal"
                      value={draft.priceZl}
                      onChange={(event) =>
                        onChange({ ...draft, priceZl: event.target.value })
                      }
                      placeholder="360"
                    />
                    <span className="absolute top-1/2 right-3 -translate-y-1/2 font-mono text-xs text-muted-foreground">
                      zł
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="package-validity">Ważność (dni)</Label>
                  <Input
                    id="package-validity"
                    type="number"
                    min={1}
                    className="font-mono"
                    value={draft.validityDays}
                    onChange={(event) =>
                      onChange({ ...draft, validityDays: event.target.value })
                    }
                  />
                </div>
              </div>

              <label className="flex items-center justify-between rounded-xl border border-border bg-card px-3.5 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">
                    W sprzedaży
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                    Wyłączony karnet znika z listy sprzedaży; wykupione
                    egzemplarze działają dalej.
                  </span>
                </span>
                <Switch
                  checked={draft.isActive}
                  onCheckedChange={(checked) =>
                    onChange({ ...draft, isActive: checked === true })
                  }
                />
              </label>
            </PanelDialogBody>

            <DialogFooter className="sm:justify-between">
              {draft.packageId ? (
                <Button
                  variant="destructive"
                  className="rounded-full max-lg:h-11"
                  onClick={remove}
                  disabled={isPending}
                >
                  {draft.soldCount > 0 ? "Wycofaj ze sprzedaży" : "Usuń karnet"}
                </Button>
              ) : (
                <span className="max-sm:hidden" />
              )}
              <div className="flex gap-2 max-sm:flex-col-reverse">
                <Button
                  variant="outline"
                  className="rounded-full max-lg:h-11"
                  onClick={onClose}
                  disabled={isPending}
                >
                  Anuluj
                </Button>
                <Button
                  className="rounded-full font-semibold max-lg:h-11"
                  onClick={save}
                  disabled={isPending || draft.name.trim().length < 3}
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
