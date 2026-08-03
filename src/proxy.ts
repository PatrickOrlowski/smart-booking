import { NextResponse, type NextRequest } from "next/server";

import {
  LOCALES,
  LOCALE_COOKIE,
  isLocale,
  localeFromAcceptLanguage,
} from "@/i18n/config";

/**
 * Proxy (dawne middleware) — jedyne zadanie: strony ISR miast i kategorii.
 *
 * /m/[miasto] i /k/[kategoria] są statyczne z rewalidacją co godzinę, więc
 * nie mogą czytać cookies (odczyt degradowałby trasę do renderu
 * dynamicznego i każde wejście bota odpalałoby komplet zapytań do bazy).
 * Zamiast tego fizycznie żyją pod app/[locale]/{m,k}/… i są prerenderowane
 * osobno per język, a proxy przepisuje publiczny URL (/m/warszawa) na
 * wariant zgodny z cookie `planner.locale` (fallback: Accept-Language → pl).
 * URL w przeglądarce się nie zmienia — struktura tras publicznych zostaje.
 *
 * Pozostałe trasy publiczne są i tak dynamiczne i czytają locale wprost
 * z cookies w `getTranslations()` — proxy ich nie dotyka.
 */

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Bezpośrednie wejście na wariant językowy (/pl/m/…, /en/k/…) zostawiamy
  // w spokoju — rel=canonical wskazuje wersję bez prefiksu.
  if (LOCALES.some((locale) => pathname.startsWith(`/${locale}/`))) {
    return NextResponse.next();
  }

  const fromCookie = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(fromCookie)
    ? fromCookie
    : localeFromAcceptLanguage(request.headers.get("accept-language"));

  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/m/:path*", "/k/:path*"],
};
