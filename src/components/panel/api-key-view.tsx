"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, CopyIcon, KeyRoundIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  PanelDialogBody,
  PanelDialogContent,
} from "@/components/panel/panel-dialog";
import { runAction } from "@/components/panel/run-action";
import {
  createApiKeyAction,
  revokeApiKeyAction,
} from "@/app/panel/(dashboard)/integracje/actions";

export type PanelApiKey = {
  id: string;
  name: string;
  prefix: string;
  createdLabel: string;
  lastUsedLabel: string | null;
  revoked: boolean;
};

/** Przycisk kopiowania z chwilowym potwierdzeniem. */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      className={cn("rounded-full font-semibold", className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.error("Nie udało się skopiować — zaznacz i skopiuj ręcznie");
        }
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? "Skopiowano" : label}
    </Button>
  );
}

const ROW_GRID =
  "grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_auto] items-center gap-x-4";

/**
 * Zakładka „Klucze API": lista kluczy (prefiks, ostatnie użycie) + generowanie
 * z pokazaniem pełnego klucza JEDEN raz i unieważnianie. Desktop = wiersze,
 * telefon/tablet = karty.
 */
export function ApiKeyView({
  businessId,
  keys,
  isManager,
}: {
  businessId: string;
  keys: PanelApiKey[];
  isManager: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState<{
    name: string;
    fullKey: string;
  } | null>(null);

  const create = () => {
    startTransition(async () => {
      const result = await runAction(() =>
        createApiKeyAction({ businessId, name }),
      );
      if (result.ok) {
        setCreateOpen(false);
        setName("");
        setCreatedKey({ name: result.data.name, fullKey: result.data.fullKey });
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const revoke = (key: PanelApiKey) => {
    if (
      !window.confirm(
        `Unieważnić klucz „${key.name}" (${key.prefix}…)? Integracja, która go używa, natychmiast straci dostęp.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await runAction(() =>
        revokeApiKeyAction({ businessId, keyId: key.id }),
      );
      if (result.ok) {
        toast.success("Klucz unieważniony");
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
          Klucz uwierzytelnia publiczne API (nagłówek{" "}
          <span className="font-mono text-[11.5px]">
            Authorization: Bearer pk_…
          </span>
          ) w zakresie Twojej firmy.
        </p>
        {isManager && (
          <Button
            className="h-11 rounded-full px-5 font-semibold lg:h-8 lg:px-4"
            onClick={() => setCreateOpen(true)}
          >
            + Wygeneruj klucz
          </Button>
        )}
      </div>

      {keys.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-16 text-center">
          <KeyRoundIcon className="size-8 text-muted-foreground" />
          <h2 className="font-display text-2xl font-extrabold tracking-tight">
            Jeszcze bez kluczy
          </h2>
          <p className="max-w-sm text-[13px] text-muted-foreground">
            Klucz API pozwala Twojemu systemowi (kasa, CRM, strona) czytać
            cennik i grafik oraz tworzyć rezerwacje.
          </p>
          {isManager && (
            <Button
              className="rounded-full px-5 font-semibold max-lg:h-11"
              onClick={() => setCreateOpen(true)}
            >
              + Wygeneruj klucz
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
            <span>NAZWA</span>
            <span>PREFIKS</span>
            <span>UTWORZONY</span>
            <span>OSTATNIE UŻYCIE</span>
            <span />
          </div>

          {keys.map((key) => (
            <Fragment key={key.id}>
              {/* Wiersz — desktop (lg+) */}
              <div
                className={cn(
                  ROW_GRID,
                  "hidden border-b border-muted px-3 py-3 lg:grid",
                  key.revoked && "opacity-55",
                )}
              >
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-semibold">
                    {key.name}
                  </div>
                  {key.revoked && (
                    <div className="font-mono text-[10px] tracking-wide text-destructive">
                      UNIEWAŻNIONY
                    </div>
                  )}
                </div>
                <span className="truncate font-mono text-[13px]">
                  {key.prefix}_…
                </span>
                <span className="font-mono text-[12px] text-muted-foreground">
                  {key.createdLabel}
                </span>
                <span className="font-mono text-[12px] text-muted-foreground">
                  {key.lastUsedLabel ?? "nigdy"}
                </span>
                {isManager && !key.revoked ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-self-end text-destructive hover:text-destructive"
                    disabled={isPending}
                    onClick={() => revoke(key)}
                  >
                    Unieważnij
                  </Button>
                ) : (
                  <span />
                )}
              </div>

              {/* Karta — telefon/tablet (<lg) */}
              <div
                className={cn(
                  "flex flex-col gap-1.5 border-b border-muted px-1 py-3 lg:hidden",
                  key.revoked && "opacity-55",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                    {key.name}
                  </span>
                  {isManager && !key.revoked && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-my-1 h-11 shrink-0 text-destructive hover:text-destructive"
                      disabled={isPending}
                      onClick={() => revoke(key)}
                    >
                      Unieważnij
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
                  <span>{key.prefix}_…</span>
                  <span>od {key.createdLabel}</span>
                  <span>użyty: {key.lastUsedLabel ?? "nigdy"}</span>
                  {key.revoked && (
                    <span className="tracking-wide text-destructive">
                      UNIEWAŻNIONY
                    </span>
                  )}
                </div>
              </div>
            </Fragment>
          ))}
        </>
      )}

      {/* Dialog: nazwa nowego klucza */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => !open && setCreateOpen(false)}
      >
        <PanelDialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display tracking-tight">
              Nowy klucz API
            </DialogTitle>
            <DialogDescription>
              Nazwa pomaga rozpoznać integrację na liście — np. „System
              kasowy” albo „Strona WWW”.
            </DialogDescription>
          </DialogHeader>
          <PanelDialogBody>
            <div className="flex flex-col gap-2">
              <Label htmlFor="api-key-name">Nazwa klucza</Label>
              <Input
                id="api-key-name"
                value={name}
                maxLength={80}
                placeholder="np. System kasowy"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && name.trim().length >= 2) create();
                }}
              />
            </div>
          </PanelDialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-full font-semibold max-sm:h-11"
              onClick={() => setCreateOpen(false)}
            >
              Anuluj
            </Button>
            <Button
              className="rounded-full font-semibold max-sm:h-11"
              disabled={isPending || name.trim().length < 2}
              onClick={create}
            >
              {isPending ? "Generowanie…" : "Wygeneruj klucz"}
            </Button>
          </DialogFooter>
        </PanelDialogContent>
      </Dialog>

      {/* Dialog: pełny klucz — pokazywany JEDEN raz */}
      <Dialog
        open={createdKey !== null}
        onOpenChange={(open) => !open && setCreatedKey(null)}
      >
        <PanelDialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display tracking-tight">
              Klucz „{createdKey?.name}” gotowy
            </DialogTitle>
            <DialogDescription>
              Skopiuj klucz teraz i zapisz w bezpiecznym miejscu.
            </DialogDescription>
          </DialogHeader>
          <PanelDialogBody>
            <div className="rounded-xl border-[1.5px] border-border-strong bg-muted/40 p-3">
              <div className="meta-label mb-1.5">TWÓJ KLUCZ API</div>
              <code className="block font-mono text-[12.5px] break-all select-all">
                {createdKey?.fullKey}
              </code>
            </div>
            <div className="rounded-xl bg-warning-soft px-3 py-2.5 text-[12.5px] text-warning-strong">
              Ten klucz widzisz <strong>tylko raz</strong> — przechowujemy
              wyłącznie jego skrót. Po zamknięciu okna nie da się go
              odtworzyć; w razie zgubienia wygeneruj nowy i unieważnij stary.
            </div>
          </PanelDialogBody>
          <DialogFooter>
            {createdKey && (
              <CopyButton
                value={createdKey.fullKey}
                label="Kopiuj klucz"
                className="max-sm:h-11"
              />
            )}
            <Button
              className="rounded-full font-semibold max-sm:h-11"
              onClick={() => setCreatedKey(null)}
            >
              Zapisałem klucz
            </Button>
          </DialogFooter>
        </PanelDialogContent>
      </Dialog>
    </div>
  );
}
