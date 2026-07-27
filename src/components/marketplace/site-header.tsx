import Link from "next/link";

import { UserMenu } from "@/components/auth/user-menu";

/**
 * Belka marketplace dla stron klienta — widoczna tylko na lg+ (na telefonie
 * prototyp nie ma top-bara). Logo w font-display, po prawej wejścia dla firm
 * i menu użytkownika. UserMenu sam czyta sesję: zalogowany dostaje awatar
 * z dropdownem, niezalogowany — przycisk „Zaloguj się".
 *
 * `showAuth={false}` renderuje w tym miejscu zwykły link do logowania, bez
 * `auth()`. Potrzebują tego strony ISR (/m/[miasto], /k/[kategoria]):
 * odczyt ciasteczek sesji degraduje całą trasę do renderu dynamicznego,
 * przez co `revalidate`/`generateStaticParams` przestają cokolwiek dawać,
 * a każde wejście bota odpala komplet zapytań do bazy.
 */
export function SiteHeader({ showAuth = true }: { showAuth?: boolean }) {
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
          <Link
            href="/panel"
            className="rounded-full px-4 py-2 text-[13px] font-semibold text-foreground/80 transition-colors hover:text-foreground"
          >
            Dla firm
          </Link>
          {showAuth ? (
            <UserMenu />
          ) : (
            <Link
              href="/login"
              className="inline-flex items-center rounded-full border-[1.5px] border-border-strong bg-card px-4 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted"
            >
              Zaloguj się
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
