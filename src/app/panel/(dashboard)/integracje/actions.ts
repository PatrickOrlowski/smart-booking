"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import {
  ForbiddenError,
  UnauthorizedError,
  requireBusinessManager,
} from "@/lib/authz";
import { generateApiKey } from "@/lib/api-keys";
import {
  attemptDelivery,
  generateWebhookSecret,
  sendTestEvent,
  WEBHOOK_EVENTS,
} from "@/lib/webhooks";
import { env } from "@/lib/env";

/**
 * Integracje — mutacje panelu firmy: klucze API i webhooki.
 *
 * Każda akcja przechodzi przez `requireBusinessManager` i weryfikuje
 * identyfikatory względem firmy — multi-tenant nie ufa temu, co przyszło
 * z formularza. Operacje na kluczach i webhookach są wrażliwe (dają zdalny
 * dostęp do danych firmy), więc wszystkie zostawiają ślad w AuditLog.
 */

type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
    return { ok: false, error: error.message };
  }
  console.error(fallback, error);
  return { ok: false, error: fallback };
}

// ---------------------------------------------------------------------------
// Klucze API
// ---------------------------------------------------------------------------

const createKeySchema = z.object({
  businessId: z.string().min(1),
  name: z.string().trim().min(2, "Nazwa musi mieć min. 2 znaki").max(80),
});

/** Nowy klucz API — pełny klucz wraca JEDEN raz, do pokazania w dialogu. */
export async function createApiKeyAction(
  input: unknown,
): Promise<ActionResult<{ fullKey: string; prefix: string; name: string }>> {
  const parsed = createKeySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane klucza",
    };
  }
  const data = parsed.data;

  try {
    const { user } = await requireBusinessManager(data.businessId);
    const key = await generateApiKey(data.businessId, data.name);

    await logAudit({
      businessId: data.businessId,
      actorUserId: user.id,
      action: "API_KEY_CREATED",
      entityType: "ApiKey",
      entityId: key.id,
      metadata: { name: key.name, prefix: key.prefix },
    });

    revalidatePath("/panel/integracje");
    return {
      ok: true,
      data: { fullKey: key.fullKey, prefix: key.prefix, name: key.name },
    };
  } catch (error) {
    return failure(error, "Nie udało się wygenerować klucza");
  }
}

const revokeKeySchema = z.object({
  businessId: z.string().min(1),
  keyId: z.string().min(1),
});

/** Unieważnienie klucza — nieodwracalne; klucz przestaje uwierzytelniać. */
export async function revokeApiKeyAction(input: unknown): Promise<ActionResult> {
  const parsed = revokeKeySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  try {
    const { user } = await requireBusinessManager(data.businessId);

    const updated = await prisma.apiKey.updateMany({
      where: { id: data.keyId, businessId: data.businessId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (updated.count === 0) {
      return { ok: false, error: "Klucz nie istnieje albo jest już unieważniony" };
    }

    await logAudit({
      businessId: data.businessId,
      actorUserId: user.id,
      action: "API_KEY_REVOKED",
      entityType: "ApiKey",
      entityId: data.keyId,
    });

    revalidatePath("/panel/integracje");
    return { ok: true };
  } catch (error) {
    return failure(error, "Nie udało się unieważnić klucza");
  }
}

// ---------------------------------------------------------------------------
// Webhooki
// ---------------------------------------------------------------------------

/**
 * Adres webhooka: tylko http(s); na produkcji odrzucamy adresy lokalne
 * i prywatne — endpoint jest wołany z NASZEGO serwera, więc dowolny URL
 * to prosta droga do SSRF (odpytywanie wewnętrznej sieci cudzym kosztem).
 */
function validateWebhookUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Nieprawidłowy adres URL";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "Adres musi zaczynać się od http:// albo https://";
  }
  if (env.NODE_ENV === "production") {
    const host = url.hostname.toLowerCase();
    const isPrivate =
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      /^127\.|^10\.|^192\.168\.|^169\.254\.|^0\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === "::1" ||
      host === "[::1]";
    if (isPrivate) return "Adres nie może wskazywać sieci lokalnej";
  }
  return null;
}

const saveWebhookSchema = z.object({
  businessId: z.string().min(1),
  webhookId: z.string().min(1).optional(),
  url: z.string().trim().min(8).max(500),
  events: z
    .array(z.enum(WEBHOOK_EVENTS))
    .min(1, "Wybierz co najmniej jedno zdarzenie"),
  description: z.string().trim().max(200).optional(),
  isActive: z.boolean(),
});

/**
 * Dodanie albo edycja webhooka. Przy tworzeniu zwraca sekret podpisu —
 * JEDYNY raz, kiedy jest pokazywany.
 */
export async function saveWebhookAction(
  input: unknown,
): Promise<ActionResult<{ webhookId: string; secret: string | null }>> {
  const parsed = saveWebhookSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane webhooka",
    };
  }
  const data = parsed.data;

  const urlError = validateWebhookUrl(data.url);
  if (urlError) return { ok: false, error: urlError };

  try {
    const { user } = await requireBusinessManager(data.businessId);

    if (data.webhookId) {
      const updated = await prisma.webhook.updateMany({
        where: { id: data.webhookId, businessId: data.businessId },
        data: {
          url: data.url,
          events: data.events,
          description: data.description || null,
          isActive: data.isActive,
        },
      });
      if (updated.count === 0) {
        return { ok: false, error: "Nie znaleziono webhooka" };
      }
      await logAudit({
        businessId: data.businessId,
        actorUserId: user.id,
        action: "WEBHOOK_UPDATED",
        entityType: "Webhook",
        entityId: data.webhookId,
        metadata: { url: data.url, events: data.events, isActive: data.isActive },
      });
      revalidatePath("/panel/integracje");
      return { ok: true, data: { webhookId: data.webhookId, secret: null } };
    }

    const secret = generateWebhookSecret();
    const created = await prisma.webhook.create({
      data: {
        businessId: data.businessId,
        url: data.url,
        secret,
        events: data.events,
        description: data.description || null,
        isActive: data.isActive,
      },
      select: { id: true },
    });
    await logAudit({
      businessId: data.businessId,
      actorUserId: user.id,
      action: "WEBHOOK_CREATED",
      entityType: "Webhook",
      entityId: created.id,
      metadata: { url: data.url, events: data.events },
    });
    revalidatePath("/panel/integracje");
    return { ok: true, data: { webhookId: created.id, secret } };
  } catch (error) {
    return failure(error, "Nie udało się zapisać webhooka");
  }
}

