import Link from "next/link";

import { auth, signOut } from "@/lib/auth";
import type { UserRole } from "@/generated/prisma/enums";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type UserMenuUser = {
  name?: string | null;
  email?: string | null;
  role: UserRole;
};

function initialsOf(user: UserMenuUser): string {
  const source = user.name?.trim() || user.email || "?";
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function panelLink(role: UserRole): { href: string; label: string } | null {
  switch (role) {
    case "BUSINESS_OWNER":
      return { href: "/panel", label: "Panel firmy" };
    case "STAFF":
      return { href: "/pracownik", label: "Mój grafik" };
    case "PLATFORM_ADMIN":
      return { href: "/panel", label: "Panel" };
    default:
      return null;
  }
}

/**
 * Awatar z inicjałami + dropdown: „Moje wizyty" (każdy zalogowany), link
 * do panelu wg roli i wylogowanie. Server component — gdy nie dostanie
 * usera w propsach, sam czyta sesję; bez sesji renderuje link do logowania
 * (gotowy do użycia na stronach klienta).
 */
export async function UserMenu({ user }: { user?: UserMenuUser }) {
  const resolved = user ?? (await auth())?.user;

  if (!resolved) {
    return (
      <Link
        href="/login"
        className="inline-flex items-center rounded-full border-[1.5px] border-border-strong bg-card px-4 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted"
      >
        Zaloguj się
      </Link>
    );
  }

  const link = panelLink(resolved.role);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="cursor-pointer rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label="Menu użytkownika"
      >
        <Avatar>
          <AvatarFallback className="bg-primary font-mono text-[11px] font-medium text-primary-foreground">
            {initialsOf(resolved)}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 min-w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-[13px] font-semibold text-foreground">
            {resolved.name ?? "Konto"}
          </span>
          {resolved.email ? (
            <span className="truncate font-mono text-[11px] font-normal text-muted-foreground">
              {resolved.email}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/konto" className="cursor-pointer">
            Moje wizyty
          </Link>
        </DropdownMenuItem>
        {link ? (
          <DropdownMenuItem asChild>
            <Link href={link.href} className="cursor-pointer">
              {link.label}
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <DropdownMenuItem asChild variant="destructive">
            <button type="submit" className="w-full cursor-pointer text-left">
              Wyloguj
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
