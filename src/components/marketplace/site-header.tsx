import Link from "next/link";

import { UserMenu } from "@/components/auth/user-menu";
import { DEFAULT_LOCALE, createTranslator, type Locale } from "@/i18n";
import { LocaleSwitcher } from "@/i18n/locale-switcher";

/**
 * Belka marketplace dla stron klienta — widoczna tylko na lg+ (na telefonie
 * prototyp nie ma top-bara). Logo w font-display, po prawej przełącznik
 * języka, wejścia dla firm i menu użytkownika. UserMenu sam czyta sesję:
 * zalogowany dostaje awatar z dropdownem, niezalogowany — przycisk
 * „Zaloguj się".
 *
 * `locale` przychodzi z propsa (strona zna go z cookies albo z segmentu
 * [locale]) — belka sama NIE czyta cookies, żeby strony ISR
 * (/m/[miasto], /k/[kategoria]) zostały statyczne. Z tego samego powodu
 * `showAuth={false}` renderuje zwykły link do logowania, bez `auth()`.
 */
export function SiteHeader({
  showAuth = true,
  locale = DEFAULT_LOCALE,
}: {
  showAuth?: boolean;
  locale?: Locale;
}) {
  const t = createTranslator(locale);

  return (
    <header className="hidden border-b border-border bg-background lg:block">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-8">
        <Link
          href="/"
          className="font-display text-xl font-extrabold tracking-tight"
        >
          Planner
        </Link>
        <nav className="flex items-center gap-2.5">
          <LocaleSwitcher />
          <Link
            href="/panel"
            className="rounded-full px-4 py-2 text-[13px] font-semibold text-foreground/80 transition-colors hover:text-foreground"
          >
            {t("header.forBusinesses")}
          </Link>
          {showAuth ? (
            <UserMenu locale={locale} />
          ) : (
            <Link
              href="/login"
              className="inline-flex items-center rounded-full border-[1.5px] border-border-strong bg-card px-4 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted"
            >
              {t("header.login")}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
