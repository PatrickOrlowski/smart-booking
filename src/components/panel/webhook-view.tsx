"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { WebhookIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  PanelDialogBody,
  PanelDialogContent,
} from "@/components/panel/panel-dialog";
import { runAction } from "@/components/panel/run-action";
import { CopyButton } from "@/components/panel/api-key-view";
import {
  deleteWebhookAction,
  retryDeliveryAction,
  saveWebhookAction,
  sendTestWebhookAction,
} from "@/app/panel/(dashboard)/integracje/actions";

export type PanelWebhook = {
  id: string;
  url: string;
  events: string[];
  description: string | null;
  isActive: boolean;
  createdLabel: string;
};

export type PanelDelivery = {
  id: string;
  webhookUrl: string;
  event: string;
  status: "PENDING" | "DELIVERED" | "FAILED";
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  createdLabel: string;
  nextRetryLabel: string | null;
};

/** Zdarzenia do wyboru w edytorze — etykiety po polsku. */
const EVENT_OPTIONS: { value: string; label: string }[] = [
  { value: "booking.created", label: "Nowa rezerwacja (booking.created)" },
  {
    value: "booking.cancelled",
    label: "Anulowanie rezerwacji (booking.cancelled)",
  },
];

const STATUS_BADGE: Record<
  PanelDelivery["status"],
  { label: string; className: string }
> = {
  DELIVERED: { label: "DORĘCZONA", className: "bg-success-soft text-success" },
  PENDING: { label: "W TOKU", className: "bg-accent text-primary" },
  FAILED: {
    label: "NIEUDANA",
    className: "bg-warning-soft text-warning-strong",
  },
};

type EditorState = {
  webhookId: string | null;
  url: string;
  events: string[];
  description: string;
  isActive: boolean;
};

const emptyEditor = (): EditorState => ({
  webhookId: null,
  url: "",
  events: ["booking.created", "booking.cancelled"],
  description: "",
  isActive: true,
});

/**
 * Zakładka „Webhooki": CRUD webhooków (URL, zdarzenia, opis), sekret
 * pokazywany raz po utworzeniu, testowe zdarzenie i lista ostatnich 20
 * dostaw ze statusem, kodem odpowiedzi, błędem i akcją „Ponów".
 */
