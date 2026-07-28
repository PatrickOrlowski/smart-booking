import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import type { Payment } from "@/generated/prisma/client";
import type { PaymentKind } from "@/generated/prisma/enums";

/**
 * Warstwa płatności wokół rezerwacji (zadatki, przedpłaty, opłaty no-show).
 *
 * Provider MANUAL = rozliczenie na miejscu — działa zawsze, bez żadnych
 * kluczy. Stripe włącza się wyłącznie, gdy jest env.STRIPE_SECRET_KEY,
 * i rozmawiamy z nim gołym fetchem (bez SDK). Awaria albo brak bramki
 * NIGDY nie wywraca flow rezerwacji: wtedy płatność spada do MANUAL.
 */

const STRIPE_API = "https://api.stripe.com/v1";
/** Twardy limit czasu na odpowiedź Stripe — bramka nie może wieszać flow. */
const STRIPE_TIMEOUT_MS = 8000;

export type CreateBookingPaymentInput = {
  kind: PaymentKind;
  /** Kwota w groszach — jak wszystkie ceny w systemie. */
  amountCents: number;
  currency: string;
  /** Opis pozycji w Stripe Checkout, np. "Zadatek — Balayage". */
  description?: string;
  /** Powrót z bramki; domyślnie strona główna aplikacji. */
  returnUrl?: string;
};

export type CreatedBookingPayment = {
  payment: Payment;
  /** Link do Stripe Checkout — tylko gdy bramka jest aktywna. */
  redirectUrl?: string;
};

/** Body form-urlencoded, jak chce API Stripe. */
const formBody = (fields: Record<string, string>): string =>
  new URLSearchParams(fields).toString();

async function stripeRequest(
  path: string,
  fields: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  if (!env.STRIPE_SECRET_KEY) return null;
  const response = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formBody(fields),
  });
  const json = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!response.ok) {
    throw new Error(
      `Stripe HTTP ${response.status}: ${JSON.stringify(json).slice(0, 500)}`,
    );
  }
  return json;
}

/**
 * Tworzy płatność do rezerwacji.
 *
 * MANUAL (domyślnie): wiersz Payment PENDING — „zapłata na miejscu".
 * Stripe (gdy jest klucz): Checkout Session (mode=payment, PLN) przez fetch,
 * providerPaymentId = id sesji, a klient dostaje redirectUrl do bramki.
 * Każdy błąd Stripe degraduje do MANUAL — rezerwacja nie może przepaść
 * przez bramkę.
 */
export async function createBookingPayment(
  bookingId: string,
  businessId: string,
  input: CreateBookingPaymentInput,
): Promise<CreatedBookingPayment> {
  if (env.STRIPE_SECRET_KEY) {
    try {
      const returnUrl = input.returnUrl ?? env.NEXT_PUBLIC_APP_URL;
      const separator = returnUrl.includes("?") ? "&" : "?";
      const session = await stripeRequest("/checkout/sessions", {
        mode: "payment",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": input.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(input.amountCents),
        "line_items[0][price_data][product_data][name]":
          input.description ?? "Zadatek za rezerwację",
        success_url: `${returnUrl}${separator}zadatek=oplacony`,
        cancel_url: `${returnUrl}${separator}zadatek=anulowany`,
        "metadata[bookingId]": bookingId,
      });
      const sessionId =
        session && typeof session.id === "string" ? session.id : null;
      const sessionUrl =
        session && typeof session.url === "string" ? session.url : null;
      if (sessionId) {
        const payment = await prisma.payment.create({
          data: {
            bookingId,
            businessId,
            provider: "STRIPE",
            kind: input.kind,
            status: "PENDING",
            providerPaymentId: sessionId,
            amountCents: input.amountCents,
            currency: input.currency,
          },
        });
        return { payment, redirectUrl: sessionUrl ?? undefined };
      }
    } catch (error) {
      // Bramka leży → degradacja do MANUAL, rezerwacja idzie dalej.
      console.error("createBookingPayment: Stripe niedostępny:", error);
    }
  }

  const payment = await prisma.payment.create({
    data: {
      bookingId,
      businessId,
      provider: "MANUAL",
      kind: input.kind,
      status: "PENDING",
      amountCents: input.amountCents,
      currency: input.currency,
    },
  });
  return { payment };
}

export type PaymentSelector =
  | { paymentId: string }
  | { providerPaymentId: string };

