import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Webhooki wychodzące — emisja zdarzeń do integratorów.
 *
 * emitEvent() tworzy wiersz WebhookDelivery (PENDING) dla każdego aktywnego
 * webhooka subskrybującego zdarzenie i od razu próbuje dostarczyć. Porażka
 * zostawia FAILED z `nextRetryAt` (backoff wykładniczy), które domyka cron
 * /api/cron/webhooks.
 *
 * Wywołanie: ZAWSZE przez `after()` z next/server. Powód: after() wykonuje
 * pracę PO wysłaniu odpowiedzi, ale wciąż w ramach tej samej inwokacji —
 * platforma serverless utrzymuje funkcję przy życiu do końca callbacku.
 * Goły `void emitEvent(...)` bez await mógłby zostać ubity w połowie fetcha
 * przy zamrożeniu instancji, a `await` przed odpowiedzią wiązałby czas
 * odpowiedzi rezerwacji z czasem odpowiedzi cudzego serwera (do 5 s na hook).
 * emitEvent sam nigdy nie rzuca — awaria emisji nie może dotknąć rezerwacji.
 */

export const WEBHOOK_EVENTS = ["booking.created", "booking.cancelled"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  "booking.created": "Nowa rezerwacja",
  "booking.cancelled": "Anulowanie rezerwacji",
};

/** Maksymalna liczba prób dostarczenia (1 od razu + 4 ponowienia). */
export const MAX_DELIVERY_ATTEMPTS = 5;

/** Odstępy ponowień po kolejnych porażkach: 1 min, 5 min, 30 min, 2 h. */
const RETRY_DELAYS_MIN = [1, 5, 30, 120] as const;

/** Timeout pojedynczej próby dostarczenia. */
const DELIVERY_TIMEOUT_MS = 5_000;

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

/** Podpis payloadu: HMAC SHA-256 sekretem webhooka, hex. */
export function signWebhookPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export type DeliveryTarget = {
  id: string;
  event: string;
  payload: Prisma.JsonValue;
  /** Liczba prób wykonanych PRZED tym wywołaniem. */
  attempts: number;
  url: string;
  secret: string;
};

export type DeliveryOutcome = {
  delivered: boolean;
  responseStatus: number | null;
  error: string | null;
};

/**
 * Jedna próba dostarczenia + aktualizacja wiersza WebhookDelivery.
 * Sukces → DELIVERED; porażka → FAILED z nextRetryAt wg backoffu
 * (albo bez, gdy wyczerpano MAX_DELIVERY_ATTEMPTS).
 */
export async function attemptDelivery(
  target: DeliveryTarget,
): Promise<DeliveryOutcome> {
  const body = JSON.stringify(target.payload);
  const signature = signWebhookPayload(target.secret, body);

  let responseStatus: number | null = null;
  let error: string | null = null;
  let delivered = false;

  try {
    const response = await fetch(target.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Planner-Event": target.event,
        "X-Planner-Delivery": target.id,
        "X-Planner-Signature": `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    responseStatus = response.status;
    if (response.ok) {
      delivered = true;
    } else {
      error = `Odpowiedź HTTP ${response.status}`;
    }
  } catch (cause) {
    error =
      cause instanceof Error
        ? `${cause.name}: ${cause.message}`.slice(0, 500)
        : "Nieznany błąd sieci";
  }

  const attemptsAfter = target.attempts + 1;
  const nextRetryAt =
    !delivered && attemptsAfter < MAX_DELIVERY_ATTEMPTS
      ? new Date(
          Date.now() +
            RETRY_DELAYS_MIN[
              Math.min(attemptsAfter - 1, RETRY_DELAYS_MIN.length - 1)
            ]! *
              60_000,
        )
      : null;

  try {
    await prisma.webhookDelivery.update({
      where: { id: target.id },
      data: delivered
        ? {
            status: "DELIVERED",
            attempts: attemptsAfter,
            responseStatus,
            lastError: null,
            nextRetryAt: null,
            deliveredAt: new Date(),
          }
        : {
            status: "FAILED",
            attempts: attemptsAfter,
            responseStatus,
            lastError: error,
            nextRetryAt,
          },
    });
  } catch (updateError) {
    console.error(
      "webhooks: nie udało się zapisać wyniku dostawy:",
      updateError,
    );
  }

  return { delivered, responseStatus, error };
}

/**
 * Emisja zdarzenia do wszystkich aktywnych webhooków firmy subskrybujących
 * `event`. Nigdy nie rzuca. Wołać przez `after()` — patrz komentarz modułu.
 */
export async function emitEvent(
  businessId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const hooks = await prisma.webhook.findMany({
      where: { businessId, isActive: true, events: { has: event } },
      select: { id: true, url: true, secret: true },
    });
    if (hooks.length === 0) return;

    const envelope = {
      event,
      occurredAt: new Date().toISOString(),
      data: payload,
    } satisfies Record<string, unknown>;

    // Najpierw trwałe wiersze PENDING — nawet gdy proces padnie przed próbą
    // dostarczenia, cron podniesie je jako zaległe.
    const deliveries = await Promise.all(
      hooks.map((hook) =>
        prisma.webhookDelivery.create({
          data: {
            webhookId: hook.id,
            event,
            payload: envelope as Prisma.InputJsonValue,
            status: "PENDING",
          },
          select: { id: true },
        }),
      ),
    );

    await Promise.allSettled(
      hooks.map((hook, index) =>
        attemptDelivery({
          id: deliveries[index]!.id,
          event,
          payload: envelope as Prisma.JsonValue,
          attempts: 0,
          url: hook.url,
          secret: hook.secret,
        }),
      ),
    );
  } catch (error) {
    console.error(`webhooks: emisja ${event} nie powiodła się:`, error);
  }
}

/**
 * Testowe zdarzenie z panelu — dostarczane niezależnie od subskrypcji,
 * z przykładowym payloadem. Zwraca wynik pierwszej (jedynej) próby.
 */
export async function sendTestEvent(webhookId: string): Promise<
  | { ok: true; outcome: DeliveryOutcome }
  | { ok: false; error: string }
> {
  const hook = await prisma.webhook.findUnique({
    where: { id: webhookId },
    select: { id: true, url: true, secret: true },
  });
  if (!hook) return { ok: false, error: "Nie znaleziono webhooka" };

  const envelope = {
    event: "test",
    occurredAt: new Date().toISOString(),
    data: {
      message: "Testowe zdarzenie z panelu Planner — konfiguracja działa.",
    },
  };

  const delivery = await prisma.webhookDelivery.create({
    data: {
      webhookId: hook.id,
      event: "test",
      payload: envelope,
      status: "PENDING",
    },
    select: { id: true },
  });

  const outcome = await attemptDelivery({
    id: delivery.id,
    event: "test",
    payload: envelope as Prisma.JsonValue,
    attempts: 0,
    url: hook.url,
    secret: hook.secret,
  });
  return { ok: true, outcome };
}
