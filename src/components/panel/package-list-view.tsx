"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EllipsisVerticalIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/components/panel/format";
import { runAction } from "@/components/panel/run-action";
import {
  PACKAGE_STATUS_CLASSES,
  PACKAGE_STATUS_LABELS,
} from "@/lib/packages";
import type { PackageStatus } from "@/generated/prisma/enums";
import {
  PackageFormDialog,
  emptyPackageEditor,
  type PackageEditorState,
} from "@/components/panel/package-form-dialog";
import {
  PackageSellDialog,
  type PackageCustomer,
} from "@/components/panel/package-sell-dialog";
import {
  cancelCustomerPackageAction,
  togglePackageAction,
} from "@/app/panel/(dashboard)/promocje/actions";

export type PanelServicePackage = {
  id: string;
  name: string;
  description: string | null;
  serviceId: string | null;
  serviceName: string | null;
  entries: number;
  priceCents: number;
  validityDays: number;
  isActive: boolean;
  soldCount: number;
};

export type PanelSoldPackage = {
  id: string;
  customerId: string;
  customerName: string;
  packageName: string;
  entriesTotal: number;
  entriesUsed: number;
  status: PackageStatus;
  purchasedLabel: string;
  expiresLabel: string;
};

const OFFER_GRID =
  "grid grid-cols-[minmax(0,1.8fr)_minmax(0,1.1fr)_minmax(0,0.6fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_auto_auto] items-center gap-x-4 gap-y-2";
const SOLD_GRID =
  "grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_auto_auto] items-center gap-x-4 gap-y-2";

function StatusBadge({ status }: { status: PackageStatus }) {
  return (
    <span
      className={cn(
        // `w-fit` — bez tego span rozciąga tło pigułki na całą kolumnę siatki.
        "inline-flex w-fit flex-none items-center justify-self-start rounded-md px-2 py-1 font-mono text-[10px] tracking-wide uppercase",
        PACKAGE_STATUS_CLASSES[status],
      )}
    >
      {PACKAGE_STATUS_LABELS[status]}
    </span>
  );
}

const editorFor = (pkg: PanelServicePackage): PackageEditorState => ({
  packageId: pkg.id,
  name: pkg.name,
  description: pkg.description ?? "",
  serviceChoice: pkg.serviceId ?? "any",
  entries: String(pkg.entries),
  priceZl:
    pkg.priceCents % 100 === 0
      ? String(pkg.priceCents / 100)
      : (pkg.priceCents / 100).toFixed(2),
  validityDays: String(pkg.validityDays),
  isActive: pkg.isActive,
  soldCount: pkg.soldCount,
});

/**
 * Zakładka „Karnety": oferta firmy (CRUD) + lista sprzedanych egzemplarzy
 * z wykorzystaniem i ważnością. Desktop = wiersze tabeli, telefon = karty.
 */
