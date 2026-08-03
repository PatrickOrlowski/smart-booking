"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string };

const NAV_ITEMS: NavItem[] = [
  { href: "/panel", label: "Kalendarz" },
  { href: "/panel/uslugi", label: "Usługi" },
  { href: "/panel/zespol", label: "Zespół" },
  { href: "/panel/klienci", label: "Klienci" },
  { href: "/panel/opinie", label: "Opinie" },
  { href: "/panel/statystyki", label: "Statystyki" },
  { href: "/panel/aktywnosc", label: "Aktywność" },
  { href: "/panel/ustawienia", label: "Ustawienia" },
  { href: "/panel/plan", label: "Plan" },
  { href: "/panel/promocje", label: "Promocje" },
  { href: "/panel/serie", label: "Serie" },
  { href: "/panel/integracje", label: "Integracje" },
];

/** Pozycje wyłącznie dla restauracji — salon ich nie widzi. */
const RESTAURANT_ITEMS: NavItem[] = [
  { href: "/panel/dzis", label: "Dziś" },
  { href: "/panel/sale", label: "Sale" },
];

/**
 * Nawigacja pigułkami w ciemnym top-barze — wg przepisu z DESIGN.md.
 * Gdy pigułki nie mieszczą się w top-barze, przewijają się poziomo we
 * własnym kontenerze (bez widocznego paska) — strona nigdy nie scrolluje
 * poziomo. Poniżej `lg` cele dotykowe rosną do ≥44px.
 */
export function PanelNav({ isRestaurant = false }: { isRestaurant?: boolean }) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  // Widok hosta („Dziś") i plan sal siedzą tuż za kalendarzem — to codzienne
  // narzędzia restauracji, nie ustawienia.
  const items = isRestaurant
    ? [NAV_ITEMS[0]!, ...RESTAURANT_ITEMS, ...NAV_ITEMS.slice(1)]
    : NAV_ITEMS;

  // Przewijana nawigacja: aktywna pigułka nie może zostać poza kadrem.
  useEffect(() => {
    navRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  return (
    <nav
      ref={navRef}
      className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => {
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
