import { cn } from "@/lib/utils";
import {
  adminDateTimeFormatter,
  auditActionLabel,
  auditActionTone,
  auditDetails,
} from "@/components/admin/format";
import { StatusPill } from "@/components/admin/ui";

export type AdminAuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  createdAt: Date;
  actorLabel: string;
};

/**
 * Historia AuditLog w panelu admina — ten sam układ, co dziennik firmy,
 * ale bez filtrów: to jest wycinek dotyczący jednego obiektu.
 * Czas w strefie platformy (albo podanej, gdy patrzymy na jedną lokalizację).
 */
export function AuditList({
  entries,
  timeZone,
}: {
  entries: AdminAuditEntry[];
  timeZone?: string;
}) {
  const formatter = adminDateTimeFormatter(timeZone);

  if (entries.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-[13px] text-muted-foreground sm:px-5">
        Brak wpisów w dzienniku.
      </p>
    );
  }

  return (
    <ul>
      {entries.map((entry) => {
        const details = auditDetails(entry.metadata);
        return (
          <li
            key={entry.id}
            className="border-t border-border px-4 py-3 first:border-t-0 sm:px-5"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <StatusPill tone={cn(auditActionTone(entry.action))}>
                {auditActionLabel(entry.action)}
              </StatusPill>
              <span className="font-mono text-[11px] text-muted-foreground">
                {entry.entityType} #{entry.entityId.slice(-6)}
              </span>
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                {formatter.format(entry.createdAt)}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[13px] font-semibold">{entry.actorLabel}</span>
              {details.map((detail) => (
                <span
                  key={detail}
                  className="font-mono text-[11px] break-all text-muted-foreground"
                >
                  {detail}
                </span>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
