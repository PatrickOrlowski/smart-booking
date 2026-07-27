import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Przełącznik widoku kalendarza Dzień/Tydzień — pigułki wg przepisu
 * chipów filtra z DESIGN.md, sterowane searchParamem `widok=tydzien`.
 * Na telefonie cele dotykowe rosną do ≥44px (h-9 + padding kontenera).
 */
export function CalendarViewToggle({
  dayHref,
  weekHref,
  active,
}: {
  dayHref: string;
  weekHref: string;
  active: "dzien" | "tydzien";
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-border bg-card p-1">
      <ToggleLink href={dayHref} active={active === "dzien"}>
        Dzień
      </ToggleLink>
      <ToggleLink href={weekHref} active={active === "tydzien"}>
        Tydzień
      </ToggleLink>
    </div>
  );
}

function ToggleLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 items-center rounded-full px-3.5 text-[12px] font-semibold whitespace-nowrap transition-colors lg:h-6 lg:px-3",
        active
          ? "bg-primary text-primary-foreground"
          : "text-foreground/70 hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
