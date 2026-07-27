import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LogoutButton } from "@/components/auth/logout-button";
import { UserMenu } from "@/components/auth/user-menu";
import { getStaffContext } from "./staff-context";

export const metadata: Metadata = {
  title: "Mój grafik — Planner",
};

export default async function PracownikLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { sessionUser, profile } = await getStaffContext();
  if (!sessionUser) {
    redirect("/login");
  }

  // Stan brzegowy: konto zalogowane, ale bez StaffProfile — nie ma czego
  // pokazać. Wzór: karty "Stany brzegowe" z prototypu.
  if (!profile) {
    return (
      <main className="flex flex-1 items-center justify-center px-5 py-16">
        <div className="w-full max-w-md rounded-2xl border-[1.5px] border-border-strong bg-card p-6 sm:p-7">
          <div className="mb-4 flex size-9 items-center justify-center rounded-full border border-destructive/40 bg-destructive/10 text-[17px] text-destructive">
            !
          </div>
          <h1 className="font-display text-[26px] leading-[1.05] font-extrabold tracking-tight">
            To konto nie jest powiązane z&nbsp;żadnym grafikiem
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Panel pracownika działa tylko dla kont zaproszonych do zespołu
            firmy. Poproś właściciela o&nbsp;zaproszenie albo zaloguj się na
            inne konto.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <LogoutButton className="min-h-11 border-none bg-primary text-primary-foreground hover:bg-primary/80">
              Wyloguj się
            </LogoutButton>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center rounded-full border-[1.5px] border-border-strong bg-card px-4 py-2 text-[13px] font-semibold transition-colors hover:bg-muted"
            >
              Strona główna
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const staffName = sessionUser.name ?? profile.resource.name;

  return (
    <div className="flex flex-1 flex-col">
      {/* Top-bar: na telefonie skrócony (logo + awatar z wylogowaniem
          w dropdownie UserMenu), pełny od md. */}
      <header className="flex h-16 items-center gap-3 bg-ink px-4 text-ink-foreground md:gap-4 md:px-5">
        <Link
          href="/pracownik"
          className="font-display text-lg font-extrabold tracking-tight"
        >
          Planner
        </Link>
        <span aria-hidden className="hidden h-5 w-px bg-ink-foreground/25 md:block" />
        <div className="hidden min-w-0 md:block">
          <div className="truncate text-[13px] leading-tight font-semibold">
            {profile.business.name}
          </div>
          <div className="truncate font-mono text-[10px] tracking-[0.1em] text-ink-foreground/60 uppercase">
            {profile.resource.location.name}
          </div>
        </div>
        <div className="ml-auto flex flex-none items-center gap-3">
          <span className="hidden font-mono text-[11px] text-ink-foreground/70 md:block">
            {staffName}
          </span>
          <LogoutButton className="hidden border-ink-foreground/30 bg-transparent px-3.5 py-1.5 text-[12px] text-ink-foreground hover:bg-ink-foreground/10 md:inline-flex" />
          <UserMenu
            user={{
              name: sessionUser.name,
              email: sessionUser.email,
              role: sessionUser.role,
            }}
          />
        </div>
      </header>
      {/* Telefon: pełna szerokość px-4; od sm max-w-2xl; od lg max-w-3xl. */}
      <main className="mx-auto w-full flex-1 px-4 py-6 sm:max-w-2xl sm:px-5 md:py-8 lg:max-w-3xl">
        {children}
      </main>
    </div>
  );
}
