"use client";

import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import {
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  type Locale,
} from "./config";
import { useTranslations } from "./client";

/**
 * Zapis wyboru języka w przeglądarce: cookie `planner.locale` + <html lang>.
 * Funkcja modułowa (poza komponentem) — mutacje globali w handlerze
 * komponentu odrzuca react-hooks/immutability.
 */
function persistLocale(next: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${next};path=/;max-age=${LOCALE_COOKIE_MAX_AGE};SameSite=Lax`;
  document.documentElement.lang = next;
}

/**
 * Przełącznik języka PL/EN — nagłówek i stopka marketplace'u.
 *
 * Zapisuje cookie `planner.locale`, aktualizuje <html lang> i odświeża
 * dane strony (`router.refresh()`): trasy dynamiczne renderują się od nowa
 * z nowym locale, a trasy ISR (miasta/kategorie) dostają rewrite na
 * właściwy wariant językowy w proxy.
 */
export function LocaleSwitcher({
  variant = "light",
  className,
}: {
  /** "dark" — wersja do ciemnej stopki (bg-ink). */
  variant?: "light" | "dark";
  className?: string;
}) {
  const router = useRouter();
  const { locale, t } = useTranslations();

  const switchTo = (next: Locale) => {
    if (next === locale) return;
    persistLocale(next);
    router.refresh();
  };

  return (
    <div
      role="group"
      aria-label={t("localeSwitcher.aria")}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border p-0.5",
        variant === "dark"
          ? "border-ink-foreground/25"
          : "border-border bg-card",
        className,
      )}
    >
      {LOCALES.map((entry) => {
        const active = entry === locale;
        return (
          <button
            key={entry}
            type="button"
            aria-pressed={active}
            onClick={() => switchTo(entry)}
            className={cn(
              "cursor-pointer rounded-full px-2.5 py-1 font-mono text-[11px] font-medium uppercase transition-colors",
              variant === "dark"
                ? active
                  ? "bg-ink-foreground/90 text-ink"
                  : "text-ink-foreground/60 hover:text-ink-foreground"
                : active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
            )}
          >
            {entry}
          </button>
        );
      })}
    </div>
  );
}
