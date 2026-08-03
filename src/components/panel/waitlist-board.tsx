"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatMinutes } from "@/components/panel/format";
import {
  WaitlistConvertDialog,
  type ConvertTableOption,
  type TableOccupancy,
} from "@/components/panel/waitlist-convert-dialog";
import type { TurnTimeRuleView } from "@/components/panel/host-walkin-dialog";
import { cn } from "@/lib/utils";
import {
  cancelWaitlistEntryAction,
  notifyWaitlistEntryAction,
} from "@/app/panel/(dashboard)/dzis/actions";

/**
 * Lista oczekujących na dziś: wpisy WAITING/NOTIFIED z akcjami hosta.
 * Wpis z minionym `holdUntil` pokazujemy jako przeterminowany (EXPIRED) —
 * minął termin odpowiedzi gościa, choć w bazie wpis wciąż czeka na decyzję.
 *
 * `holdUntil` NIE blokuje stolika (nie czyta go ani `getTableOccupancy`,
 * ani silnik dostępności) — dlatego etykieta mówi o odpowiedzi gościa,
 * a nie o rezerwacji stolika.
 */

export type WaitlistView = "waiting" | "notified" | "expired";

export type WaitlistEntryView = {
  id: string;
  guestName: string;
  partySize: number;
  /** Żądana godzina w minutach od północy czasu lokalu. */
  requestedMin: number;
  flexMin: number;
  phone: string | null;
  email: string | null;
  note: string | null;
  view: WaitlistView;
  holdUntilLabel: string | null;
};

const VIEW_LABELS: Record<WaitlistView, string> = {
  waiting: "czeka",
  notified: "powiadomiony",
  expired: "przeterminowany",
};

const VIEW_CLASSES: Record<WaitlistView, string> = {
  waiting: "border-border-strong bg-card text-foreground",
  notified:
    "border-success-soft-border bg-success-soft text-primary dark:border-border dark:text-foreground",
  expired: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function WaitlistBoard({
  businessId,
  entries,
  tables,
  occupancy,
  turnTimeRules,
  defaultTurnTimeMin,
  tableBufferMin,
  openMin,
  closeMin,
  canManage,
}: {
  businessId: string;
  entries: WaitlistEntryView[];
  tables: ConvertTableOption[];
  occupancy: TableOccupancy[];
  turnTimeRules: TurnTimeRuleView[];
  defaultTurnTimeMin: number;
  tableBufferMin: number;
  openMin: number;
  closeMin: number;
  canManage: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="font-display text-[17px] font-extrabold tracking-tight">
          Lista oczekujących
        </h2>
        <span className="meta-label">{entries.length} na dziś</span>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-8 text-center text-[13px] text-muted-foreground">
          Nikt nie czeka na stolik.
        </div>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {entries.map((entry) => (
            <WaitlistCard
              key={entry.id}
              businessId={businessId}
              entry={entry}
              tables={tables}
              occupancy={occupancy}
              turnTimeRules={turnTimeRules}
              defaultTurnTimeMin={defaultTurnTimeMin}
              tableBufferMin={tableBufferMin}
              openMin={openMin}
              closeMin={closeMin}
              canManage={canManage}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function WaitlistCard({
  businessId,
  entry,
  tables,
  occupancy,
  turnTimeRules,
  defaultTurnTimeMin,
  tableBufferMin,
  openMin,
  closeMin,
  canManage,
}: {
  businessId: string;
  entry: WaitlistEntryView;
  tables: ConvertTableOption[];
  occupancy: TableOccupancy[];
  turnTimeRules: TurnTimeRuleView[];
  defaultTurnTimeMin: number;
  tableBufferMin: number;
  openMin: number;
  closeMin: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [convertOpen, setConvertOpen] = useState(false);

  const run = (
    action: (input: unknown) => Promise<
      { ok: true; message?: string } | { ok: false; error: string }
    >,
  ) => {
    startTransition(async () => {
      const result = await action({ businessId, entryId: entry.id });
      if (result.ok) {
        toast.success(result.message ?? "Zapisano");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    // min-w-0: bez tego długi e-mail w jednej linii rozpycha kolumnę siatki
    // (grid item ma domyślnie min-width:auto) i strona scrolluje poziomo.
    <li className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border bg-card px-3 py-3">
      <div className="flex items-start gap-3">
        <div className="shrink-0 font-mono text-[15px] leading-none font-medium">
          {formatMinutes(entry.requestedMin)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[14.5px] font-semibold">
              {entry.guestName}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.04em] uppercase",
                VIEW_CLASSES[entry.view],
              )}
            >
              {VIEW_LABELS[entry.view]}
            </span>
          </div>
          <div className="mt-1 font-mono text-[11.5px] text-muted-foreground">
            {entry.partySize} os. · elastyczność ±{entry.flexMin} min
            {entry.holdUntilLabel
              ? ` · ${entry.view === "expired" ? "brak odpowiedzi do" : "czeka na odpowiedź do"} ${entry.holdUntilLabel}`
              : ""}
          </div>
          {entry.phone || entry.email ? (
            <div className="mt-0.5 truncate font-mono text-[11.5px] text-muted-foreground">
              {[entry.phone, entry.email].filter(Boolean).join(" · ")}
            </div>
          ) : null}
          {entry.note ? (
            <p className="mt-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-[12px] leading-snug text-foreground/80">
              „{entry.note}”
            </p>
          ) : null}
        </div>
      </div>

      {canManage ? (
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="rounded-full px-3.5 font-semibold max-lg:h-11"
            disabled={isPending}
            onClick={() => run(notifyWaitlistEntryAction)}
          >
            {entry.view === "waiting" ? "Powiadom" : "Powiadom ponownie"}
          </Button>
          <Button
            size="sm"
            className="rounded-full px-3.5 font-semibold max-lg:h-11"
            disabled={isPending || tables.length === 0}
            onClick={() => setConvertOpen(true)}
          >
            Zamień na rezerwację
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full px-3.5 text-destructive max-lg:h-11"
            disabled={isPending}
            onClick={() => run(cancelWaitlistEntryAction)}
          >
            Usuń
          </Button>
        </div>
      ) : null}

      <WaitlistConvertDialog
        businessId={businessId}
        open={convertOpen}
        onOpenChange={setConvertOpen}
        entry={{
          id: entry.id,
          guestName: entry.guestName,
          partySize: entry.partySize,
          requestedMin: entry.requestedMin,
          flexMin: entry.flexMin,
          note: entry.note,
        }}
        tables={tables}
        occupancy={occupancy}
        turnTimeRules={turnTimeRules}
        defaultTurnTimeMin={defaultTurnTimeMin}
        tableBufferMin={tableBufferMin}
        openMin={openMin}
        closeMin={closeMin}
      />
    </li>
  );
}
