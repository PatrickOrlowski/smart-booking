import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, UnauthorizedError } from "@/lib/authz";

/**
 * Jeden punkt prawdy dla dostępu do panelu administratora platformy.
 *
 * Rola jest czytana Z BAZY, nie z sesji. Strategia auth to JWT: `role`
 * w tokenie pochodzi z chwili logowania i żyje tak długo, jak token.
 * Gdyby admin stracił rolę (albo nadał ją sobie sam przez /admin/uzytkownicy),
 * sesja nadal twierdziłaby swoje — a to jest panel, w którym da się zmieniać
 * role i zawieszać firmy. Jedno dodatkowe zapytanie na render jest tańsze
 * niż odwołanie uprawnień, które nie działa do wygaśnięcia tokenu.
 */

export type PlatformAdmin = {
  id: string;
  name: string | null;
  email: string | null;
};

/** Dokąd trafia użytkownik bez uprawnień — marketplace, nie ekran błędu. */
const NOT_ADMIN_REDIRECT = "/";
const LOGIN_REDIRECT = "/login";

type AdminCheck =
  | { ok: true; admin: PlatformAdmin }
  | { ok: false; reason: "unauthenticated" | "forbidden" };

/**
 * Sesja + rola z bazy. `cache()` deduplikuje zapytanie w obrębie jednego
 * renderu (layout + strona + komponenty pytają niezależnie).
 */
const checkPlatformAdmin = cache(async (): Promise<AdminCheck> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, reason: "unauthenticated" };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user || user.role !== "PLATFORM_ADMIN") {
    return { ok: false, reason: "forbidden" };
  }

  return { ok: true, admin: { id: user.id, name: user.name, email: user.email } };
});

/** Administrator albo null — do renderowania warunkowego, bez przekierowań. */
export async function getPlatformAdmin(): Promise<PlatformAdmin | null> {
  const result = await checkPlatformAdmin();
  return result.ok ? result.admin : null;
}

/**
 * Strażnik stron i layoutu panelu admina: przekierowuje zamiast renderować.
 *
 * Niezalogowany → /login, zalogowany bez roli → strona główna. Świadomie
 * NIE używamy `forbidden()` z Next 16: wymaga eksperymentalnej flagi
 * `experimental.authInterrupts` w next.config.ts, a ten plik jest poza
 * obszarem tego zadania. Redirect ma ten sam efekt praktyczny —
 * treść panelu nigdy nie trafia do odpowiedzi.
 */
export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  const result = await checkPlatformAdmin();
  if (result.ok) return result.admin;
  redirect(result.reason === "unauthenticated" ? LOGIN_REDIRECT : NOT_ADMIN_REDIRECT);
}

/**
 * Strażnik server actions: rzuca, zamiast przekierowywać.
 *
 * Akcje zwracają `{ ok: false, error }` do toasta, więc potrzebują wyjątku,
 * który da się złapać — `redirect()` w akcji wywołanej z klienta zamieniłby
 * odmowę uprawnień w nawigację w tle.
 */
export async function requirePlatformAdminAction(): Promise<PlatformAdmin> {
  const result = await checkPlatformAdmin();
  if (result.ok) return result.admin;
  if (result.reason === "unauthenticated") throw new UnauthorizedError();
  throw new ForbiddenError("Ta operacja wymaga uprawnień administratora platformy");
}
