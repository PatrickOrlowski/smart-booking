import { cn } from "@/lib/utils";

/**
 * Karty statystyk panelu — kafelki KPI i wspólna rama sekcji wykresów.
 * Czysto prezentacyjne komponenty serwerowe (zero JS po stronie klienta);
 * wartości formatuje strona, tu tylko układ wg DESIGN.md (liczby w font-display,
 * meta w DM Mono, karty rounded-2xl).
 */

export function StatTile({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-4",
        className,
      )}
    >
      <div className="meta-label">{label}</div>
      <div className="mt-1.5 font-display text-[24px] leading-none font-extrabold tracking-tight sm:text-[27px]">
        {value}
      </div>
      {sub ? (
        <div className="mt-1.5 font-mono text-[11px] text-muted-foreground">
          {sub}
        </div>
      ) : null}
    </div>
  );
}

/** Rama sekcji wykresu: tytuł meta + opcjonalna wartość zbiorcza po prawej. */
export function StatSection({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-card p-4 sm:p-5",
        className,
      )}
    >
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="meta-label">{title}</h2>
        {aside ? (
          <span className="font-mono text-[11px] text-muted-foreground">
            {aside}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Pusty stan wewnątrz karty wykresu — gdy okres nie ma danych. */
export function StatEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center px-4 py-10 text-center text-[12.5px] text-muted-foreground">
      {children}
    </div>
  );
}
