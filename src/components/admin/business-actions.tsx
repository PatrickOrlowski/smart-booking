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
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PanelDialogBody,
  PanelDialogContent,
} from "@/components/panel/panel-dialog";
import { runAction } from "@/components/panel/run-action";
import type { ActionResult } from "@/components/admin/action-result";
import {
  rejectBusinessAction,
  restoreBusinessAction,
  suspendBusinessAction,
  verifyBusinessAction,
} from "@/app/admin/firmy/actions";
import type { BusinessStatus } from "@/generated/prisma/enums";

/**
 * Decyzje platformy na karcie firmy.
 *
 * Akcje nieodwracalne dla właściciela (odrzucenie, zawieszenie) wymagają
 * powodu — dialog nie ma przycisku „na skróty", bo ten tekst zobaczy człowiek
 * po drugiej stronie. Weryfikacja i przywrócenie idą jednym kliknięciem.
 */

type ReasonKind = "reject" | "suspend";

const REASON_COPY: Record<
  ReasonKind,
  { title: string; description: string; label: string; placeholder: string; cta: string }
> = {
  reject: {
    title: "Odrzucić zgłoszenie firmy?",
    description:
      "Firma wróci do statusu „Szkic”. Właściciel zobaczy powód w panelu i będzie mógł poprawić dane oraz zgłosić się ponownie.",
    label: "Powód odrzucenia",
    placeholder: "np. brak numeru NIP w opisie i nieczytelne zdjęcia lokalu",
    cta: "Odrzuć zgłoszenie",
  },
  suspend: {
    title: "Zawiesić firmę?",
    description:
      "Firma natychmiast zniknie z wyszukiwarki, stron miasta i kategorii oraz z własnego profilu publicznego. Istniejące rezerwacje zostają nietknięte.",
    label: "Powód zawieszenia",
    placeholder: "np. zgłoszenia klientów o nieodbieraniu rezerwacji",
    cta: "Zawieś firmę",
  },
};

export function BusinessActions({
  businessId,
  businessName,
  status,
}: {
  businessId: string;
  businessName: string;
  status: BusinessStatus;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<ReasonKind | null>(null);
  const [reason, setReason] = useState("");

  const run = (
    action: () => Promise<ActionResult>,
    successMessage: string,
  ) => {
    startTransition(async () => {
      const result = await runAction(action);
      if (result.ok) {
        toast.success(successMessage);
        setDialog(null);
        setReason("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const submitReason = () => {
    if (!dialog || reason.trim().length < 5) return;
    if (dialog === "reject") {
      run(
        () => rejectBusinessAction({ businessId, reason: reason.trim() }),
        "Zgłoszenie odrzucone — właściciel zobaczy powód w panelu",
      );
    } else {
      run(
        () => suspendBusinessAction({ businessId, reason: reason.trim() }),
        "Firma zawieszona i zdjęta z marketplace'u",
      );
    }
  };

  const copy = dialog ? REASON_COPY[dialog] : null;

  return (
    <section className="rounded-2xl border-[1.5px] border-border-strong bg-card px-4 py-4 sm:px-5">
      <h2 className="text-[14px] font-bold tracking-tight">Decyzje platformy</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
        {status === "PENDING_REVIEW"
          ? "Firma czeka na decyzję. Weryfikacja publikuje ją na marketplace, odrzucenie odsyła do poprawek."
          : status === "SUSPENDED"
            ? "Firma jest zawieszona i nie pojawia się nigdzie publicznie."
            : status === "DRAFT"
              ? "Szkic — właściciel nie zgłosił jeszcze firmy do weryfikacji."
              : "Firma jest opublikowana na marketplace."}
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {status === "PENDING_REVIEW" ? (
          <>
            <Button
              className="h-11 rounded-full px-5 font-semibold lg:h-9"
              disabled={isPending}
              onClick={() =>
                run(
                  () => verifyBusinessAction({ businessId }),
                  "Firma zweryfikowana i widoczna na marketplace",
                )
              }
            >
              {isPending ? "Zapisywanie…" : "Zweryfikuj i opublikuj"}
            </Button>
            <Button
              variant="outline"
              className="h-11 rounded-full px-5 font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive lg:h-9"
              disabled={isPending}
              onClick={() => setDialog("reject")}
            >
              Odrzuć
            </Button>
          </>
        ) : null}

        {status === "SUSPENDED" ? (
          <Button
            className="h-11 rounded-full px-5 font-semibold lg:h-9"
            disabled={isPending}
            onClick={() =>
              run(
                () => restoreBusinessAction({ businessId }),
                "Firma przywrócona na marketplace",
              )
            }
          >
            {isPending ? "Zapisywanie…" : "Przywróć firmę"}
          </Button>
        ) : (
          <Button
            variant="outline"
            className="h-11 rounded-full px-5 font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive lg:h-9"
            disabled={isPending}
            onClick={() => setDialog("suspend")}
          >
            Zawieś firmę
          </Button>
        )}
      </div>

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
            setReason("");
          }
        }}
      >
        {copy ? (
          <PanelDialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription>{copy.description}</DialogDescription>
            </DialogHeader>
            <PanelDialogBody>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="admin-decision-reason">{copy.label}</Label>
                <Textarea
                  id="admin-decision-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={4}
                  placeholder={copy.placeholder}
                />
                <p className="text-[11px] text-muted-foreground">
                  Powód zapisuje się na karcie firmy „{businessName}” i w
                  dzienniku audytu. Minimum 5 znaków.
                </p>
              </div>
            </PanelDialogBody>
            <DialogFooter>
              <Button
                variant="outline"
                className="rounded-full max-lg:h-11"
                onClick={() => setDialog(null)}
                disabled={isPending}
              >
                Anuluj
              </Button>
              <Button
                variant="destructive"
                className="rounded-full font-semibold max-lg:h-11"
                onClick={submitReason}
                disabled={reason.trim().length < 5 || isPending}
              >
                {isPending ? "Zapisywanie…" : copy.cta}
              </Button>
            </DialogFooter>
          </PanelDialogContent>
        ) : null}
      </Dialog>
    </section>
  );
}
