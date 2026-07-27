import { redirect } from "next/navigation";
import { getPanelBusiness } from "@/app/panel/data";
import {
  BUSINESS_TYPE_LABELS,
  WEEKDAY_LABELS,
  formatMinutes,
} from "@/components/panel/format";

/**
 * Ustawienia — podgląd konfiguracji firmy (read-only w fazie 1).
 * Edycja danych firmy i lokalizacji przyjdzie z kolejną fazą.
 */
export default async function SettingsPage() {
  const panel = await getPanelBusiness();
  if (!panel) redirect("/panel/nowa");

  const { business, location } = panel;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight sm:text-[27px]">
        Ustawienia
      </h1>
      <p className="mt-0.5 mb-6 text-[12.5px] text-muted-foreground">
        Podgląd konfiguracji — edycja danych firmy pojawi się w kolejnej fazie.
      </p>

      <div className="flex flex-col gap-4">
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="meta-label mb-3">Firma</div>
          <dl className="grid grid-cols-1 gap-y-1 text-[13px] md:grid-cols-[140px_1fr] md:gap-y-2 [&>dd]:mb-2 [&>dd:last-child]:mb-0 md:[&>dd]:mb-0">
            <dt className="text-muted-foreground">Nazwa</dt>
            <dd className="font-semibold">{business.name}</dd>
            <dt className="text-muted-foreground">Typ</dt>
            <dd>{BUSINESS_TYPE_LABELS[business.type]}</dd>
            <dt className="text-muted-foreground">Publiczny link</dt>
            <dd className="font-mono text-xs">/b/{business.slug}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="font-mono text-xs">{business.status}</dd>
          </dl>
        </section>

        {location && (
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="meta-label mb-3">Lokalizacja</div>
            <dl className="grid grid-cols-1 gap-y-1 text-[13px] md:grid-cols-[140px_1fr] md:gap-y-2 [&>dd]:mb-2 [&>dd:last-child]:mb-0 md:[&>dd]:mb-0">
              <dt className="text-muted-foreground">Adres</dt>
              <dd>
                {location.addressLine1}, {location.postalCode} {location.city}
              </dd>
              <dt className="text-muted-foreground">Strefa czasowa</dt>
              <dd className="font-mono text-xs">{location.timezone}</dd>
              <dt className="text-muted-foreground">Siatka slotów</dt>
              <dd className="font-mono text-xs">
                co {location.slotGranularityMin} min
              </dd>
            </dl>

            <div className="meta-label mt-5 mb-3">Godziny otwarcia</div>
            <div className="flex flex-col gap-1.5">
              {WEEKDAY_LABELS.map((label, weekday) => {
                const blocks = location.openingHours
                  .filter((block) => block.weekday === weekday)
                  .sort((a, b) => a.startMinute - b.startMinute);
                return (
                  <div
                    key={label}
                    className="flex items-baseline justify-between border-b border-muted pb-1.5 text-[13px] last:border-b-0"
                  >
                    <span className="font-semibold">{label}</span>
                    {blocks.length === 0 ? (
                      <span className="text-muted-foreground">zamknięte</span>
                    ) : (
                      <span className="font-mono text-xs">
                        {blocks
                          .map(
                            (block) =>
                              `${formatMinutes(block.startMinute)}–${formatMinutes(block.endMinute)}`,
                          )
                          .join(" · ")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
