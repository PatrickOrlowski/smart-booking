/**
 * Konfiguracja wielojęzyczności części publicznej.
 *
 * Mechanizm jest cookie'owy (bez zmiany struktury tras): aktywny język
 * wyznacza kolejno cookie `planner.locale` → nagłówek Accept-Language →
 * domyślne "pl". Panele (firma / pracownik / admin) pozostają po polsku
 * i nie czytają tego cookie.
 *
 * Moduł jest czysty (bez next/headers), więc może być importowany także
 * z proxy.ts i z komponentów klienckich.
 */

export const LOCALES = ["pl", "en"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "pl";

/** Nazwa cookie z wybranym językiem — ustawia je przełącznik PL/EN. */
export const LOCALE_COOKIE = "planner.locale";

/** Rok — użytkownik raz wybiera język, wybór zostaje. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Tag BCP-47 dla Intl (waluty, daty). Dla EN europejski wariant 24 h. */
export const INTL_LOCALE: Record<Locale, string> = {
  pl: "pl-PL",
  en: "en-GB",
};

export function isLocale(value: unknown): value is Locale {
  return value === "pl" || value === "en";
}

/**
 * Najprostsze dopasowanie Accept-Language do obsługiwanych języków:
 * pierwszy tag, którego prefiks znamy, wygrywa. Bez bibliotek — dwa języki
 * nie uzasadniają negocjatora.
 */
export function localeFromAcceptLanguage(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;
  for (const part of header.split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase();
    if (!tag) continue;
    if (tag === "pl" || tag.startsWith("pl-")) return "pl";
    if (tag === "en" || tag.startsWith("en-")) return "en";
  }
  return DEFAULT_LOCALE;
}
