import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * Ochrona POST /api/v1/holds przed zablokowaniem całego grafiku.
 *
 * Endpoint jest z założenia anonimowy (gość rezerwuje bez konta), a każdy hold
 * wygląda dla silnika dostępności jak zajętość. Bez limitów skrypt iterujący
 * po slotach z GET /availability mógłby zamknąć firmie zapisy online na 10
 * minut i odnawiać blokady w pętli. Bariery są trzy:
 *
 *  1. ciasteczko anonimowej sesji (`planner_hold_cid`) + limit aktywnych
 *     holdów na klienta — weryfikowany po tokenach w bazie, nie na słowo,
 *  2. limit żądań na okno czasu (per klient i per IP),
 *  3. limit równoczesnych aktywnych holdów na jeden zasób (liczony w bazie).
 *
 * Punkty 1–2 żyją w pamięci procesu: to celowo tania bariera przeciw
 * pojedynczemu skryptowi, a nie rozproszony rate limiter. Twardym,
 * współdzielonym ograniczeniem jest punkt 3, bo liczy się z bazy.
 */

export const HOLD_CLIENT_COOKIE = "planner_hold_cid";
/** Ile aktywnych blokad może mieć jednocześnie jeden klient. */
export const MAX_HOLDS_PER_CLIENT = 2;
/** Ile aktywnych blokad może wisieć jednocześnie na jednym pracowniku. */
export const MAX_HOLDS_PER_RESOURCE = 4;
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_CLIENT = 10;
const MAX_REQUESTS_PER_IP = 20;
/** Ciasteczko sesji anonimowej — dłuższe niż najdłuższy checkout. */
export const HOLD_COOKIE_MAX_AGE_S = 24 * 60 * 60;

/** token → moment wygaśnięcia (ms); czyszczone leniwie. */
const tokensByClient = new Map<string, Map<string, number>>();
const clientByToken = new Map<string, string>();
/** klucz (klient/IP) → znaczniki czasu żądań w bieżącym oknie. */
const requestLog = new Map<string, number[]>();

/** Wyciąga wartość ciasteczka z nagłówka `Cookie` (bez next/headers). */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim()) || null;
  }
  return null;
}

/** Identyfikator anonimowego klienta: z ciasteczka albo świeżo wylosowany. */
export function resolveHoldClientId(request: Request): {
  clientId: string;
  isNew: boolean;
} {
  const existing = readCookie(request, HOLD_CLIENT_COOKIE);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) {
    return { clientId: existing, isNew: false };
  }
  return { clientId: randomUUID(), isNew: true };
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

function hit(key: string, max: number, now: number): boolean {
  const window = (requestLog.get(key) ?? []).filter(
    (stamp) => stamp > now - RATE_WINDOW_MS,
  );
  if (window.length >= max) {
    requestLog.set(key, window);
    return false;
  }
  window.push(now);
  requestLog.set(key, window);
  return true;
}

/** Sprząta wpisy, które i tak są już poza oknem / po TTL. */
function sweep(now: number): void {
  if (requestLog.size > 5000) {
    for (const [key, stamps] of requestLog) {
      if (stamps.every((stamp) => stamp <= now - RATE_WINDOW_MS)) {
        requestLog.delete(key);
      }
    }
  }
  if (clientByToken.size > 5000) {
    for (const [client, tokens] of tokensByClient) {
      for (const [token, expiresAt] of tokens) {
        if (expiresAt <= now) {
          tokens.delete(token);
          clientByToken.delete(token);
        }
      }
      if (tokens.size === 0) tokensByClient.delete(client);
    }
  }
}

/** Czy klient/IP mieści się w limicie żądań? */
export function allowHoldRequest(
  request: Request,
  clientId: string,
  now: number = Date.now(),
): boolean {
  sweep(now);
  const okClient = hit(`c:${clientId}`, MAX_REQUESTS_PER_CLIENT, now);
  const okIp = hit(`i:${clientIp(request)}`, MAX_REQUESTS_PER_IP, now);
  return okClient && okIp;
}

/**
 * Ile blokad klienta jest jeszcze żywych. Liczone po bazie — token zwolniony
 * albo wygasły nie może dożywotnio zajmować limitu.
 */
export async function activeHoldCountForClient(
  clientId: string,
  now: Date = new Date(),
): Promise<number> {
  const tokens = tokensByClient.get(clientId);
  if (!tokens || tokens.size === 0) return 0;

  for (const [token, expiresAt] of tokens) {
    if (expiresAt <= now.getTime()) {
      tokens.delete(token);
      clientByToken.delete(token);
    }
  }
  if (tokens.size === 0) {
    tokensByClient.delete(clientId);
    return 0;
  }

  const alive = await prisma.hold.findMany({
    where: { token: { in: [...tokens.keys()] }, expiresAt: { gt: now } },
    select: { token: true },
  });
  const aliveTokens = new Set(alive.map((hold) => hold.token));
  for (const token of [...tokens.keys()]) {
    if (!aliveTokens.has(token)) {
      tokens.delete(token);
      clientByToken.delete(token);
    }
  }
  return aliveTokens.size;
}

/** Ile aktywnych blokad wisi na zasobie (twardy limit — z bazy). */
export function activeHoldCountForResource(
  resourceId: string,
  now: Date = new Date(),
): Promise<number> {
  return prisma.hold.count({
    where: { resourceId, expiresAt: { gt: now } },
  });
}

export function rememberHold(
  clientId: string,
  token: string,
  expiresAt: Date,
): void {
  let tokens = tokensByClient.get(clientId);
  if (!tokens) {
    tokens = new Map();
    tokensByClient.set(clientId, tokens);
  }
  tokens.set(token, expiresAt.getTime());
  clientByToken.set(token, clientId);
}

export function forgetHold(token: string): void {
  const clientId = clientByToken.get(token);
  clientByToken.delete(token);
  if (!clientId) return;
  const tokens = tokensByClient.get(clientId);
  tokens?.delete(token);
  if (tokens && tokens.size === 0) tokensByClient.delete(clientId);
}
