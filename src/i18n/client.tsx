"use client";

import { createContext, useContext, useMemo } from "react";

import { DEFAULT_LOCALE, type Locale } from "./config";
import { createTranslations, type Translations } from "./index";

/**
 * Klienckie wejście do tłumaczeń: strona (server component) ustala locale
 * i opakowuje swoje drzewo w <LocaleProvider>, a komponenty klienckie
 * czytają `useLocale()` / `useTranslations()`.
 *
 * Domyślna wartość kontekstu to "pl" — komponent użyty poza providerem
 * (np. w panelu, który celowo zostaje po polsku) renderuje się poprawnie.
 */

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useTranslations(): Translations {
  const locale = useLocale();
  return useMemo(() => createTranslations(locale), [locale]);
}