/**
 * Oznacza płatność jako opłaconą. Idempotentne: strażnik statusu w UPDATE
 * (PENDING → PAID) sprawia, że powtórzony webhook nic nie zmienia i nie
 * dubluje wpisu audytu.
 *
 * Osobno obsłużona jest wpłata do płatności już CANCELLED (klient dokończył
 * checkout po anulowaniu rezerwacji, zanim sesja wygasła): zamiast po cichu
 * zignorować przelew, zapisujemy go (PAID + audyt) i od razu zwracamy —
 * wcześniej pieniądze nie zostawiały żadnego śladu w systemie.
 */
export async function markPaymentPaid(
  selector: PaymentSelector,
  options: { actorUserId?: string | null } = {},
): Promise<Payment | null> {
  const where =
    "paymentId" in selector
      ? { id: selector.paymentId }
      : { providerPaymentId: selector.providerPaymentId };

  const before = await prisma.payment.findFirst({
    where,
    select: { id: true, status: true },
  });
  if (!before) return null;

  const updated = await prisma.payment.updateMany({
    where: { id: before.id, status: { in: ["PENDING", "CANCELLED"] } },
    data: { status: "PAID", paidAt: new Date() },
  });

  const payment = await prisma.payment.findUnique({ where: { id: before.id } });
  if (!payment) return null;

  // Wpłata po anulowaniu: ślad w audycie i natychmiastowy zwrot.
  if (updated.count > 0 && before.status === "CANCELLED") {
    await logAudit({
      businessId: payment.businessId,
      actorUserId: options.actorUserId ?? null,
      action: "PAYMENT_PAID_AFTER_CANCELLATION",
      entityType: "Payment",
      entityId: payment.id,
      metadata: {
        bookingId: payment.bookingId,
        provider: payment.provider,
        kind: payment.kind,
        amountCents: payment.amountCents,
        currency: payment.currency,
      },
    });
    const result = await refundPayment(payment.id, {
      actorUserId: options.actorUserId ?? null,
      reason: "Wpłata po anulowaniu rezerwacji",
    });
    return result.payment ?? payment;
  }

  if (updated.count > 0) {
    await logAudit({
      businessId: payment.businessId,
      actorUserId: options.actorUserId ?? null,
      action: "PAYMENT_PAID",
      entityType: "Payment",
      entityId: payment.id,
      metadata: {
        bookingId: payment.bookingId,
        provider: payment.provider,
        kind: payment.kind,
        amountCents: payment.amountCents,
        currency: payment.currency,
      },
    });
  }
  return payment;
}

export type RefundResult = {
  payment: Payment | null;
  /** false = bramka odmówiła zwrotu; płatność zostaje PAID z failureReason. */
  refunded: boolean;
};

/**
 * Zwrot opłaconej płatności. MANUAL — od razu REFUNDED (zwrot na miejscu);
 * Stripe — najpierw refund przez API (payment_intent z sesji checkout),
 * dopiero po sukcesie REFUNDED. Idempotentne przez strażnik PAID → REFUNDED.
 */
export async function refundPayment(
  paymentId: string,
  options: { actorUserId?: string | null; reason?: string | null } = {},
): Promise<RefundResult> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return { payment: null, refunded: false };
  if (payment.status !== "PAID") {
    return { payment, refunded: payment.status === "REFUNDED" };
  }

  if (payment.provider === "STRIPE" && payment.providerPaymentId) {
    try {
      if (!env.STRIPE_SECRET_KEY) {
        throw new Error("Brak STRIPE_SECRET_KEY — zwrot wymaga bramki");
      }
      // Checkout Session nie przyjmuje refundu wprost — trzeba payment_intent.
      const sessionResponse = await fetch(
        `${STRIPE_API}/checkout/sessions/${payment.providerPaymentId}`,
        {
          signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
          headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
        },
      );
      const session = (await sessionResponse.json().catch(() => null)) as {
        payment_intent?: string | null;
      } | null;
      if (!sessionResponse.ok || !session?.payment_intent) {
        throw new Error(
          `Stripe: brak payment_intent dla sesji ${payment.providerPaymentId}`,
        );
      }
      await stripeRequest("/refunds", {
        payment_intent: session.payment_intent,
      });
    } catch (error) {
      console.error("refundPayment: zwrot Stripe nieudany:", error);
      const failed = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          failureReason: `Zwrot Stripe nieudany: ${
            error instanceof Error ? error.message : "nieznany błąd"
          }`.slice(0, 500),
        },
      });
      return { payment: failed, refunded: false };
    }
  }

  const updated = await prisma.payment.updateMany({
    where: { id: payment.id, status: "PAID" },
    data: {
      status: "REFUNDED",
      refundedAt: new Date(),
      refundedCents: payment.amountCents,
      failureReason: null,
    },
  });
  const fresh = await prisma.payment.findUnique({ where: { id: payment.id } });

  if (updated.count > 0 && fresh) {
    await logAudit({
      businessId: fresh.businessId,
      actorUserId: options.actorUserId ?? null,
      action: "PAYMENT_REFUNDED",
      entityType: "Payment",
      entityId: fresh.id,
      metadata: {
        bookingId: fresh.bookingId,
        provider: fresh.provider,
        kind: fresh.kind,
        amountCents: fresh.amountCents,
        refundedCents: fresh.refundedCents,
        currency: fresh.currency,
        reason: options.reason ?? null,
      },
    });
  }
  return { payment: fresh, refunded: fresh?.status === "REFUNDED" };
}

