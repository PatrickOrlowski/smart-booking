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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  blockCustomerAction,
  unblockCustomerAction,
} from "@/app/panel/(dashboard)/klienci/actions";

/**
 * Sekcja blokady rezerwacji online na karcie klienta.
 *
 * Zablokowany: powód + data + „Odblokuj" (jedno kliknięcie).
 * Odblokowany: „Zablokuj" otwiera dialog z obowiązkowym powodem.
 * Mutacje i audyt idą przez src/lib/no-show.ts po stronie akcji serwera.
 */
export function CustomerBlockControls({
  businessId,
  customerId,
  customerName,
  isBlocked,
  blockedReason,
  blockedAtLabel,
  canManage,
}: {
  businessId: string;
  customerId: string;
  customerName: string;
  isBlocked: boolean;
  blockedReason: string | null;
  blockedAtLabel: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState("");

  const unblock = () => {
    startTransition(async () => {
      const result = await unblockCustomerAction({ businessId, customerId });
      if (result.ok) {
        toast.success("Klient odblokowany — może znów rezerwować online");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const block = () => {
    if (reason.trim().length < 3) return;
    startTransition(async () => {
      const result = await blockCustomerAction({
        businessId,
        customerId,
        reason: reason.trim(),
      });
      if (result.ok) {
        toast.success("Klient zablokowany");
        setDialogOpen(false);
        setReason("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <section
      className={
        isBlocked
          ? "rounded-2xl border-[1.5px] border-destructive/40 bg-card px-4 py-4 sm:px-5"
          : "rounded-2xl border border-border bg-card px-4 py-4 sm:px-5"
      }
    >
      <h2 className="text-[14px] font-bold tracking-tight">
        Blokada rezerwacji
      </h2>

      {isBlocked ? (
        <>
          <div className="mt-2.5 rounded-lg bg-destructive/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-destructive">
            <span className="font-semibold">Klient zablokowany.</span>{" "}
            {blockedReason ?? "Bez podanego powodu."}
            {blockedAtLabel ? (
              <span className="mt-1 block font-mono text-[10.5px] opacity-80">
                od {blockedAtLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            Nie może rezerwować online w twojej firmie. Wizyty dodane ręcznie
            przez obsługę nadal są możliwe.
          </p>
          {canManage ? (
            <Button
              variant="outline"
              className="mt-3 h-11 w-full rounded-full border-[1.5px] border-border-strong font-semibold lg:h-9"
              onClick={unblock}
              disabled={isPending}
            >
              {isPending ? "Odblokowywanie…" : "Odblokuj klienta"}
            </Button>
          ) : null}
        </>
      ) : (
        <>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
            Klient może rezerwować online. Blokada wyłącza rezerwacje online w
            twojej firmie — nakłada się też automatycznie po przekroczeniu
            limitu nieobecności.
          </p>
          {canManage ? (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="mt-3 h-11 w-full rounded-full font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive lg:h-9"
                >
                  Zablokuj klienta
                </Button>
              </DialogTrigger>
              <PanelDialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Zablokować klienta?</DialogTitle>
                  <DialogDescription>
                    {customerName} straci możliwość rezerwacji online w twojej
                    firmie. Blokadę można zdjąć w każdej chwili.
                  </DialogDescription>
                </DialogHeader>
                <PanelDialogBody>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="block-reason">Powód blokady</Label>
                    <Textarea
                      id="block-reason"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      rows={3}
                      placeholder="np. wielokrotne odwoływanie wizyt w ostatniej chwili"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Powód trafia do dziennika aktywności i na kartę klienta.
                    </p>
                  </div>
                </PanelDialogBody>
                <DialogFooter>
                  <Button
                    variant="outline"
                    className="rounded-full max-lg:h-11"
                    onClick={() => setDialogOpen(false)}
                    disabled={isPending}
                  >
                    Anuluj
                  </Button>
                  <Button
                    variant="destructive"
                    className="rounded-full font-semibold max-lg:h-11"
                    onClick={block}
                    disabled={reason.trim().length < 3 || isPending}
                  >
                    {isPending ? "Blokowanie…" : "Zablokuj"}
                  </Button>
                </DialogFooter>
              </PanelDialogContent>
            </Dialog>
          ) : null}
        </>
      )}
    </section>
  );
}
