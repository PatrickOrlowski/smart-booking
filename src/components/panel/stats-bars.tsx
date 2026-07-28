import { cn } from "@/lib/utils";
import { formatPrice } from "@/components/panel/format";
import { StatEmpty } from "@/components/panel/stats-cards";

/**
 * Poziome paski statystyk: obłożenie zespołu (miernik), top usługi
 * (paski wielkości) i źródła rezerwacji (pasek skumulowany, 2 segmenty).
 *
 * Wg wytycznych dataviz: jedna miara = jeden odcień (primary); miernik ma
 * tor w jaśniejszym kroku tej samej rodziny (accent); pasek skumulowany
 * z 2 kategoriami używa tokenów chart-1/chart-4 (para zwalidowana pod CVD),
 * z odstępem w kolorze powierzchni i legendą — identyfikacja nigdy nie
 * opiera się wyłącznie na kolorze. Teksty zawsze w tokenach tekstu.
 */

// --- Obłożenie per pracownik ---------------------------------------------

export type OccupancyRow = {
  resourceId: string;
  name: string;
  bookedMinutes: number;
  workMinutes: number;
};

function hoursLabel(minutes: number): string {
  const hours = minutes / 60;
  return `${hours.toLocaleString("pl-PL", { maximumFractionDigits: hours < 10 ? 1 : 0 })} h`;
}

export function OccupancyList({ rows }: { rows: OccupancyRow[] }) {
  if (rows.length === 0) {
    return (
      <StatEmpty>
        Brak pracowników z grafikiem w tym okresie — obłożenie policzy się,
        gdy zespół ma godziny pracy.
      </StatEmpty>
    );
  }
  return (
    <ul className="flex flex-col gap-3.5">
      {rows.map((row) => {
        const pct =
          row.workMinutes > 0
            ? Math.round((row.bookedMinutes / row.workMinutes) * 100)
            : null;
        return (
          <li key={row.resourceId}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[13px] font-semibold">
                {row.name}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {pct === null
                  ? "brak grafiku"
                  : `${hoursLabel(row.bookedMinutes)} / ${hoursLabel(row.workMinutes)} · ${pct}%`}
              </span>
            </div>
            <div
              className="mt-1.5 h-2 overflow-hidden rounded-full bg-accent"
              role="progressbar"
              aria-label={`Obłożenie: ${row.name}`}
              aria-valuenow={pct ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              {pct !== null && pct > 0 ? (
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// --- Top usługi ------------------------------------------------------------

export type TopServiceRow = {
  serviceId: string;
  name: string;
  count: number;
  revenueCents: number;
};

function visitsLabel(count: number): string {
  if (count === 1) return "1 wizyta";
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} wizyty`;
  }
  return `${count} wizyt`;
}

export function TopServicesList({
  rows,
  currency,
}: {
  rows: TopServiceRow[];
  currency: string;
}) {
  if (rows.length === 0) {
    return (
      <StatEmpty>
        Brak zakończonych wizyt w tym okresie — ranking usług pojawi się po
        pierwszych rozliczeniach.
      </StatEmpty>
    );
  }
  const maxRevenue = Math.max(...rows.map((row) => row.revenueCents), 1);
  return (
    <ul className="flex flex-col gap-3.5">
      {rows.map((row) => (
        <li key={row.serviceId}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[13px] font-semibold">
              {row.name}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {visitsLabel(row.count)} ·{" "}
              <span className="font-medium text-foreground">
                {formatPrice(row.revenueCents, currency)}
              </span>
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{
                width: `${Math.max((row.revenueCents / maxRevenue) * 100, 2)}%`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// --- Źródła rezerwacji -----------------------------------------------------

export type SourceSplit = {
  marketplace: number;
  manual: number;
};

export function SourcesSplit({ split }: { split: SourceSplit }) {
  const total = split.marketplace + split.manual;
  if (total === 0) {
    return (
      <StatEmpty>Brak rezerwacji w tym okresie.</StatEmpty>
    );
  }
  const marketplacePct = Math.round((split.marketplace / total) * 100);
  const manualPct = 100 - marketplacePct;
  const segments = [
    {
      key: "marketplace",
      label: "Marketplace",
      count: split.marketplace,
      pct: marketplacePct,
      swatch: "bg-chart-1",
    },
    {
      key: "manual",
      label: "Ręczne (personel)",
      count: split.manual,
      pct: manualPct,
      swatch: "bg-chart-4",
    },
  ];
  return (
    <div>
      {/* pasek skumulowany — 2 segmenty rozdzielone kolorem powierzchni */}
      <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-full">
        {segments.map((segment) =>
          segment.count > 0 ? (
            <div
              key={segment.key}
              className={cn("h-full", segment.swatch)}
              style={{ width: `${(segment.count / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-3 flex flex-col gap-1.5">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-2.5">
            <span
              className={cn("size-2.5 shrink-0 rounded-full", segment.swatch)}
              aria-hidden
            />
            <span className="flex-1 text-[13px] font-medium">
              {segment.label}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {segment.count} ·{" "}
              <span className="font-medium text-foreground">
                {segment.pct}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
