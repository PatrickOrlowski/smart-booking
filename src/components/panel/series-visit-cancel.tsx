"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { cancelSeriesBookingAction } from "@/app/panel/(dashboard)/serie/actions";

/**
 * „Odwołaj tę wizytę" — pojedynczy termin serii. Reszta cyklu zostaje,
 * seria nadal jest aktywna.
 */
export function SeriesVisitCancel({
  businessId,
  seriesId,
  bookingId,
  visitLabel,
}: {
  businessId: string;
  seriesId: string;
  bookingId: string;
  visitLabel: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const submit = () => {
    startTransition(async () => {
      const result = await runAction(() =>
        cancelSeriesBookingAction({
          businessId,
          seriesId,
          bookingId,
          reason: reason.trim() || undefined,
        }),
      );
      if (result.ok) {
        toast.success(result.message ?? "Wizyta odwołana");
        setOpen(false);
        setReason("");
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
          className="h-9 shrink-0 rounded-full px-3 text-[12px] font-semibold text-destructive max-md:h-11 max-md:w-full"
        >
          Odwołaj tę wizytę
        </Button>
      </DialogTrigger>
      <PanelDialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Odwołać wizytę {visitLabel}?</DialogTitle>
          <DialogDescription>
            Odwołana zostanie tylko ta jedna wizyta — pozostałe terminy serii
            zostają w kalendarzu. Klient dostanie e-mail z informacją.
          </DialogDescription>
        </DialogHeader>

        <PanelDialogBody>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="visit-cancel-reason">Powód (opcjonalnie)</Label>
            <Input
              id="visit-cancel-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="np. urlop pracownika"
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
            Zostaw wizytę
          </Button>
          <Button
            className="rounded-full bg-destructive font-semibold text-white hover:bg-destructive/90 max-lg:h-11"
            onClick={submit}
            disabled={isPending}
          >
            {isPending ? "Odwoływanie…" : "Odwołaj wizytę"}
          </Button>
        </DialogFooter>
      </PanelDialogContent>
    </Dialog>
  );
}
