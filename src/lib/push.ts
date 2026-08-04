/**
 * Warstwa web push: wysyłka przez bibliotekę `web-push` (VAPID).
 *
 * Wzorzec jak w `src/lib/mail.ts` i `src/lib/sms.ts`: jedna próba doręczenia
 * do użytkownika = jeden wiersz `notifications` (channel PUSH) — PENDING przed
 * wysyłką, potem SENT/FAILED/SKIPPED. Bez kluczy VAPID moduł działa dalej:
 * `isPushEnabled()` zwraca false, a wysyłki lądują jako SKIPPED.
 *
 * `sendPushToUser` nigdy nie rzuca. Subskrypcje, na które push service
 * odpowiada 404/410 (wygasłe/wycofane), są usuwane z bazy.
 */

import webpush from "web-push";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import type { NotificationStatus } from "@/generated/prisma/enums";

/** Czy serwer ma komplet kluczy VAPID — bez nich UI chowa przełącznik. */
export function isPushEnabled(): boolean {
  return Boolean(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

let vapidConfigured = false;

/** Leniwa konfiguracja VAPID — moduł da się importować bez kluczy w env. */
function ensureVapid(): boolean {
  if (!env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
  if (!vapidConfigured) {
    webpush.setVapidDetails(
      env.VAPID_SUBJECT,
      env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY,
    );
    vapidConfigured = true;
  }
  return true;
}

/** Payload czytany przez service workera (public/sw.js). */
export type PushPayload = {
  title: string;
  body: string;
  /** Adres otwierany po kliknięciu notyfikacji. */
  url: string;
};

export type SendPushInput = {
  userId: string;
  payload: PushPayload;
  /** np. REMINDER_24H_PUSH — patrz model Notification. */
  type: string;
  bookingId?: string;
  /**
   * Istniejący wiersz `notifications` (status PENDING) do zaktualizowania
   * zamiast tworzenia nowego — używa tego cron przypomnień (claim w transakcji).
   */
  notificationId?: string;
};

export type SendPushResult = {
  ok: boolean;
  status: NotificationStatus;
  /** Ilu subskrypcjom udało się doręczyć. */
  delivered: number;
};

/** Socket timeout na pojedynczy request do push service'u. */
const PUSH_TIMEOUT_MS = 5000;
/** Jak długo push service trzyma niedoręczoną wiadomość (przypomnienie ~24 h). */
const PUSH_TTL_S = 24 * 60 * 60;

/**
 * Wysyła notyfikację na wszystkie subskrypcje użytkownika.
 *
 * Status zbiorczy: SENT gdy dotarła do co najmniej jednego urządzenia,
 * SKIPPED gdy nie ma jak wysłać (brak kluczy / brak subskrypcji),
 * FAILED gdy każda próba się nie powiodła.
 */
export async function sendPushToUser(
  input: SendPushInput,
): Promise<SendPushResult> {
  let notificationId: string | null = input.notificationId ?? null;

  try {
    if (!notificationId) {
      const notification = await prisma.notification.create({
        data: {
          channel: "PUSH",
          type: input.type,
          // Odbiorcą pusha jest konto, nie adres — trzymamy userId.
          recipient: input.userId,
          subject: input.payload.title,
          bookingId: input.bookingId ?? null,
          status: "PENDING",
        },
        select: { id: true },
      });
      notificationId = notification.id;
    }

    if (!ensureVapid()) {
      await prisma.notification.update({
        where: { id: notificationId },
        data: { status: "SKIPPED" },
      });
      return { ok: true, status: "SKIPPED", delivered: 0 };
    }

    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId: input.userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });

    if (subscriptions.length === 0) {
      await prisma.notification.update({
        where: { id: notificationId },
        data: { status: "SKIPPED" },
      });
      return { ok: true, status: "SKIPPED", delivered: 0 };
    }

    const body = JSON.stringify(input.payload);
    let delivered = 0;
    let lastError: string | null = null;

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          body,
          { TTL: PUSH_TTL_S, timeout: PUSH_TIMEOUT_MS },
        );
        delivered += 1;
      } catch (error) {
        if (
          error instanceof webpush.WebPushError &&
          (error.statusCode === 404 || error.statusCode === 410)
        ) {
          // Subskrypcja wygasła albo została wycofana po stronie przeglądarki
          // — martwy wiersz tylko spowalniałby każdą kolejną wysyłkę.
          await prisma.pushSubscription
            .delete({ where: { id: subscription.id } })
            .catch(() => undefined);
          lastError = `Subskrypcja wygasła (HTTP ${error.statusCode})`;
        } else {
          lastError =
            error instanceof Error ? error.message : "Nieznany błąd push";
        }
      }
    }

    if (delivered > 0) {
      await prisma.notification.update({
        where: { id: notificationId },
        data: { status: "SENT", sentAt: new Date() },
      });
      return { ok: true, status: "SENT", delivered };
    }

    await prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: "FAILED",
        error: (lastError ?? "Żadna subskrypcja nie przyjęła wysyłki").slice(
          0,
          1000,
        ),
      },
    });
    return { ok: false, status: "FAILED", delivered: 0 };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nieznany błąd wysyłki push";
    if (notificationId) {
      await prisma.notification
        .update({
          where: { id: notificationId },
          data: { status: "FAILED", error: message.slice(0, 1000) },
        })
        .catch(() => undefined);
    }
    console.error("sendPushToUser: wysyłka nieudana:", error);
    return { ok: false, status: "FAILED", delivered: 0 };
  }
}
