import { NextResponse } from "next/server";
import { z } from "zod";
import {
  HOLD_TTL_MINUTES,
  SLOT_TAKEN_MESSAGE,
  createHold,
  resolveSlot,
} from "@/lib/hold";
import {
  HOLD_CLIENT_COOKIE,
  HOLD_COOKIE_MAX_AGE_S,
  MAX_HOLDS_PER_CLIENT,
  MAX_HOLDS_PER_RESOURCE,
  activeHoldCountForClient,
  activeHoldCountForResource,
  allowHoldRequest,
  rememberHold,
  resolveHoldClientId,
} from "@/lib/hold-guard";

/**
 * POST /api/v1/holds — tymczasowa blokada slotu na czas checkoutu (TTL 10 min).
 *
 * Klient zakłada holda w chwili wejścia w krok „dane", a token przekazuje
 * potem do POST /api/v1/bookings. Dzięki temu wypełnianie formularza nie
 * kończy się komunikatem „termin właśnie zniknął".
 *
 * Bez `resourceId` („dowolny pracownik") zasób wybieramy tak samo jak przy
 * rezerwacji — najmniej obłożony z tych, które mają wolny ten start — i
 * zwracamy go w odpowiedzi.
 *
 * Endpoint jest anonimowy (gość rezerwuje bez konta), więc pilnują go limity
 * z `@/lib/hold-guard`: ciasteczko sesji anonimowej z limitem aktywnych
 * blokad, rate limit per klient/IP i limit blokad na jeden zasób. Bez nich
 * skrypt iterujący po slotach zamknąłby firmie zapisy online.
 */

const holdSchema = z.object({
  businessSlug: z.string().min(1),
  serviceId: z.string().min(1),
  /** Brak = „dowolny pracownik" — zasób rozwiązujemy po stronie serwera. */
  resourceId: z.string().min(1).optional(),
  startAt: z.iso.datetime(),
});

const TOO_MANY = (message: string) =>
  NextResponse.json({ error: "TOO_MANY_HOLDS", message }, { status: 429 });

export async function POST(request: Request) {
  const { clientId, isNew } = resolveHoldClientId(request);

  /** Sesja anonimowa musi przetrwać także odpowiedzi błędne. */
  const withClientCookie = <T extends NextResponse>(response: T): T => {
    if (isNew) {
      response.cookies.set({
        name: HOLD_CLIENT_COOKIE,
        value: clientId,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: HOLD_COOKIE_MAX_AGE_S,
        secure: process.env.NODE_ENV === "production",
      });
    }
    return response;
  };

  if (!allowHoldRequest(request, clientId)) {
    return withClientCookie(
      TOO_MANY(
        "Za dużo prób blokowania terminów. Odczekaj chwilę i spróbuj ponownie.",
      ),
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withClientCookie(
      NextResponse.json(
        { error: "BAD_REQUEST", message: "Nieprawidłowe body żądania" },
        { status: 400 },
      ),
    );
  }

  const parsed = holdSchema.safeParse(body);
  if (!parsed.success) {
    return withClientCookie(
      NextResponse.json(
        {
          error: "VALIDATION",
          message: "Nieprawidłowe dane blokady terminu",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 },
      ),
    );
  }
  const input = parsed.data;
  const now = new Date();
  const startAt = new Date(input.startAt);

  // Jeden klient trzyma naraz najwyżej kilka terminów — inaczej wystarczyłby
  // jeden otwarty checkout w pętli, żeby wyczyścić grafik z wolnych godzin.
  if ((await activeHoldCountForClient(clientId, now)) >= MAX_HOLDS_PER_CLIENT) {
    return withClientCookie(
      TOO_MANY(
        "Masz już zablokowane terminy. Dokończ rezerwację albo poczekaj, aż blokada wygaśnie.",
      ),
    );
  }

  // Leniwe sprzątanie wygasłych holdów zasobów tej usługi — robimy je przed
  // liczeniem dostępności, żeby nie blokowały slotu ani sekundy dłużej.
  const resolution = await resolveSlot({
    businessSlug: input.businessSlug,
    serviceId: input.serviceId,
    resourceId: input.resourceId,
    startAt,
    now,
    cleanupExpired: true,
  });

  if (!resolution.ok) {
    return withClientCookie(
      NextResponse.json(
        { error: resolution.error, message: resolution.message },
        { status: resolution.status },
      ),
    );
  }

  // Twardy limit liczony z bazy: nawet rozproszony skrypt bez ciasteczka nie
  // zablokuje jednemu pracownikowi całego dnia naraz.
  const resourceHolds = await activeHoldCountForResource(
    resolution.slot.resourceId,
    now,
  );
  if (resourceHolds >= MAX_HOLDS_PER_RESOURCE) {
    return withClientCookie(
      TOO_MANY(
        "Zbyt wiele terminów tego pracownika jest właśnie rezerwowanych. Spróbuj za kilka minut.",
      ),
    );
  }

  const hold = await createHold(resolution.slot, now);
  if (!hold) {
    return withClientCookie(
      NextResponse.json(
        { error: "SLOT_TAKEN", message: SLOT_TAKEN_MESSAGE },
        { status: 409 },
      ),
    );
  }

  rememberHold(clientId, hold.token, hold.expiresAt);

  return withClientCookie(
    NextResponse.json(
      {
        hold: {
          token: hold.token,
          expiresAt: hold.expiresAt.toISOString(),
          ttlMinutes: HOLD_TTL_MINUTES,
          resourceId: hold.resourceId,
          resourceName: resolution.slot.resourceName,
          startAt: resolution.slot.startAt.toISOString(),
          endAt: resolution.slot.endAt.toISOString(),
          timezone: resolution.context.location.timezone,
        },
      },
      { status: 201 },
    ),
  );
}
