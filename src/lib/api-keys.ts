import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

/**
 * Klucze API integratorów (model ApiKey).
 *
 * Pełny klucz ma postać `pk_live_<4 znaki>_<sekret>` i jest pokazywany
 * DOKŁADNIE RAZ — w bazie ląduje wyłącznie hash bcrypt oraz widoczny
 * prefiks (`pk_live_a1b2`) do rozpoznania klucza na liście.
 *
 * UWAGA — lookup: po hashu bcrypt nie da się wyszukiwać (każde hashowanie
 * ma inną sól), więc kandydatów wybieramy po kolumnie `prefix` i dopiero
 * na nich porównujemy hash. Prefiks (4 losowe znaki z alfabetu 36 ≈ 1,7 mln
 * kombinacji) musi być w praktyce unikalny; ewentualna kolizja nie psuje
 * poprawności — kosztuje tylko dodatkowe porównania bcrypt na kilku
 * wierszach o tym samym prefiksie.
 */

const PREFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Losowy ciąg z podanego alfabetu — bez modulo bias (rejection sampling). */
function randomFromAlphabet(length: number, alphabet: string): string {
  const max = Math.floor(256 / alphabet.length) * alphabet.length;
  let out = "";
  while (out.length < length) {
    const bytes = randomBytes(length * 2);
    for (const byte of bytes) {
      if (byte < max) {
        out += alphabet[byte % alphabet.length]!;
        if (out.length === length) break;
      }
    }
  }
  return out;
}

export type GeneratedApiKey = {
  id: string;
  name: string;
  prefix: string;
  /** Pełny klucz — jedyny moment, w którym istnieje poza pamięcią klienta. */
  fullKey: string;
};

/**
 * Tworzy nowy klucz API firmy. Zwrócony `fullKey` trzeba pokazać
 * użytkownikowi od razu — nie da się go później odtworzyć.
 */
export async function generateApiKey(
  businessId: string,
  name: string,
): Promise<GeneratedApiKey> {
  const prefix = `pk_live_${randomFromAlphabet(4, PREFIX_ALPHABET)}`;
  const secret = randomFromAlphabet(32, PREFIX_ALPHABET);
  const fullKey = `${prefix}_${secret}`;
  const keyHash = await bcrypt.hash(fullKey, 10);

  const created = await prisma.apiKey.create({
    data: { businessId, name, prefix, keyHash },
    select: { id: true, name: true, prefix: true },
  });

  return { ...created, fullKey };
}

export type ApiKeyAuthResult =
  | { ok: true; apiKeyId: string; businessId: string }
  | { ok: false; status: 401 | 429; code: string; message: string };

const authFailure = (
  status: 401 | 429,
  code: string,
  message: string,
): ApiKeyAuthResult => ({ ok: false, status, code, message });

/**
 * Rate limit per klucz — okno stałe 60 s, licznik w pamięci procesu.
 *
 * OGRANICZENIE (świadome): licznik żyje w pamięci pojedynczej instancji.
 * Na serverless (Vercel) każda instancja liczy osobno, a zimny start
 * zeruje okno — limit działa więc jako miękki bezpiecznik per instancja,
 * nie twarda gwarancja globalna. Produkcyjnie należałoby przenieść licznik
 * do współdzielonego magazynu (Redis/Upstash); dla tego zakresu wystarcza.
 */
export const RATE_LIMIT_PER_MINUTE = 60;
const RATE_WINDOW_MS = 60_000;

const rateBuckets = new Map<string, { windowStart: number; count: number }>();

function checkRateLimit(apiKeyId: string, now: number): boolean {
  const bucket = rateBuckets.get(apiKeyId);
  if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
    rateBuckets.set(apiKeyId, { windowStart: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_PER_MINUTE;
}

/** lastUsedAt odświeżamy najwyżej raz na minutę — bez UPDATE na każdy request. */
const LAST_USED_THROTTLE_MS = 60_000;

/**
 * Uwierzytelnia żądanie publicznego API: nagłówek `Authorization: Bearer
 * pk_..._...`. Zwraca zakres (businessId) klucza albo błąd 401/429.
 */
export async function authenticateApiRequest(
  request: Request,
): Promise<ApiKeyAuthResult> {
  const header = request.headers.get("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    return authFailure(
      401,
      "MISSING_API_KEY",
      "Brak klucza API. Dodaj nagłówek Authorization: Bearer <klucz>.",
    );
  }

  const token = header.slice("bearer ".length).trim();
  // Prefiks = pierwsze trzy segmenty rozdzielone „_": pk_live_a1b2.
  const segments = token.split("_");
  if (segments.length < 4 || segments[0] !== "pk") {
    return authFailure(401, "INVALID_API_KEY", "Nieprawidłowy klucz API.");
  }
  const prefix = segments.slice(0, 3).join("_");

  const candidates = await prisma.apiKey.findMany({
    where: { prefix, revokedAt: null },
    select: { id: true, businessId: true, keyHash: true, lastUsedAt: true },
  });

  let matched: (typeof candidates)[number] | null = null;
  for (const candidate of candidates) {
    if (await bcrypt.compare(token, candidate.keyHash)) {
      matched = candidate;
      break;
    }
  }
  if (!matched) {
    return authFailure(401, "INVALID_API_KEY", "Nieprawidłowy klucz API.");
  }

  const now = Date.now();
  if (!checkRateLimit(matched.id, now)) {
    return authFailure(
      429,
      "RATE_LIMITED",
      `Przekroczony limit ${RATE_LIMIT_PER_MINUTE} żądań na minutę dla tego klucza.`,
    );
  }

  if (
    !matched.lastUsedAt ||
    now - matched.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS
  ) {
    // Best-effort: znacznik użycia nie może wywrócić żądania.
    try {
      await prisma.apiKey.update({
        where: { id: matched.id },
        data: { lastUsedAt: new Date(now) },
      });
    } catch (error) {
      console.error("api-keys: nie udało się zapisać lastUsedAt:", error);
    }
  }

  return { ok: true, apiKeyId: matched.id, businessId: matched.businessId };
}
