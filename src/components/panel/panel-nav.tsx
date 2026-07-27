"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/panel", label: "Kalendarz" },
  { href: "/panel/uslugi", label: "Usługi" },
  { href: "/panel/zespol", label: "Zespół" },
  { href: "/panel/opinie", label: "Opinie" },
  { href: "/panel/ustawienia", label: "Ustawienia" },
  { href: "/panel/plan", label: "Plan" },
] as const;

/**
 * Nawigacja pigułkami w ciemnym top-barze — wg przepisu z DESIGN.md.
 * Poniżej `lg` pigułki przewijają się poziomo (bez widocznego paska),
 * a cele dotykowe rosną do ≥44px; od `lg` wygląd jak w prototypie.
 */
export function PanelNav() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);

  // Przewijana nawigacja: aktywna pigułka nie może zostać poza kadrem.
  useEffect(() => {
    navRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  return (
    <nav
      ref={navRef}
      className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex-none lg:overflow-visible"
    >
      {NAV_ITEMS.map((item) => {
        const active =
          item.href === "/panel"
            ? pathname === "/panel"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            data-active={active}
            className={cn(
              "flex min-h-11 shrink-0 items-center rounded-full px-4 py-1.5 text-[13px] whitespace-nowrap transition-colors lg:min-h-0",
              active
                ? "bg-ink-foreground font-bold text-ink"
                : "font-medium text-ink-foreground/70 hover:text-ink-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
