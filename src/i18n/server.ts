import { cookies, headers } from "next/headers";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  localeFromAcceptLanguage,
  type Locale,
} from "./config";
import { createTranslations, type Translations } from "./index";

/**
 * Serwerowe wejście do tłumaczeń.
 *
 * UWAGA na strony statyczne/ISR: `getLocale()` czyta cookies i nagłówki,
 * więc degraduje trasę do renderu dynamicznego. Strony ISR (miasta,
 * kategorie) dostają locale z segmentu [locale] (rewrite w proxy.ts)
 * i wołają `getTranslations(locale)` z jawnym argumentem — bez dotykania
 * cookies.
 */

export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const headerStore = await headers();
  return localeFromAcceptLanguage(headerStore.get("accept-language"));
}

export async function getTranslations(locale?: Locale): Promise<Translations> {
  return createTranslations(locale ?? (await getLocale()));
}

export { DEFAULT_LOCALE };
