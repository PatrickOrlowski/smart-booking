import { formatPrice } from "@/components/panel/format";
import { StatEmpty } from "@/components/panel/stats-cards";

/**
 * Słupkowy wykres przychodu per dzień — inline SVG, bez bibliotek.
 *
 * Wg wytycznych dataviz: jedna seria = jeden odcień (token primary, bez
 * legendy), słupki z zaokrąglonym szczytem i prostą podstawą, 2px odstępu
 * między słupkami, siatka włoskowa, oś Y z okrągłymi wartościami, etykieta
 * bezpośrednia tylko na maksimum, tooltip per słupek (czysty CSS hover).
 * Szeroki okres (90 dni) przewija się w kontenerze overflow-x-auto —
 * strona nigdy nie scrolluje poziomo.
 */

export type RevenuePoint = {
  key: string;
  /** np. "21.07" — etykieta osi X */
  shortLabel: string;
  /** np. "pn 21.07" — etykieta tooltipa */
  fullLabel: string;
  valueCents: number;
};

/** Najbliższa „okrągła" wartość ≥ value (1 / 2 / 2.5 / 5 × 10^k). */
function niceCeil(value: number): number {
  if (value <= 0) return 0;
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const mult of [1, 2, 2.5, 5, 10]) {
    if (value <= mult * pow) return mult * pow;
  }
  return 10 * pow;
}

/** Wartość osi w zł: 1 234 56 gr → "1,2 tys.", 45 000 gr → "450". */
function axisLabel(cents: number): string {
  const zl = cents / 100;
  if (zl >= 1000) {
    return `${(zl / 1000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} tys.`;
  }
  return zl.toLocaleString("pl-PL", { maximumFractionDigits: 0 });
}

/** Słupek: prosta podstawa, zaokrąglony (4px) szczyt. */
function barPath(x: number, top: number, width: number, height: number): string {
  const r = Math.min(4, width / 2, height);
  const body = height - r;
  return [
    `M${x} ${top + height}`,
    `v${-body}`,
    `q0 ${-r} ${r} ${-r}`,
    `h${width - 2 * r}`,
    `q${r} 0 ${r} ${r}`,
    `v${body}`,
    "z",
  ].join("");
}

export function StatsRevenueChart({
  points,
  currency,
}: {
  points: RevenuePoint[];
  currency: string;
}) {
  const n = points.length;
  const maxCents = Math.max(0, ...points.map((p) => p.valueCents));

  if (n === 0 || maxCents === 0) {
    return (
      <StatEmpty>
        Brak przychodu w tym okresie — wykres pojawi się po pierwszej
        zakończonej wizycie.
      </StatEmpty>
    );
  }

  // Grubość słupka zależna od długości okresu (maks. 24px wg spec.).
  // Krótki okres projektujemy od razu na ~560 jednostek, żeby skalowanie
  // do szerokości karty nie pogrubiało słupków ponad limit.
  let barW: number;
  let gap: number;
  if (n <= 10) {
    const step = Math.floor(506 / n);
    barW = Math.min(24, step - 8);
    gap = step - barW;
  } else if (n <= 40) {
    [barW, gap] = [14, 4];
  } else {
    [barW, gap] = [6, 2];
  }
  const step = barW + gap;

  const padLeft = 46;
  const padRight = 8;
  const padTop = 30; // pas na tooltip + etykietę maksimum
  const plotH = 128;
  const padBottom = 20;
  const width = padLeft + n * step - gap + padRight;
  const height = padTop + plotH + padBottom;
  const baseline = padTop + plotH;

  const topCents = niceCeil(maxCents);
  const ticks = [0, topCents / 2, topCents];
  const yOf = (cents: number) => baseline - (cents / topCents) * plotH;

  // Etykiety osi X co k-ty dzień — bez tłoku przy 90 dniach.
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  const maxIndex = points.findIndex((p) => p.valueCents === maxCents);

  // Tooltip: mono ~6.2px/znak przy 10px — szerokość liczona z długości tekstu.
  const tooltipFor = (label: string, x: number) => {
    const w = label.length * 6.2 + 14;
    const rectX = Math.min(Math.max(x - w / 2, 2), width - w - 2);
    return { w, rectX };
  };

  return (
    // dir="rtl": przewijany wykres otwiera się na prawej krawędzi —
    // najnowsze dni widoczne od razu, starsze po przescrollowaniu w lewo.
    <div className="overflow-x-auto" dir="rtl">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="group/chart mx-auto w-full overflow-visible"
        style={{
          direction: "ltr",
          minWidth: width,
          maxWidth: n <= 10 ? 560 : undefined,
        }}
        role="img"
        aria-label="Wykres przychodu dziennego"
      >
        {/* siatka + oś Y */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={yOf(tick)}
              y2={yOf(tick)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={padLeft - 8}
              y={yOf(tick) + 3}
              textAnchor="end"
              className="fill-muted-foreground font-mono text-[9px]"
            >
              {axisLabel(tick)}
            </text>
          </g>
        ))}

        {/* słupki + etykiety X + tooltipy */}
        {points.map((point, i) => {
          const x = padLeft + i * step;
          const h =
            point.valueCents > 0 ? (point.valueCents / topCents) * plotH : 0;
          const center = x + barW / 2;
          const label = `${point.fullLabel} · ${formatPrice(point.valueCents, currency)}`;
          const tip = tooltipFor(label, center);
          return (
            <g key={point.key} className="group/bar">
              {h > 0 ? (
                <path
                  d={barPath(x, baseline - h, barW, h)}
                  className="fill-primary transition-opacity group-hover/bar:opacity-75"
                />
              ) : null}
              {i % labelEvery === 0 ? (
                <text
                  x={center}
                  y={height - 6}
                  textAnchor="middle"
                  className="fill-muted-foreground font-mono text-[9px]"
                >
                  {point.shortLabel}
                </text>
              ) : null}
              {/* cel trafienia na całą kolumnę + tooltip nad wykresem */}
              <rect
                x={x - gap / 2}
                y={padTop - 24}
                width={step}
                height={plotH + 24}
                fill="transparent"
                pointerEvents="all"
              >
                <title>{label}</title>
              </rect>
              <g className="pointer-events-none opacity-0 transition-opacity group-hover/bar:opacity-100">
                <rect
                  x={tip.rectX}
                  y={2}
                  width={tip.w}
                  height={18}
                  rx={6}
                  className="fill-popover stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={tip.rectX + tip.w / 2}
                  y={14.5}
                  textAnchor="middle"
                  className="fill-foreground font-mono text-[10px]"
                >
                  {label}
                </text>
                <line
                  x1={center}
                  x2={center}
                  y1={22}
                  y2={baseline - h - 2}
                  className="stroke-border"
                  strokeWidth={1}
                />
              </g>
            </g>
          );
        })}

        {/* etykieta bezpośrednia — tylko maksimum; znika, gdy działa tooltip */}
        {maxIndex >= 0 ? (
          <text
            x={Math.min(
              Math.max(padLeft + maxIndex * step + barW / 2, padLeft + 16),
              width - padRight - 24,
            )}
            y={yOf(maxCents) - 5}
            textAnchor="middle"
            className="fill-foreground font-mono text-[9.5px] font-medium transition-opacity group-hover/chart:opacity-0"
          >
            {formatPrice(maxCents, currency)}
          </text>
        ) : null}
      </svg>
    </div>
  );
}