export function WebhookView({
  businessId,
  webhooks,
  deliveries,
  isManager,
}: {
  businessId: string;
  webhooks: PanelWebhook[];
  deliveries: PanelDelivery[];
  isManager: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const save = () => {
    if (!editor) return;
    startTransition(async () => {
      const result = await runAction(() =>
        saveWebhookAction({
          businessId,
          webhookId: editor.webhookId ?? undefined,
          url: editor.url,
          events: editor.events,
          description: editor.description || undefined,
          isActive: editor.isActive,
        }),
      );
      if (result.ok) {
        setEditor(null);
        if (result.data.secret) {
          setCreatedSecret(result.data.secret);
        } else {
          toast.success("Webhook zapisany");
        }
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const remove = (hook: PanelWebhook) => {
    if (
      !window.confirm(
        `Usunąć webhook ${hook.url}? Historia dostaw też zniknie.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await runAction(() =>
        deleteWebhookAction({ businessId, webhookId: hook.id }),
      );
      if (result.ok) {
        toast.success("Webhook usunięty");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const sendTest = (hook: PanelWebhook) => {
    startTransition(async () => {
      const result = await runAction(() =>
        sendTestWebhookAction({ businessId, webhookId: hook.id }),
      );
      if (result.ok) {
        if (result.data.delivered) {
          toast.success(
            `Testowe zdarzenie doręczone (HTTP ${result.data.responseStatus})`,
          );
        } else {
          toast.error(
            `Dostawa nieudana: ${result.data.error ?? `HTTP ${result.data.responseStatus}`}`,
          );
        }
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const retry = (delivery: PanelDelivery) => {
    startTransition(async () => {
      const result = await runAction(() =>
        retryDeliveryAction({ businessId, deliveryId: delivery.id }),
      );
      if (result.ok) {
        if (result.data.delivered) {
          toast.success("Dostawa doręczona");
        } else {
          toast.error(
            `Nadal nieudana: ${result.data.error ?? `HTTP ${result.data.responseStatus}`}`,
          );
        }
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const toggleEvent = (value: string, checked: boolean) => {
    setEditor((state) =>
      state
        ? {
            ...state,
            events: checked
              ? [...state.events, value]
              : state.events.filter((event) => event !== value),
          }
        : state,
    );
  };

  return (
    <div className="flex flex-col gap-8">
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12.5px] text-muted-foreground">
            Webhook dostaje POST z podpisem HMAC (nagłówek{" "}
            <span className="font-mono text-[11.5px]">X-Planner-Signature</span>
            ) przy każdym wybranym zdarzeniu.
          </p>
          {isManager && (
            <Button
              className="h-11 rounded-full px-5 font-semibold lg:h-8 lg:px-4"
              onClick={() => setEditor(emptyEditor())}
            >
              + Dodaj webhook
            </Button>
          )}
        </div>

        {webhooks.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-16 text-center">
            <WebhookIcon className="size-8 text-muted-foreground" />
            <h2 className="font-display text-2xl font-extrabold tracking-tight">
              Jeszcze bez webhooków
            </h2>
            <p className="max-w-sm text-[13px] text-muted-foreground">
              Twój system dowie się o nowej albo anulowanej rezerwacji od
              razu — bez odpytywania API.
            </p>
            {isManager && (
              <Button
                className="rounded-full px-5 font-semibold max-lg:h-11"
                onClick={() => setEditor(emptyEditor())}
              >
                + Dodaj webhook
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {webhooks.map((hook) => (
              <div
                key={hook.id}
                className={cn(
                  "rounded-2xl border border-border bg-card p-4",
                  !hook.isActive && "opacity-55",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="truncate font-mono text-[13px] font-medium">
                      {hook.url}
                    </div>
                    {hook.description && (
                      <div className="mt-0.5 text-[12px] text-muted-foreground">
                        {hook.description}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {!hook.isActive && (
                        <span className="rounded-md bg-muted px-2 py-1 font-mono text-[10px] tracking-wide text-muted-foreground">
                          WYŁĄCZONY
                        </span>
                      )}
                      {hook.events.map((event) => (
                        <span
                          key={event}
                          className="rounded-md bg-secondary px-2 py-1 font-mono text-[10px] tracking-wide text-foreground/80"
                        >
                          {event}
                        </span>
                      ))}
                      <span className="font-mono text-[10.5px] text-muted-foreground">
                        od {hook.createdLabel}
                      </span>
                    </div>
                  </div>
                  {isManager && (
                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="max-lg:h-11"
                        disabled={isPending}
                        onClick={() => sendTest(hook)}
                      >
                        Wyślij test
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="max-lg:h-11"
                        onClick={() =>
                          setEditor({
                            webhookId: hook.id,
                            url: hook.url,
                            events: hook.events,
                            description: hook.description ?? "",
                            isActive: hook.isActive,
                          })
                        }
                      >
                        Edytuj
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive max-lg:h-11"
                        disabled={isPending}
                        onClick={() => remove(hook)}
                      >
                        Usuń
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {webhooks.length > 0 && (
        <section>
          <div className="meta-label mb-3">OSTATNIE DOSTAWY</div>
          {deliveries.length === 0 ? (
            <p className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
              Jeszcze żadnych dostaw — utwórz rezerwację albo wyślij testowe
              zdarzenie.
            </p>
          ) : (
            <div className="flex flex-col">
              {deliveries.map((delivery) => {
                const badge = STATUS_BADGE[delivery.status];
                return (
                  <div
                    key={delivery.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-muted px-1 py-2.5"
                  >
                    <span
                      className={cn(
                        "rounded-md px-2 py-1 font-mono text-[10px] tracking-wide",
                        badge.className,
                      )}
                    >
                      {badge.label}
                    </span>
                    <span className="font-mono text-[12px] font-medium">
                      {delivery.event}
                    </span>
                    <span className="min-w-0 flex-1 basis-40 truncate font-mono text-[11.5px] text-muted-foreground">
                      {delivery.webhookUrl}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {delivery.createdLabel}
                      {" · próba "}
                      {delivery.attempts}/5
                      {delivery.responseStatus !== null &&
                        ` · HTTP ${delivery.responseStatus}`}
                    </span>
                    {delivery.status !== "DELIVERED" && isManager && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full font-semibold max-lg:h-11"
                        disabled={isPending}
                        onClick={() => retry(delivery)}
                      >
                        Ponów
                      </Button>
                    )}
                    {delivery.lastError && (
                      <span className="w-full truncate font-mono text-[11px] text-destructive">
                        {delivery.lastError}
                        {delivery.nextRetryLabel &&
                          ` · kolejna próba ${delivery.nextRetryLabel}`}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Dialog edytora webhooka */}
      <Dialog open={editor !== null} onOpenChange={(open) => !open && setEditor(null)}>
        <PanelDialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display tracking-tight">
              {editor?.webhookId ? "Edytuj webhook" : "Nowy webhook"}
            </DialogTitle>
            <DialogDescription>
              Zdarzenia wysyłamy jako POST na wskazany adres, z podpisem HMAC
              SHA-256 sekretem webhooka.
            </DialogDescription>
          </DialogHeader>
          {editor && (
            <PanelDialogBody>
              <div className="flex flex-col gap-2">
                <Label htmlFor="webhook-url">Adres URL</Label>
                <Input
                  id="webhook-url"
                  value={editor.url}
                  placeholder="https://twoj-system.pl/webhooki/planner"
                  onChange={(event) =>
                    setEditor({ ...editor, url: event.target.value })
                  }
                />
              </div>
              <div className="flex flex-col gap-2.5">
                <Label>Zdarzenia</Label>
                {EVENT_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[13px] sm:min-h-0"
                  >
                    <Checkbox
                      checked={editor.events.includes(option.value)}
                      onCheckedChange={(checked) =>
                        toggleEvent(option.value, checked === true)
                      }
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="webhook-description">Opis (opcjonalny)</Label>
                <Input
                  id="webhook-description"
                  value={editor.description}
                  maxLength={200}
                  placeholder="np. Integracja z systemem kasowym"
                  onChange={(event) =>
                    setEditor({ ...editor, description: event.target.value })
                  }
                />
              </div>
              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-[13px] font-medium sm:min-h-0">
                Webhook aktywny
                <Switch
                  checked={editor.isActive}
                  onCheckedChange={(checked) =>
                    setEditor({ ...editor, isActive: checked === true })
                  }
                />
              </label>
            </PanelDialogBody>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-full font-semibold max-sm:h-11"
              onClick={() => setEditor(null)}
            >
              Anuluj
            </Button>
            <Button
              className="rounded-full font-semibold max-sm:h-11"
              disabled={
                isPending ||
                !editor ||
                editor.url.trim().length < 8 ||
                editor.events.length === 0
              }
              onClick={save}
            >
              {isPending ? "Zapisywanie…" : "Zapisz webhook"}
            </Button>
          </DialogFooter>
        </PanelDialogContent>
      </Dialog>

      {/* Dialog: sekret — pokazywany JEDEN raz po utworzeniu */}
      <Dialog
        open={createdSecret !== null}
        onOpenChange={(open) => !open && setCreatedSecret(null)}
      >
        <PanelDialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display tracking-tight">
              Webhook dodany
            </DialogTitle>
            <DialogDescription>
              Tym sekretem zweryfikujesz podpis każdej dostawy.
            </DialogDescription>
          </DialogHeader>
          <PanelDialogBody>
            <div className="rounded-xl border-[1.5px] border-border-strong bg-muted/40 p-3">
              <div className="meta-label mb-1.5">SEKRET PODPISU</div>
              <code className="block font-mono text-[12.5px] break-all select-all">
                {createdSecret}
              </code>
            </div>
            <div className="rounded-xl bg-warning-soft px-3 py-2.5 text-[12.5px] text-warning-strong">
              Sekret widzisz <strong>tylko raz</strong>. Porównuj nagłówek{" "}
              <span className="font-mono">X-Planner-Signature</span> z HMAC
              SHA-256 surowego body — szczegóły w dokumentacji API.
            </div>
          </PanelDialogBody>
          <DialogFooter>
            {createdSecret && (
              <CopyButton
                value={createdSecret}
                label="Kopiuj sekret"
                className="max-sm:h-11"
              />
            )}
            <Button
              className="rounded-full font-semibold max-sm:h-11"
              onClick={() => setCreatedSecret(null)}
            >
              Zapisałem sekret
            </Button>
          </DialogFooter>
        </PanelDialogContent>
      </Dialog>
    </div>
  );
}
