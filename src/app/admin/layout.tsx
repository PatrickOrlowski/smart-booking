import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/admin-auth";
import { AdminNav } from "@/components/admin/admin-nav";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "Administracja — Planner",
  robots: { index: false, follow: false },
};

/**
 * Layout panelu administratora platformy.
 *
 * Bramka dostępu: KAŻDA strona pod /admin przechodzi przez
 * `requirePlatformAdmin()` (layout + osobno każda strona, bo layout w Next
 * nie jest gwarancją bezpieczeństwa dla zagnieżdżonych tras renderowanych
 * niezależnie), a każda server action przez `requirePlatformAdminAction()`.
 *
 * Wygląd: ta sama gramatyka co panel firmy (ciemny top-bar `bg-ink`,
 * pigułki nawigacji), ale z bursztynową sygnaturą — pasek pod barem,
 * plakietka „Administracja" i aktywna pigułka. Admin ma wiedzieć w każdej
 * sekundzie, że patrzy na cudze dane.
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const admin = await requirePlatformAdmin();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="shrink-0 border-b-[3px] border-warning bg-ink text-ink-foreground">
        <div className="flex h-16 items-center gap-3 px-4 sm:gap-5 sm:px-6">
          <div className="flex shrink-0 items-center gap-2.5">
            <Link
              href="/"
              className="hidden font-display text-lg font-extrabold tracking-tight transition-opacity hover:opacity-80 sm:block"
            >
              Planner
            </Link>
            <span className="rounded bg-warning px-2 py-1 font-mono text-[10px] font-medium tracking-[0.1em] text-ink uppercase">
              Administracja
            </span>
          </div>
          <AdminNav />
          <div className="ml-auto hidden shrink-0 font-mono text-[11px] text-ink-foreground/60 lg:block">
            {admin.email ?? admin.name ?? "admin"}
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <Toaster position="bottom-right" />
    </div>
  );
}
