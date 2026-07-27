import { signOut } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * Przycisk wylogowania — server action signOut z przekierowaniem na stronę
 * główną. Formularz ma `display: contents`, więc przycisk można stylować
 * w miejscu użycia przez `className`.
 */
export function LogoutButton({
  className,
  children = "Wyloguj",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <form
      className="contents"
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <button
        type="submit"
        className={cn(
          "inline-flex cursor-pointer items-center justify-center rounded-full border-[1.5px] border-border-strong bg-card px-4 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted",
          className,
        )}
      >
        {children}
      </button>
    </form>
  );
}
