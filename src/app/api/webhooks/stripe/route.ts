import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { markPaymentPaid } from "@/lib/payments";

/**
 * POST /api/webhooks/stripe — webhook płatności.
 *
 * Podpis Stripe-Signature weryfikujemy ręcznie (bez SDK): HMAC SHA256
 * z STRIPE_WEBHOOK_SECRET nad "<t>.<surowe body>", tolerancja 5 minut na
 * znacznik czasu (ochrona przed replayem). Brak sekretu w env → 503, bo
 * webhook bez weryfikacji byłby otwartą furtką do oznaczania płatności.
 *
 * Obsługujemy checkout.session.completed → markPaymentPaid; idempotencja
 * siedzi w markPaymentPaid (strażnik statusu w UPDATE po providerPaymentId),
 * więc powtórzone dostarczenie eventu jest bezpieczne. Wpłatę do płatności
 * anulowanej wraz z rezerwacją markPaymentPaid zapisuje i od razu zwraca.
 */

/** Maksymalny wiek podpisu — 5 minut, jak w SDK Stripe. */
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

type StripeSignature = { timestamp: number; signatures: string[] };

/** "t=123,v1=abc,v1=def" → { timestamp, signatures[] } albo null. */
function parseSignatureHeader(header: string): StripeSignature | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2).map((item) => item?.trim());
    if (!key || !value) continue;
    if (key === "t") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) timestamp = parsed;
    } else if (key === "v1") {
      signatures.push(value);
    }
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

function verifySignature(
  payload: string,
  header: string,
  secret: string,
  nowSeconds: number,
): boolean {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  if (
    Math.abs(nowSeconds - parsed.timestamp) > SIGNATURE_TOLERANCE_SECONDS
  ) {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${payload}`, "utf8")
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return parsed.signatures.some((candidate) => {
    const candidateBuffer = Buffer.from(candidate, "utf8");
    return (
      candidateBuffer.length === expectedBuffer.length &&
      timingSafeEqual(candidateBuffer, expectedBuffer)
    );
  });
}

export async function POST(request: Request) {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        error: "NOT_CONFIGURED",
        message: "Webhook Stripe nie jest skonfigurowany (brak sekretu).",
      },
      { status: 503 },
    );
  }

  const signatureHeader = request.headers.get("stripe-signature");
  const payload = await request.text();

  if (
    !signatureHeader ||
    !verifySignature(payload, signatureHeader, secret, Date.now() / 1000)
  ) {
    return NextResponse.json(
      { error: "INVALID_SIGNATURE", message: "Nieprawidłowy podpis webhooka." },
      { status: 400 },
    );
  }

  let event: { type?: unknown; data?: { object?: unknown } };
  try {
    event = JSON.parse(payload) as typeof event;
  } catch {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "Nieprawidłowe body webhooka." },
      { status: 400 },
    );
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data?.object as { id?: unknown } | undefined;
    if (session && typeof session.id === "string") {
      // Idempotentnie: strażnik PENDING → PAID w markPaymentPaid sprawia,
      // że ponowne dostarczenie eventu jest no-opem bez drugiego audytu.
      await markPaymentPaid({ providerPaymentId: session.id });
    }
  }

  return NextResponse.json({ received: true });
}