/**
 * Wygasza sesję Stripe Checkout, żeby po anulowaniu rezerwacji nie dało się
 * już zapłacić. Best-effort: brak klucza, padnięta bramka albo sesja, której
 * nie da się wygasić (bo właśnie została opłacona), nie mogą wywrócić
 * anulowania — taką wpłatę wyłapie webhook (markPaymentPaid → zwrot).
 */
async function expireStripeCheckoutSession(sessionId: string): Promise<void> {
  if (!env.STRIPE_SECRET_KEY) return;
  try {
    await stripeRequest(`/checkout/sessions/${sessionId}/expire`, {});
  } catch (error) {
    console.error(
      `expireStripeCheckoutSession: nie udało się wygasić sesji ${sessionId}:`,
      error,
    );
  }
}

export type SettledPayment = {
  paymentId: string;
  provider: string;
  kind: string;
  amountCents: number;
  currency: string;
  previousStatus: string;
  newStatus: string;
};

/**
 * Rozliczenie płatności przy anulowaniu rezerwacji: PAID → zwrot
 * (refundPayment, z bramką gdy Stripe), PENDING → CANCELLED. Zwraca
 * podsumowanie do metadanych wpisu audytu. Nigdy nie rzuca.
 */
export async function settleBookingPaymentsOnCancellation(
  bookingId: string,
  options: { actorUserId?: string | null; reason?: string | null } = {},
): Promise<SettledPayment[]> {
  const settled: SettledPayment[] = [];
  try {
    const payments = await prisma.payment.findMany({
      where: { bookingId, status: { in: ["PENDING", "PAID"] } },
    });
    for (const payment of payments) {
      const summary = {
        paymentId: payment.id,
        provider: payment.provider,
        kind: payment.kind,
        amountCents: payment.amountCents,
        currency: payment.currency,
      };

      if (payment.status === "PAID") {
        const result = await refundPayment(payment.id, options);
        settled.push({
          ...summary,
          previousStatus: "PAID",
          newStatus: result.payment?.status ?? "PAID",
        });
        continue;
      }

      // Sesja Checkout żyje do 24 h — bez wygaszenia klient z otwartą kartą
      // Stripe płaci PO anulowaniu, a webhook trafia w strażnik statusu
      // i pobrane pieniądze nie zostawiają śladu w systemie.
      if (payment.provider === "STRIPE" && payment.providerPaymentId) {
        await expireStripeCheckoutSession(payment.providerPaymentId);
      }

      const cancelled = await prisma.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      if (cancelled.count > 0) {
        settled.push({
          ...summary,
          previousStatus: "PENDING",
          newStatus: "CANCELLED",
        });
        continue;
      }

      // Status zmienił się w międzyczasie — jeśli klient zdążył zapłacić
      // (webhook wyprzedził wygaszenie sesji), należy mu się zwrot, a nie
      // ciche przestawienie na CANCELLED.
      const fresh = await prisma.payment.findUnique({
        where: { id: payment.id },
      });
      if (fresh?.status === "PAID") {
        const result = await refundPayment(payment.id, options);
        settled.push({
          ...summary,
          previousStatus: "PAID",
          newStatus: result.payment?.status ?? "PAID",
        });
        continue;
      }
      settled.push({
        ...summary,
        previousStatus: "PENDING",
        newStatus: fresh?.status ?? "PENDING",
      });
    }
  } catch (error) {
    console.error(
      "settleBookingPaymentsOnCancellation: rozliczenie nieudane:",
      error,
    );
  }
  return settled;
}
