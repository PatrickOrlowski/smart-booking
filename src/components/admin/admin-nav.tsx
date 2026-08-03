"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string };

const NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "Pulpit" },
  { href: "/admin/firmy", label: "Firmy" },
  { href: "/admin/opinie", label: "Opinie" },
  { href: "/admin/zgloszenia", label: "Zgłoszenia" },
  { href: "/admin/uzytkownicy", label: "Użytkownicy" },
];

/**
 * Nawigacja panelu admina — pigułki w ciemnym top-barze, jak w panelu firmy,
 * ale aktywna pozycja świeci bursztynem (`warning`), nie kremem: to jedyne
 * miejsce w produkcie, gdzie da się zawiesić cudzą firmę, i ma być widać
 * na pierwszy rzut oka, że to nie jest zwykły panel.
 *
 * Gdy pigułki nie mieszczą się w barze, przewijają się poziomo we własnym
 * kontenerze — strona nigdy nie scrolluje poziomo.
 */
export function AdminNav() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);

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
      {NAV_ITEMS.map((item) => {
        const active =
          item.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            data-active={active}
            className={cn(
              "flex min-h-11 shrink-0 items-center rounded-full px-4 py-1.5 text-[13px] whitespace-nowrap transition-colors lg:min-h-0",
              active
                ? "bg-warning font-bold text-ink"
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