export function PackagesView({
  businessId,
  currency,
  packages,
  sold,
  services,
  customers,
  isManager,
}: {
  businessId: string;
  currency: string;
  packages: PanelServicePackage[];
  sold: PanelSoldPackage[];
  services: { id: string; name: string }[];
  customers: PackageCustomer[];
  isManager: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editor, setEditor] = useState<PackageEditorState | null>(null);
  const [sellOpen, setSellOpen] = useState(false);

  const sellable = packages
    .filter((pkg) => pkg.isActive)
    .map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      entries: pkg.entries,
      priceCents: pkg.priceCents,
      validityDays: pkg.validityDays,
      serviceName: pkg.serviceName,
    }));

  const toggleActive = (pkg: PanelServicePackage, isActive: boolean) => {
    startTransition(async () => {
      const result = await runAction(() =>
        togglePackageAction({ businessId, packageId: pkg.id, isActive }),
      );
      if (result.ok) {
        toast.success(isActive ? "Karnet w sprzedaży" : "Karnet wycofany");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const cancelSold = (entry: PanelSoldPackage) => {
    startTransition(async () => {
      const result = await runAction(() =>
        cancelCustomerPackageAction({
          businessId,
          customerPackageId: entry.id,
        }),
      );
      if (result.ok) {
        toast.success("Karnet klienta anulowany");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-8">
      {/* --- Oferta karnetów --- */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-[17px] font-bold tracking-tight">
              Oferta karnetów
            </h2>
            <p className="text-[12px] text-muted-foreground">
              Pula wejść i ważność liczona od dnia sprzedaży.
            </p>
          </div>
          {isManager && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="h-11 rounded-full border-[1.5px] border-border-strong px-4 font-semibold lg:h-8"
                onClick={() => setSellOpen(true)}
                disabled={sellable.length === 0}
              >
                Sprzedaj karnet
              </Button>
              <Button
                className="h-11 rounded-full px-5 font-semibold lg:h-8 lg:px-4"
                onClick={() => setEditor(emptyPackageEditor())}
              >
                + Nowy karnet
              </Button>
            </div>
          )}
        </div>

        {packages.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-14 text-center">
            <h3 className="font-display text-xl font-extrabold tracking-tight">
              Brak karnetów w ofercie
            </h3>
            <p className="max-w-sm text-[13px] text-muted-foreground">
              Karnet to pula wejść na wybraną usługę — sprzedajesz go
              klientowi, a wizyty schodzą z puli zamiast z portfela.
            </p>
            {isManager && (
              <Button
                className="rounded-full px-5 font-semibold max-lg:h-11"
                onClick={() => setEditor(emptyPackageEditor())}
              >
                + Nowy karnet
              </Button>
            )}
          </div>
        ) : (
          <>
            <div
              className={cn(
                OFFER_GRID,
                "hidden border-b border-border px-3 pb-2 font-mono text-[10px] tracking-[0.08em] text-muted-foreground lg:grid",
              )}
            >
              <span>KARNET</span>
              <span>USŁUGA</span>
              <span>WEJŚCIA</span>
              <span>CENA</span>
              <span>WAŻNOŚĆ</span>
              <span>SPRZEDANE</span>
              <span>W SPRZEDAŻY</span>
              <span />
            </div>

            {packages.map((pkg) => (
              <Fragment key={pkg.id}>
                <div
                  className={cn(
                    OFFER_GRID,
                    "hidden border-b border-muted px-3 py-3 lg:grid",
                    !pkg.isActive && "opacity-55",
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-semibold">
                      {pkg.name}
                    </div>
                    {pkg.description && (
                      <div className="truncate text-[11.5px] text-muted-foreground">
                        {pkg.description}
                      </div>
                    )}
                  </div>
                  <span className="truncate text-[12.5px] text-muted-foreground">
                    {pkg.serviceName ?? "dowolna"}
                  </span>
                  <span className="font-mono text-[13px]">{pkg.entries}</span>
                  <span className="font-mono text-[13px]">
                    {formatPrice(pkg.priceCents, currency)}
                  </span>
                  <span className="font-mono text-[12.5px] text-muted-foreground">
                    {pkg.validityDays} dni
                  </span>
                  <span className="font-mono text-[13px] tabular-nums">
                    {pkg.soldCount}
                  </span>
                  <Switch
                    checked={pkg.isActive}
                    disabled={!isManager || isPending}
                    onCheckedChange={(checked) =>
                      toggleActive(pkg, checked === true)
                    }
                    aria-label={`Sprzedaż karnetu ${pkg.name}`}
                  />
                  {isManager ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="justify-self-end"
                      onClick={() => setEditor(editorFor(pkg))}
                    >
                      Edytuj
                    </Button>
                  ) : (
                    <span />
                  )}
                </div>

                <div
                  className={cn(
                    "flex flex-col gap-1.5 border-b border-muted px-1 py-3 lg:hidden",
                    !pkg.isActive && "opacity-55",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                      {pkg.name}
                    </span>
                    <span className="shrink-0 font-mono text-[13px]">
                      {formatPrice(pkg.priceCents, currency)}
                    </span>
                    {isManager && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="-my-2 -mr-1 size-11 shrink-0"
                            aria-label={`Akcje karnetu ${pkg.name}`}
                          >
                            <EllipsisVerticalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => setEditor(editorFor(pkg))}
                          >
                            Edytuj
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={isPending}
                            onClick={() => toggleActive(pkg, !pkg.isActive)}
                          >
                            {pkg.isActive
                              ? "Wycofaj ze sprzedaży"
                              : "Wróć do sprzedaży"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
                    <span className="font-mono">{pkg.entries} wejść</span>
                    <span className="font-mono">{pkg.validityDays} dni</span>
                    <span className="font-mono">
                      sprzedanych {pkg.soldCount}
                    </span>
                    <span>{pkg.serviceName ?? "dowolna usługa"}</span>
                    {!pkg.isActive && (
                      <span className="font-semibold text-warning-strong">
                        wycofany
                      </span>
                    )}
                  </div>
                </div>
              </Fragment>
            ))}
          </>
        )}
      </section>

      {/* --- Sprzedane egzemplarze --- */}
      <section>
        <div className="mb-3">
          <h2 className="font-display text-[17px] font-bold tracking-tight">
            Sprzedane karnety
          </h2>
          <p className="text-[12px] text-muted-foreground">
            Wykorzystanie rośnie przy wizytach opłaconych karnetem.
          </p>
        </div>

        {sold.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center text-[13px] text-muted-foreground">
            Nikt jeszcze nie ma karnetu tej firmy.
          </div>
        ) : (
          <>
            <div
              className={cn(
                SOLD_GRID,
                "hidden border-b border-border px-3 pb-2 font-mono text-[10px] tracking-[0.08em] text-muted-foreground lg:grid",
              )}
            >
              <span>KLIENT</span>
              <span>KARNET</span>
              <span>WYKORZYSTANIE</span>
              <span>WAŻNY DO</span>
              <span>STATUS</span>
              <span />
            </div>

            {sold.map((entry) => (
              <Fragment key={entry.id}>
                <div
                  className={cn(
                    SOLD_GRID,
                    "hidden border-b border-muted px-3 py-3 lg:grid",
                    entry.status !== "ACTIVE" && "opacity-60",
                  )}
                >
                  <span className="truncate text-[13.5px] font-semibold">
                    {entry.customerName}
                  </span>
                  <span className="truncate text-[12.5px] text-muted-foreground">
                    {entry.packageName}
                  </span>
                  <span className="font-mono text-[13px] tabular-nums">
                    {entry.entriesUsed} / {entry.entriesTotal}
                  </span>
                  <span className="font-mono text-[12.5px] text-muted-foreground">
                    {entry.expiresLabel}
                  </span>
                  <StatusBadge status={entry.status} />
                  {isManager && entry.status === "ACTIVE" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="justify-self-end"
                      disabled={isPending}
                      onClick={() => cancelSold(entry)}
                    >
                      Anuluj
                    </Button>
                  ) : (
                    <span />
                  )}
                </div>

                <div
                  className={cn(
                    "flex flex-col gap-1.5 border-b border-muted px-1 py-3 lg:hidden",
                    entry.status !== "ACTIVE" && "opacity-60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                      {entry.customerName}
                    </span>
                    <span className="shrink-0 font-mono text-[13px] tabular-nums">
                      {entry.entriesUsed} / {entry.entriesTotal}
                    </span>
                    {isManager && entry.status === "ACTIVE" && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="-my-2 -mr-1 size-11 shrink-0"
                            aria-label={`Akcje karnetu klienta ${entry.customerName}`}
                          >
                            <EllipsisVerticalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={isPending}
                            onClick={() => cancelSold(entry)}
                          >
                            Anuluj karnet
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-muted-foreground">
                    <StatusBadge status={entry.status} />
                    <span className="truncate">{entry.packageName}</span>
                    <span className="font-mono">do {entry.expiresLabel}</span>
                  </div>
                </div>
              </Fragment>
            ))}
          </>
        )}
      </section>

      <PackageFormDialog
        businessId={businessId}
        services={services}
        editor={editor}
        onChange={setEditor}
        onClose={() => setEditor(null)}
      />
      <PackageSellDialog
        businessId={businessId}
        currency={currency}
        packages={sellable}
        customers={customers}
        open={sellOpen}
        onOpenChange={setSellOpen}
      />
    </div>
  );
}
