"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  PanelDialogBody,
  PanelDialogContent,
} from "@/components/panel/panel-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runAction } from "@/components/panel/run-action";
import { endSeriesAction } from "@/app/panel/(dashboard)/serie/actions";

/**
 * „Zakończ serię" — zamyka regułę i (opcjonalnie) odwołuje wszystkie
 * PRZYSZŁE wizyty. Liczba wizyt do odwołania jest napisana wprost:
 * to operacja, której nie da się cofnąć jednym kliknięciem.
 */
export function SeriesEndDialog({
  businessId,
  seriesId,
  upcomingCount,
  upcomingLabels,
}: {
  businessId: string;
  seriesId: string;
  upcomingCount: number;
  /** Do trzech najbliższych terminów — żeby było widać, co zniknie. */
  upcomingLabels: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [cancelFuture, setCancelFuture] = useState(upcomingCount > 0);
  const [reason, setReason] = useState("");

  const submit = () => {
    startTransition(async () => {
      const result = await runAction(() =>
        endSeriesAction({
          businessId,
          seriesId,
          cancelFuture,
          reason: reason.trim() || undefined,
        }),
      );
      if (result.ok) {
        toast.success(result.message ?? "Seria zakończona");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="h-9 rounded-full px-4 text-[12.5px] font-semibold max-lg:h-11"
        >
          Zakończ serię
        </Button>
      </DialogTrigger>
      <PanelDialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Zakończyć tę serię?</DialogTitle>
          <DialogDescription>
            Seria przestanie być aktywna — nowe wizyty już z niej nie powstaną.
            Wizyty, które już się odbyły, zostają w historii klienta.
          </DialogDescription>
        </DialogHeader>

        <PanelDialogBody>
          {upcomingCount > 0 ? (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border-[1.5px] border-border-strong bg-card px-3 py-3">
              <Checkbox
                checked={cancelFuture}
                onCheckedChange={(checked) => setCancelFuture(checked === true)}
                className="mt-0.5"
              />
              <span className="text-[13px] leading-relaxed">
                <b>
                  Odwołaj wszystkie przyszłe wizyty tej serii (
                  {upcomingCount})
                </b>
                <span className="mt-1 block text-muted-foreground">
                  Klient dostanie e-mail o odwołaniu każdej z nich, a zadatki
                  zostaną rozliczone.
                </span>
                {upcomingLabels.length > 0 ? (
                  <span className="mt-1.5 block font-mono text-[11px] text-muted-foreground">
                    {upcomingLabels.join(" · ")}
                    {upcomingCount > upcomingLabels.length ? " · …" : ""}
                  </span>
                ) : null}
              </span>
            </label>
          ) : (
            <p className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-[12.5px] text-muted-foreground">
              Ta seria nie ma już przyszłych wizyt — zostanie tylko zamknięta.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="series-end-reason">Powód (opcjonalnie)</Label>
            <Input
              id="series-end-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="np. klient rezygnuje ze stałego terminu"
            />
          </div>
        </PanelDialogBody>

        <DialogFooter>
          <Button
            variant="outline"
            className="rounded-full max-lg:h-11"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Anuluj
          </Button>
          <Button
            className="rounded-full bg-destructive font-semibold text-white hover:bg-destructive/90 max-lg:h-11"
            onClick={submit}
            disabled={isPending}
          >
            {isPending
              ? "Kończenie…"
              : cancelFuture && upcomingCount > 0
                ? `Zakończ i odwołaj ${upcomingCount}`
                : "Zakończ serię"}
          </Button>
        </DialogFooter>
      </PanelDialogContent>
    </Dialog>
  );
}
