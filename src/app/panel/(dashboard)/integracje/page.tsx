import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { getPanelBusiness } from "@/app/panel/data";
import { cn } from "@/lib/utils";
import { ApiKeyView, CopyButton, type PanelApiKey } from "@/components/panel/api-key-view";
import {
  WebhookView,
  type PanelDelivery,
  type PanelWebhook,
} from "@/components/panel/webhook-view";

export const metadata: Metadata = {
  title: "Integracje — panel firmy",
};

/** Lista dostaw i znaczniki użycia kluczy starzeją się z czasem — bez cache. */
export const dynamic = "force-dynamic";

type TabKey = "klucze" | "webhooki" | "widget";

const TABS: { key: TabKey; label: string }[] = [
  { key: "klucze", label: "Klucze API" },
  { key: "webhooki", label: "Webhooki" },
  { key: "widget", label: "Widget" },
];

const dateTimeFormatter = (timezone: string) =>
  new Intl.DateTimeFormat("pl-PL", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Integracje firmy: klucze publicznego API, webhooki z historią dostaw
 * i widget rezerwacji do osadzenia na własnej stronie.
 */
export default async function IntegracjePage({
  searchParams,
}: {
  searchParams: Promise<{ zakladka?: string }>;
}) {
  const [panel, params] = await Promise.all([getPanelBusiness(), searchParams]);
  if (!panel) redirect("/panel/nowa");

  const { business, location, isManager } = panel;
  const timezone = location?.timezone ?? "Europe/Warsaw";
  const activeTab: TabKey =
    params.zakladka === "webhooki"
      ? "webhooki"
      : params.zakladka === "widget"
        ? "widget"
        : "klucze";

  const [keys, webhooks, deliveries] = await Promise.all([
    prisma.apiKey.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        prefix: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
      },
    }),
    prisma.webhook.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        url: true,
        events: true,
        description: true,
        isActive: true,
        createdAt: true,
      },
    }),
    prisma.webhookDelivery.findMany({
      where: { webhook: { businessId: business.id } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        event: true,
        status: true,
        attempts: true,
        responseStatus: true,
        lastError: true,
        createdAt: true,
        nextRetryAt: true,
        webhook: { select: { url: true } },
      },
    }),
  ]);

  const formatDateTime = dateTimeFormatter(timezone);

  const keyRows: PanelApiKey[] = keys.map((key) => ({
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    createdLabel: formatDateTime.format(key.createdAt),
    lastUsedLabel: key.lastUsedAt ? formatDateTime.format(key.lastUsedAt) : null,
    revoked: key.revokedAt !== null,
  }));

  const webhookRows: PanelWebhook[] = webhooks.map((hook) => ({
    id: hook.id,
    url: hook.url,
    events: hook.events,
    description: hook.description,
    isActive: hook.isActive,
    createdLabel: formatDateTime.format(hook.createdAt),
  }));

  const deliveryRows: PanelDelivery[] = deliveries.map((delivery) => ({
    id: delivery.id,
    webhookUrl: delivery.webhook.url,
    event: delivery.event,
    status: delivery.status,
    attempts: delivery.attempts,
    responseStatus: delivery.responseStatus,
    lastError: delivery.lastError,
    createdLabel: formatDateTime.format(delivery.createdAt),
    nextRetryLabel: delivery.nextRetryAt
      ? formatDateTime.format(delivery.nextRetryAt)
      : null,
  }));

  const widgetUrl = `${env.NEXT_PUBLIC_APP_URL}/widget/${business.slug}`;
  const iframeSnippet = `<iframe\n  src="${widgetUrl}"\n  style="width:100%;max-width:480px;height:680px;border:0;border-radius:16px"\n  title="Rezerwacja online — ${business.name}"\n  loading="lazy"\n></iframe>`;

  return (
    <div className="px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="meta-label">Integracje</div>
          <h1 className="mt-1 font-display text-[22px] leading-tight font-extrabold tracking-tight sm:text-[27px]">
            API, webhooki i widget
          </h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Połącz Planner z własnym systemem: klucze API do odczytu i
            rezerwacji, webhooki ze zdarzeniami, widget na Twoją stronę.
          </p>
        </div>
        <Link
          href="/panel/integracje/dokumentacja"
          className="flex min-h-11 items-center rounded-full border-[1.5px] border-border-strong bg-card px-4 text-[13px] font-semibold lg:min-h-9"
        >
          Dokumentacja API →
        </Link>
      </div>

      <nav
        aria-label="Sekcje integracji"
        className="mb-5 flex gap-5 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <Link
              key={tab.key}
              href={`/panel/integracje?zakladka=${tab.key}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 flex-none items-center border-b-[2.5px] pb-2 text-[13px] whitespace-nowrap transition-colors lg:min-h-0",
                active
                  ? "border-foreground font-bold text-foreground"
                  : "border-transparent font-medium text-[#8f8b81] hover:text-foreground",
              )}
            >
              {tab.label}
              {tab.key !== "widget" && (
                <span className="ml-1.5 font-mono text-[11px] font-normal text-muted-foreground">
                  {tab.key === "klucze" ? keyRows.length : webhookRows.length}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {activeTab === "klucze" && (
        <ApiKeyView
          businessId={business.id}
          keys={keyRows}
          isManager={isManager}
        />
      )}

      {activeTab === "webhooki" && (
        <WebhookView
          businessId={business.id}
          webhooks={webhookRows}
          deliveries={deliveryRows}
          isManager={isManager}
        />
      )}

      {activeTab === "widget" && (
        <div className="flex max-w-2xl flex-col gap-5">
          <p className="text-[13px] text-muted-foreground">
            Widget to lekka strona rezerwacji Twojej firmy, gotowa do
            osadzenia w ramce <span className="font-mono text-[12px]">&lt;iframe&gt;</span>{" "}
            na dowolnej stronie WWW. Działa też w wąskich kolumnach
            (od 320 px szerokości).
          </p>

          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="meta-label mb-2">KOD DO WKLEJENIA</div>
            <div className="overflow-x-auto rounded-xl bg-ink p-3.5">
              <pre className="font-mono text-[12px] leading-relaxed whitespace-pre text-ink-foreground">
                {iframeSnippet}
              </pre>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <CopyButton value={iframeSnippet} label="Kopiuj kod" />
              <a
                href={widgetUrl}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-11 items-center rounded-full px-4 text-[13px] font-semibold text-primary underline-offset-4 hover:underline lg:min-h-9"
              >
                Podgląd widgetu →
              </a>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 text-[12.5px] text-muted-foreground">
            <div className="meta-label mb-2">WSKAZÓWKI</div>
            <ul className="flex list-disc flex-col gap-1.5 pl-4">
              <li>
                Rezerwacje z widgetu mają w panelu źródło „widget” — łatwo
                sprawdzisz, ile wizyt przynosi Twoja strona.
              </li>
              <li>
                Wysokość ramki dobierz do swojej strony — 680 px mieści cały
                przebieg rezerwacji bez przewijania strony nadrzędnej.
              </li>
              <li>
                Widget pokazuje wyłącznie usługi z włączoną rezerwacją
                online.
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