const webhookIdSchema = z.object({
  businessId: z.string().min(1),
  webhookId: z.string().min(1),
});

/** Usunięcie webhooka razem z historią dostaw (onDelete: Cascade). */
export async function deleteWebhookAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = webhookIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  try {
    const { user } = await requireBusinessManager(data.businessId);

    const deleted = await prisma.webhook.deleteMany({
      where: { id: data.webhookId, businessId: data.businessId },
    });
    if (deleted.count === 0) {
      return { ok: false, error: "Nie znaleziono webhooka" };
    }
    await logAudit({
      businessId: data.businessId,
      actorUserId: user.id,
      action: "WEBHOOK_DELETED",
      entityType: "Webhook",
      entityId: data.webhookId,
    });
    revalidatePath("/panel/integracje");
    return { ok: true };
  } catch (error) {
    return failure(error, "Nie udało się usunąć webhooka");
  }
}

/** Testowe zdarzenie — natychmiastowa próba dostarczenia z panelu. */
export async function sendTestWebhookAction(
  input: unknown,
): Promise<ActionResult<{ delivered: boolean; responseStatus: number | null; error: string | null }>> {
  const parsed = webhookIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  try {
    await requireBusinessManager(data.businessId);

    const hook = await prisma.webhook.findFirst({
      where: { id: data.webhookId, businessId: data.businessId },
      select: { id: true },
    });
    if (!hook) return { ok: false, error: "Nie znaleziono webhooka" };

    const result = await sendTestEvent(hook.id);
    if (!result.ok) return { ok: false, error: result.error };

    revalidatePath("/panel/integracje");
    return { ok: true, data: result.outcome };
  } catch (error) {
    return failure(error, "Nie udało się wysłać testowego zdarzenia");
  }
}

const retrySchema = z.object({
  businessId: z.string().min(1),
  deliveryId: z.string().min(1),
});

/** Ręczne ponowienie dostawy — niezależnie od harmonogramu backoffu. */
export async function retryDeliveryAction(
  input: unknown,
): Promise<ActionResult<{ delivered: boolean; responseStatus: number | null; error: string | null }>> {
  const parsed = retrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane" };
  const data = parsed.data;

  try {
    await requireBusinessManager(data.businessId);

    const delivery = await prisma.webhookDelivery.findFirst({
      where: {
        id: data.deliveryId,
        webhook: { businessId: data.businessId },
      },
      select: {
        id: true,
        event: true,
        payload: true,
        attempts: true,
        status: true,
        webhook: { select: { url: true, secret: true } },
      },
    });
    if (!delivery) return { ok: false, error: "Nie znaleziono dostawy" };
    if (delivery.status === "DELIVERED") {
      return { ok: false, error: "Ta dostawa została już doręczona" };
    }

    const outcome = await attemptDelivery({
      id: delivery.id,
      event: delivery.event,
      payload: delivery.payload,
      attempts: delivery.attempts,
      url: delivery.webhook.url,
      secret: delivery.webhook.secret,
    });

    revalidatePath("/panel/integracje");
    return { ok: true, data: outcome };
  } catch (error) {
    return failure(error, "Nie udało się ponowić dostawy");
  }
}
