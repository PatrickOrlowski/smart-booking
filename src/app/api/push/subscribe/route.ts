import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/authz";
import { isPushEnabled } from "@/lib/push";

/**
 * POST /api/push/subscribe — zapis subskrypcji web push zalogowanego
 * użytkownika (wynik `PushManager.subscribe` z przeglądarki).
 *
 * Upsert po `endpoint`: przeglądarka potrafi odświeżyć klucze dla tego samego
 * endpointu, a użytkownik może się przelogować na tym samym urządzeniu —
 * wtedy subskrypcję przejmuje bieżące konto zamiast dublować wiersz.
 */

/**
 * Endpoint subskrypcji jest później celem server-side POST-a z crona
 * (web-push łączy się z DOKŁADNIE tym hostem) — bez allowlisty zalogowany
 * użytkownik mógłby zarejestrować adres wewnętrzny (https://10.0.0.5:8443/)
 * i zamienić wysyłkę przypomnień w ślepe sondy SSRF. Dopuszczamy wyłącznie
 * znane push service'y przeglądarek, tylko po https.
 */
const PUSH_ENDPOINT_HOSTS = new Set([
  "fcm.googleapis.com", // Chrome / Chromium
  "android.googleapis.com", // starsze Chrome
  "web.push.apple.com", // Safari
]);
const PUSH_ENDPOINT_HOST_SUFFIXES = [
  ".push.services.mozilla.com", // Firefox (updates.push.services.mozilla.com)
  ".notify.windows.com", // Edge / WNS (np. sg2p.notify.windows.com)
  ".push.apple.com", // Safari (warianty regionalne)
];

function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return (
    PUSH_ENDPOINT_HOSTS.has(host) ||
    PUSH_ENDPOINT_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

/**
 * Górny limit subskrypcji na konto — bez niego tysiące lewych endpointów
 * (× 5 s timeoutu każdy) rozciągnęłyby przebieg crona ponad maxDuration.
 * Realny użytkownik ma kilka urządzeń; przy przekroczeniu wypada najstarsza.
 */
const MAX_SUBSCRIPTIONS_PER_USER = 10;

const subscribeSchema = z.object({
  endpoint: z
    .url()
    .refine(isAllowedPushEndpoint, "Nieobsługiwany push service"),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Wymagane zalogowanie" },
      { status: 401 },
    );
  }

  if (!isPushEnabled()) {
    return NextResponse.json(
      { error: "PUSH_DISABLED", message: "Powiadomienia push są wyłączone" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "Nieprawidłowe body żądania" },
      { status: 400 },
    );
  }

  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "VALIDATION",
        message: "Nieprawidłowe dane subskrypcji push",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 422 },
    );
  }

  // Limit na konto: gdy nowy endpoint przekroczyłby MAX_SUBSCRIPTIONS_PER_USER,
  // zwalniamy miejsce kasując najstarsze subskrypcje — nowe urządzenie jest
  // bardziej aktualne niż zapomniane sprzed miesięcy.
  const existing = await prisma.pushSubscription.findUnique({
    where: { endpoint: parsed.data.endpoint },
    select: { id: true },
  });
  if (!existing) {
    const oldest = await prisma.pushSubscription.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const excess = oldest.length - (MAX_SUBSCRIPTIONS_PER_USER - 1);
    if (excess > 0) {
      await prisma.pushSubscription.deleteMany({
        where: { id: { in: oldest.slice(0, excess).map((row) => row.id) } },
      });
    }
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint: parsed.data.endpoint },
    update: {
      userId: user.id,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      userAgent: request.headers.get("user-agent"),
    },
    create: {
      userId: user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      userAgent: request.headers.get("user-agent"),
    },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
