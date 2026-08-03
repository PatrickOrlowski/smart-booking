import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateApiRequest } from "@/lib/api-keys";

/**
 * Wspólna obudowa publicznego API (/api/public/v1/*).
 *
 * Każdy endpoint: uwierzytelnienie kluczem (Authorization: Bearer pk_...),
 * zakres = firma właściciela klucza, błędy w spójnym formacie
 * `{ error: { code, message } }`.
 */

export function apiError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...extra } },
    { status },
  );
}

export type PublicApiContext = {
  apiKeyId: string;
  business: { id: string; slug: string; name: string; currency: string };
};

/**
 * Uwierzytelnia żądanie i ładuje firmę klucza. Zwraca gotową odpowiedź
 * błędu (401/429) albo kontekst firmy — NIGDY danych innej firmy.
 */
export async function requireApiBusiness(
  request: Request,
): Promise<{ ok: true; ctx: PublicApiContext } | { ok: false; response: NextResponse }> {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) {
    return {
      ok: false,
      response: apiError(auth.status, auth.code, auth.message),
    };
  }

  const business = await prisma.business.findUnique({
    where: { id: auth.businessId },
    select: { id: true, slug: true, name: true, currency: true, status: true },
  });
  if (!business) {
    return {
      ok: false,
      response: apiError(401, "INVALID_API_KEY", "Klucz API bez firmy."),
    };
  }

  // Zawieszenie przez platformę mrozi także publiczne API — inaczej firma
  // zdjęta z marketplace'u dalej obsługiwałaby rezerwacje przez integratora.
  // DRAFT/PENDING_REVIEW przechodzą: właściciel może testować integrację
  // przed aktywacją profilu.
  if (business.status === "SUSPENDED") {
    return {
      ok: false,
      response: apiError(
        403,
        "BUSINESS_SUSPENDED",
        "Firma jest zawieszona przez platformę — dostęp do API wstrzymany.",
      ),
    };
  }

  return {
    ok: true,
    ctx: {
      apiKeyId: auth.apiKeyId,
      business: {
        id: business.id,
        slug: business.slug,
        name: business.name,
        currency: business.currency,
      },
    },
  };
}

/**
 * Rozstrzyga dostęp do zasobu wskazanego identyfikatorem: należy do firmy
 * klucza → ok; istnieje, ale należy do innej firmy → 403 (bez żadnych
 * danych); nie istnieje → 404. Główne ryzyko tego API to wyciek między
 * firmami — stąd jedna funkcja zamiast rozproszonych porównań.
 */
export function crossTenantError(
  exists: boolean,
  what: string,
): NextResponse {
  return exists
    ? apiError(403, "FORBIDDEN", `Ten ${what} należy do innej firmy.`)
    : apiError(404, "NOT_FOUND", `Nie znaleziono: ${what}.`);
}

/**
 * Naruszenie exclusion constraintu `booking_items_no_overlap` (SQLSTATE
 * 23P01) — ten sam mechanizm co w /api/v1/bookings: kod szukamy w łańcuchu
 * przyczyn, bo Prisma nie mapuje go na dedykowany błąd.
 */
export function isOverlapConflict(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const { code, message, cause } = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (code === "23P01") return true;
    if (
      typeof message === "string" &&
      (message.includes("23P01") ||
        message.includes("booking_items_no_overlap") ||
        message.includes("exclusion constraint"))
    ) {
      return true;
    }
    current = cause;
  }
  return false;
}
