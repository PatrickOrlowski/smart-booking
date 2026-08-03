import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Cegiełki wspólne dla wszystkich ekranów panelu admina — pigułki statusów,
 * chipy filtrów (zwykłe linki, zero JS), kafle liczb, karty sekcji,
 * stronicowanie i stany puste. Server components: żaden z nich nie ma stanu.
 */

/** Pigułka statusu w DM Mono — wg przepisu „Tag" z DESIGN.md. */
export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 font-mono text-[10px] leading-none font-medium tracking-[0.04em] whitespace-nowrap uppercase",
        tone,
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Chip filtra jako link — cel dotykowy ≥44px poniżej `md`. */
export function FilterChip({
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
        "flex min-h-11 shrink-0 items-center rounded-full px-3.5 text-[12px] font-semibold whitespace-nowrap transition-colors md:min-h-8",
        active
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-card text-foreground/80 hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

/** Poziomo przewijany rząd chipów — strona nigdy nie scrolluje poziomo. */
export function ChipRow({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {label ? (
        <span className="meta-label shrink-0 pr-1 whitespace-nowrap">
          {label}
        </span>
      ) : null}
      {children}
    </div>
  );
}

/** Kafel liczby: duża wartość w font-display, etykieta w DM Mono. */
export function StatCard({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: number | string;
  hint?: string;
  href?: string;
  tone?: "default" | "warning" | "danger";
}) {
  const body = (
    <>
      <span className="meta-label">{label}</span>
      <span
        className={cn(
          "mt-1.5 block font-display text-[30px] leading-none font-extrabold tracking-tight sm:text-[34px]",
          tone === "warning" && "text-warning-strong",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </span>
      {hint ? (
        <span className="mt-1.5 block font-mono text-[11px] text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </>
  );

  const className = cn(
    "block rounded-2xl border bg-card px-4 py-3.5",
    tone === "default" || !tone
      ? "border-border"
      : "border-[1.5px] border-border-strong",
    href && "transition-colors hover:bg-muted/40",
  );

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** Karta sekcji z nagłówkiem i opcjonalną akcją po prawej. */
export function SectionCard({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <h2 className="text-[14px] font-bold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Para „etykieta / wartość" na kartach szczegółów. */
export function DataRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-border px-4 py-2.5 first:border-t-0 sm:flex-row sm:items-baseline sm:gap-4 sm:px-5">
      <span className="meta-label shrink-0 sm:w-40">{label}</span>
      <span className="min-w-0 text-[13px] break-words">{children}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-center justify-center rounded-2xl border border-border bg-card px-6 py-16">
      <div className="max-w-md text-center">
        <h2 className="font-display text-2xl font-extrabold tracking-tight">
          {title}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

/** Stronicowanie „‹ Poprzednia / strona X z Y / Następna ›". */
export function Pagination({
  page,
  pageCount,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav className="mt-5 flex items-center justify-between gap-3 font-mono text-[12px]">
      {page > 1 ? (
        <Link
          href={hrefFor(page - 1)}
          className="flex min-h-11 items-center rounded-full border border-border px-3 font-semibold hover:bg-muted md:min-h-8"
        >
          ‹ Poprzednia
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground">
        strona {page} z {pageCount}
      </span>
      {page < pageCount ? (
        <Link
          href={hrefFor(page + 1)}
          className="flex min-h-11 items-center rounded-full border border-border px-3 font-semibold hover:bg-muted md:min-h-8"
        >
          Następna ›
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/** Nagłówek ekranu: h1 + zdanie wyjaśniające. */
export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-[22px] leading-tight font-extrabold tracking-tight sm:text-[27px]">
          {title}
        </h1>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}
