"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/panel/sale", label: "Sale i plan" },
  { href: "/panel/sale/zestawienia", label: "Zestawienia" },
  { href: "/panel/sale/ustawienia", label: "Turn time i pacing" },
] as const;

/** Zakładki sekcji restauracyjnej — wg przepisu „Zakładki" z DESIGN.md. */
export function SaleTabs() {
  const pathname = usePathname();
  return (
    <nav className="mb-5 flex gap-4 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 shrink-0 items-end pb-2 text-[13px] whitespace-nowrap lg:min-h-0",
              active
                ? "border-b-[2.5px] border-foreground font-bold"
                : "font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
