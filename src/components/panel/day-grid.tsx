import type { BookingStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { formatMinutes, initials } from "@/components/panel/format";

/**
 * Siatka dnia kalendarza — kolumna per pracownik, oś godzin co 60 minut.
 * Czysto prezentacyjny komponent serwerowy; wszystkie czasy przychodzą
 * jako minuty czasu lokalnego lokalizacji.
 */

const PX_PER_MIN = 1.2; // 72 px na godzinę — jak w prototypie

export type DayGridItem = {
  id: string;
  startMin: number;
  endMin: number;
  blockedStartMin: number;
  blockedEndMin: number;
  serviceName: string;
  clientName: string;
  status: BookingStatus;
  priceLabel: string;
};

export type DayGridTimeOff = {
  id: string;
  startMin: number;
  endMin: number;
  label: string;
};

export type DayGridColumn = {
  resourceId: string;
  name: string;
  hoursLabel: string;
  workBlocks: { startMin: number; endMin: number }[];
  timeOff: DayGridTimeOff[];
  items: DayGridItem[];
};

/** Klasy bloków wizyt per status — współdzielone z widokiem tygodnia. */
export const STATUS_BLOCK_CLASSES: Record<string, string> = {
  CONFIRMED: "bg-primary text-primary-foreground",
  COMPLETED: "bg-primary/75 text-primary-foreground",
  PENDING:
    "border-[1.5px] border-dashed border-warning bg-warning-soft text-warning-strong",
  NO_SHOW: "border border-destructive/40 bg-destructive/10 text-destructive",
  CANCELLED_BY_CUSTOMER:
    "border border-border bg-muted/70 text-muted-foreground opacity-70",
  CANCELLED_BY_BUSINESS:
    "border border-border bg-muted/70 text-muted-foreground opacity-70",
};

/** Krótkie etykiety statusów wymagających uwagi — współdzielone z tygodniem. */
export const STATUS_TAGS: Partial<Record<BookingStatus, string>> = {
  PENDING: "OCZEKUJE",
  NO_SHOW: "NO-SHOW",
  CANCELLED_BY_CUSTOMER: "ODWOŁANA",
  CANCELLED_BY_BUSINESS: "ODWOŁANA",
};

export function DayGrid({
  columns,
  axisStartMin,
  axisEndMin,
  nowMin,
}: {
  columns: DayGridColumn[];
  axisStartMin: number;
  axisEndMin: number;
  nowMin: number | null;
}) {
  const axisHeight = (axisEndMin - axisStartMin) * PX_PER_MIN;
  const hourLabels: number[] = [];
  for (let minute = axisStartMin; minute < axisEndMin; minute += 60) {
    hourLabels.push(minute);
  }

  const clamp = (minute: number) =>
    Math.min(Math.max(minute, axisStartMin), axisEndMin);
  const top = (minute: number) => (clamp(minute) - axisStartMin) * PX_PER_MIN;
  const height = (startMin: number, endMin: number) =>
    Math.max((clamp(endMin) - clamp(startMin)) * PX_PER_MIN, 0);

  return (
    <div className="overflow-x-auto pb-6">
      <div className="flex min-w-fit pr-4 sm:pr-6">
        <div className="sticky left-0 z-10 w-[68px] shrink-0 bg-background pt-[52px] pl-4 sm:w-20 sm:pl-6">
          {hourLabels.map((minute) => (
            <div
              key={minute}
              className="h-[72px] font-mono text-[11px] text-muted-foreground"
            >
              {formatMinutes(minute)}
            </div>
          ))}
        </div>

        <div
          className="grid flex-1 gap-2.5"
          style={{
            gridTemplateColumns: `repeat(${columns.length}, minmax(220px, 1fr))`,
          }}
        >
          {columns.map((column) => {
            // Odcinki poza grafikiem pracownika — szare tło.
            const offBlocks: { startMin: number; endMin: number }[] = [];
            let cursor = axisStartMin;
            for (const block of [...column.workBlocks].sort(
              (a, b) => a.startMin - b.startMin,
            )) {
              if (clamp(block.startMin) > cursor) {
                offBlocks.push({ startMin: cursor, endMin: clamp(block.startMin) });
              }
              cursor = Math.max(cursor, clamp(block.endMin));
            }
            if (cursor < axisEndMin) {
              offBlocks.push({ startMin: cursor, endMin: axisEndMin });
            }

            return (
              <div key={column.resourceId}>
                <div className="flex h-[52px] items-center gap-2.5">
                  <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-muted font-display text-[11px] font-bold">
                    {initials(column.name)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-bold">
                      {column.name}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {column.hoursLabel}
                    </div>
                  </div>
                </div>

                <div
                  className="relative border-t border-border border-l border-l-muted"
                  style={{
                    height: axisHeight,
                    backgroundImage:
                      "linear-gradient(var(--border) 1px, transparent 1px)",
                    backgroundSize: "100% 72px",
                  }}
                >
                  {offBlocks.map((block, index) => (
                    <div
                      key={index}
                      className="absolute inset-x-0 bg-muted/60"
                      style={{
                        top: top(block.startMin),
                        height: height(block.startMin, block.endMin),
                      }}
                    />
                  ))}

                  {column.timeOff.map((timeOff) => (
                    <div
                      key={timeOff.id}
                      className="absolute inset-x-0.5 z-[2] overflow-hidden rounded-lg border border-warning/50 bg-warning-soft p-2 text-warning-strong"
                      style={{
                        top: top(timeOff.startMin),
                        height: height(timeOff.startMin, timeOff.endMin),
                      }}
                    >
                      <div className="font-mono text-[10px]">
                        {formatMinutes(clamp(timeOff.startMin))}–
                        {formatMinutes(clamp(timeOff.endMin))}
                      </div>
                      <div className="text-xs font-bold">{timeOff.label}</div>
                    </div>
                  ))}

                  {column.items.map((item) => {
                    const blockHeight = height(item.startMin, item.endMin);
                    const compact = blockHeight < 44;
                    const tag = STATUS_TAGS[item.status];
                    return (
                      <div key={item.id}>
                        {item.blockedStartMin < item.startMin && (
                          <div
                            className="photo-placeholder absolute inset-x-0.5 z-[2] rounded"
                            style={{
                              top: top(item.blockedStartMin),
                              height: height(item.blockedStartMin, item.startMin),
                            }}
                          />
                        )}
                        <div
                          className={cn(
                            "absolute inset-x-0.5 z-[3] overflow-hidden rounded-lg px-2 py-1.5",
                            STATUS_BLOCK_CLASSES[item.status] ??
                              STATUS_BLOCK_CLASSES.CONFIRMED,
                          )}
                          style={{
                            top: top(item.startMin),
                            height: blockHeight,
                          }}
                          title={`${item.clientName} · ${item.serviceName}`}
                        >
                          <div className="font-mono text-[10px] opacity-80">
                            {formatMinutes(item.startMin)}–
                            {formatMinutes(item.endMin)}
                            {tag ? ` · ${tag}` : ""}
                          </div>
                          <div className="truncate text-xs font-semibold">
                            {compact
                              ? `${item.clientName} · ${item.serviceName}`
                              : item.clientName}
                          </div>
                          {!compact && (
                            <div className="truncate text-[11px] opacity-80">
                              {item.serviceName}
                              {item.priceLabel ? ` · ${item.priceLabel}` : ""}
                            </div>
                          )}
                        </div>
                        {item.blockedEndMin > item.endMin && (
                          <div
                            className="photo-placeholder absolute inset-x-0.5 z-[2] rounded"
                            style={{
                              top: top(item.endMin),
                              height: height(item.endMin, item.blockedEndMin),
                            }}
                          />
                        )}
                      </div>
                    );
                  })}

                  {nowMin !== null &&
                    nowMin > axisStartMin &&
                    nowMin < axisEndMin && (
                      <div
                        className="absolute inset-x-0 z-[4] border-t-2 border-destructive"
                        style={{ top: top(nowMin) }}
                      >
                        <span className="absolute -top-[9px] left-0 rounded bg-destructive px-1 py-px font-mono text-[10px] font-medium text-destructive-foreground">
                          {formatMinutes(nowMin)}
                        </span>
                      </div>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
