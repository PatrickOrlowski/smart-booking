import { DEFAULT_LOCALE, type Locale } from "./config";
import { pl } from "./pl";
import { en } from "./en";

export {
  DEFAULT_LOCALE,
  INTL_LOCALE,
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  isLocale,
  localeFromAcceptLanguage,
  type Locale,
} from "./config";

/**
 * Rdzeń tłumaczeń — czysty (bez next/headers), wspólny dla serwera
 * i klienta. Warstwy wejściowe: `getTranslations()` (serwer, cookie)
 * i `useTranslations()` (klient, Context).
 */

export type MessageKey = keyof typeof pl;

export type Dictionary = Record<MessageKey, string>;

const DICTIONARIES: Record<Locale, Dictionary> = { pl, en };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

export type TranslateParams = Record<string, string | number>;

export type Translator = (key: MessageKey, params?: TranslateParams) => string;

const interpolate = (template: string, params?: TranslateParams): string =>
  params
    ? template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
      )
    : template;

export function createTranslator(locale: Locale): Translator {
  const dict = getDictionary(locale);
  return (key, params) => interpolate(dict[key], params);
}

/**
 * Bazy kluczy liczebnikowych: każdy klucz `X.one` musi mieć rodzeństwo
 * `X.few` i `X.many` (EN trzyma w `.few`/`.many` tę samą formę mnogą).
 */
export type PluralBase = {
  [K in MessageKey]: K extends `${infer B}.one`
    ? `${B}.few` extends MessageKey
      ? `${B}.many` extends MessageKey
        ? B
        : never
      : never
    : never;
}[MessageKey];

export type PluralTranslator = (
  base: PluralBase,
  count: number,
  params?: TranslateParams,
) => string;

/**
 * `tp("plural.results", 5)` → "5 wyników" / "5 results".
 *
 * Kategorię wybiera Intl.PluralRules: pl → one/few/many (ułamki jako
 * `other` spadają na `many`), en → one/other (`other` → `many`).
 */
export function createPluralTranslator(locale: Locale): PluralTranslator {
  const dict = getDictionary(locale);
  const rules = new Intl.PluralRules(locale);
  return (base, count, params) => {
    const category = rules.select(count);
    const suffix = category === "one" ? "one" : category === "few" ? "few" : "many";
    const template = dict[`${base}.${suffix}` as MessageKey];
    return interpolate(template, { count, ...params });
  };
}

export type Translations = {
  locale: Locale;
  t: Translator;
  tp: PluralTranslator;
};

export function createTranslations(locale: Locale): Translations {
  return {
    locale,
    t: createTranslator(locale),
    tp: createPluralTranslator(locale),
  };
}
