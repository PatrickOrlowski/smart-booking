import { redirect } from "next/navigation";
import { getPanelBusiness } from "@/app/panel/data";
import { PanelNav } from "@/components/panel/panel-nav";
import { initials } from "@/components/panel/format";

/**
 * Layout dashboardu firmy: ciemny top-bar (bg-ink) z nazwą firmy
 * i zakładkami. Użytkownik bez firmy trafia do onboardingu.
 */
export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const panel = await getPanelBusiness();
  if (!panel) {
    redirect("/panel/nowa");
  }

  const { business, location } = panel;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-3 bg-ink px-4 text-ink-foreground sm:gap-6 sm:px-6">
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden font-display text-lg font-extrabold tracking-tight sm:block">
            Planner
          </span>
          <span className="hidden h-5 w-px bg-ink-foreground/20 sm:block" aria-hidden />
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary font-display text-[13px] font-extrabold text-primary-foreground dark:bg-ink-foreground dark:text-ink">
              {initials(business.name)}
            </span>
            <span className="hidden max-w-44 truncate text-[13.5px] font-bold tracking-tight md:block lg:max-w-none">
              {business.name}
            </span>
          </div>
        </div>
        <PanelNav isRestaurant={business.type === "RESTAURANT"} />
        <div className="ml-auto hidden shrink-0 font-mono text-[11px] text-ink-foreground/60 md:block">
          {location
            ? `${location.city} · ${location.timezone}`
            : panel.userEmail}
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
