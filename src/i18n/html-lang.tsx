"use client";

import { useEffect } from "react";

import { LOCALE_COOKIE, isLocale } from "./config";

/**
 * Synchronizacja `<html lang>` z aktywnym językiem.
 *
 * Root layout nie może czytać cookies bez degradowania tras statycznych
 * (ISR miast/kategorii) do renderu dynamicznego — dlatego SSR zawsze
 * emituje `lang="pl"`, a ten komponent poprawia atrybut po hydracji.
 * Rozjazd dotyczy pierwszej klatki u osób z wybranym EN oraz botów na
 * fizycznych trasach /en/... (Google renderuje JS; sygnałem nadrzędnym
 * pozostają self-canonical + hreflang w metadanych tych stron).
 *
 * Priorytet: jawny prefiks języka w ścieżce (/pl/..., /en/... — treść JEST
 * w tym języku niezależnie od cookie), potem cookie `planner.locale`.
 * Przełącznik języka aktualizuje atrybut natychmiast.
 */
export function HtmlLangSync() {
  useEffect(() => {
    const pathLocale = window.location.pathname.split("/")[1];
    const match = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE.replace(".", "\\.")}=([^;]+)`),
    );
    const value = isLocale(pathLocale) ? pathLocale : match?.[1];
    if (isLocale(value) && document.documentElement.lang !== value) {
      document.documentElement.lang = value;
    }
  }, []);

  return null;
}
