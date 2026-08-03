import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  attemptDelivery,
  MAX_DELIVERY_ATTEMPTS,
  type DeliveryTarget,
} from "@/lib/webhooks";

/**
 * GET /api/cron/webhooks — ponowienia zaległych dostaw webhooków.
 *
 * Wywoływane co 10 minut przez Vercel Cron (vercel.json). Podnosi:
 * - FAILED z nextRetryAt <= teraz (zwykły backoff: 1 min, 5, 30, 2 h),
 * - PENDING starsze niż 15 minut — ślad po przebiegu przerwanym między
 *   utworzeniem wiersza a próbą dostarczenia (emitEvent tworzy PENDING
 *   przed pierwszym fetchem właśnie po to, żeby cron je dokończył).
 *
 * Autoryzacja i blokada przed nakładaniem się przebiegów — ten sam wzorzec
 * co /api/cron/reminders: Bearer CRON_SECRET + pg_try_advisory_xact_lock
 * (wariant „try": drugi przebieg odpuszcza, zamiast czekać).
 */

export const dynamic = "force-dynamic";
/** Do 5 s na próbę dostarczenia — partia potrzebuje więcej niż domyślne 10 s. */
export const maxDuration = 60;

/** Ile dostaw obsługuje jeden przebieg (reszta poczeka 10 minut). */
const BATCH_SIZE = 50;
/** Równoległość wychodzących fetchy. */
const CHUNK_SIZE = 10;
/** Po tym czasie PENDING uznajemy za ślad po przerwanym przebiegu. */
const PENDING_STALE_MS = 15 * 60 * 1000;
/** Stały klucz advisory locka — tylko dla tego crona (reminders ma …001). */
const CRON_LOCK_KEY = 872_140_002;

export async function GET(request: Request) {
  if (!env.CRON_SECRET) {
    return NextResponse.json(
      {
        error: "CRON_DISABLED",
        message: "Brak skonfigurowanego CRON_SECRET — endpoint wyłączony",
      },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization");
  if (header !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Nieprawidłowy token" },
      { status: 401 },
    );
  }

  const now = new Date();
  const pendingSince = new Date(now.getTime() - PENDING_STALE_MS);

  // Wybór partii pod advisory lockiem — dwa nakładające się przebiegi nie
  // mogą dostarczyć tej samej dostawy dwa razy. Same fetche lecą już poza
  // transakcją (dostawa potrafi trwać do 5 s — nie trzymamy locka na to),
  // a „zaklepanie" wiersza polega na przestawieniu nextRetryAt w przyszłość.
  const { targets, locked } = await prisma.$transaction(async (tx) => {
    const [lock] = await tx.$queryRaw<
      { locked: boolean }[]
    >`SELECT pg_try_advisory_xact_lock(${CRON_LOCK_KEY}::bigint) AS locked`;
    if (!lock?.locked) {
      return { targets: [] as DeliveryTarget[], locked: false };
    }

    const due = await tx.webhookDelivery.findMany({
      where: {
        attempts: { lt: MAX_DELIVERY_ATTEMPTS },
        webhook: { isActive: true },
        OR: [
          { status: "FAILED", nextRetryAt: { not: null, lte: now } },
          { status: "PENDING", createdAt: { lt: pendingSince } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: BATCH_SIZE,
      select: {
        id: true,
        event: true,
        payload: true,
        attempts: true,
        webhook: { select: { url: true, secret: true } },
      },
    });

    if (due.length > 0) {
      // Zaklepanie partii: przebieg, który wystartuje za chwilę, nie zobaczy
      // tych wierszy jako zaległych. attemptDelivery i tak nadpisze
      // nextRetryAt właściwym wynikiem próby.
      await tx.webhookDelivery.updateMany({
        where: { id: { in: due.map((delivery) => delivery.id) } },
        data: { nextRetryAt: new Date(now.getTime() + 10 * 60 * 1000) },
      });
    }

    return {
      locked: true,
      targets: due.map((delivery) => ({
        id: delivery.id,
        event: delivery.event,
        payload: delivery.payload,
        attempts: delivery.attempts,
        url: delivery.webhook.url,
        secret: delivery.webhook.secret,
      })),
    };
  });

  if (!locked) {
    return NextResponse.json({ checked: 0, delivered: 0, failed: 0, busy: true });
  }

  let delivered = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
    const chunk = targets.slice(i, i + CHUNK_SIZE);
    const outcomes = await Promise.allSettled(
      chunk.map((target) => attemptDelivery(target)),
    );
    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled" && outcome.value.delivered) {
        delivered += 1;
      } else {
        failed += 1;
      }
    }
  }

  return NextResponse.json({ checked: targets.length, delivered, failed });
}
