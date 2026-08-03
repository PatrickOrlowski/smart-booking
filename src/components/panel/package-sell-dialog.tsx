"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PanelDialogBody,
  PanelDialogContent,
} from "@/components/panel/panel-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/components/panel/format";
import { runAction } from "@/components/panel/run-action";
import { sellPackageAction } from "@/app/panel/(dashboard)/promocje/actions";

export type SellablePackage = {
  id: string;
  name: string;
  entries: number;
  priceCents: number;
  validityDays: number;
  serviceName: string | null;
};

export type PackageCustomer = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
};

/** Cyfry numeru — wyszukiwanie po telefonie ignoruje spacje i myślniki. */
const digits = (value: string) => value.replace(/\D/g, "");

/**
 * Dialog „Sprzedaj karnet": wybór karnetu i klienta → CustomerPackage
 * z datą ważności liczoną od dziś. Lista klientów bywa długa, więc ma
 * własne pole filtrowania (nazwa, telefon, e-mail).
 */
export function PackageSellDialog({
  businessId,
  currency,
  packages,
  customers,
  open,
  onOpenChange,
}: {
  businessId: string;
  currency: string;
  packages: SellablePackage[];
  customers: PackageCustomer[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [packageId, setPackageId] = useState(packages[0]?.id ?? "");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const selected = packages.find((entry) => entry.id === packageId) ?? null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return customers.slice(0, 30);
    const needleDigits = digits(needle);
    return customers
      .filter((customer) => {
        if (customer.fullName.toLowerCase().includes(needle)) return true;
        if (customer.email?.toLowerCase().includes(needle)) return true;
        if (
          needleDigits.length >= 3 &&
          customer.phone &&
          digits(customer.phone).includes(needleDigits)
        ) {
          return true;
        }
        return false;
      })
      .slice(0, 30);
  }, [customers, query]);

  const submit = () => {
    if (!packageId || !customerId) return;
    startTransition(async () => {
      const result = await runAction(() =>
        sellPackageAction({ businessId, packageId, customerId }),
      );
      if (result.ok) {
        toast.success("Karnet zapisany na koncie klienta");
        setCustomerId(null);
        setQuery("");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <PanelDialogContent className="sm:max-h-[90vh] sm:max-w-md sm:overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sprzedaj karnet</DialogTitle>
          <DialogDescription>
            Karnet trafia na konto klienta od razu — wejścia kasują się przy
            wizytach dodawanych z panelu.
          </DialogDescription>
        </DialogHeader>

        <PanelDialogBody>
          {packages.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-card px-3.5 py-3 text-[12.5px] text-muted-foreground">
              Brak karnetów w sprzedaży. Dodaj karnet w sekcji „Oferta
              karnetów”.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>Karnet</Label>
                <Select value={packageId} onValueChange={setPackageId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Wybierz karnet" />
                  </SelectTrigger>
                  <SelectContent>
                    {packages.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selected && (
                <div className="rounded-xl border border-dashed border-border bg-card px-3.5 py-2.5 text-[12px] text-foreground/80">
                  <span className="font-mono">{selected.entries} wejść</span> ·{" "}
                  <span className="font-mono">
                    {formatPrice(selected.priceCents, currency)}
                  </span>{" "}
                  · ważny{" "}
                  <b className="font-mono">{selected.validityDays} dni</b> od
                  dnia sprzedaży
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {selected.serviceName
                      ? `Obejmuje: ${selected.serviceName}`
                      : "Obejmuje dowolną usługę firmy"}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="package-customer-search">Klient</Label>
                <Input
                  id="package-customer-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Szukaj po nazwisku, telefonie lub e-mailu"
                  autoComplete="off"
                />
                <div className="max-h-56 overflow-y-auto rounded-xl border border-border bg-card">
                  {filtered.length === 0 ? (
                    <p className="px-3 py-3 text-xs text-muted-foreground">
                      Brak klientów pasujących do zapytania.
                    </p>
                  ) : (
                    filtered.map((customer) => {
                      const active = customer.id === customerId;
                      return (
                        <button
                          key={customer.id}
                          type="button"
                          onClick={() => setCustomerId(customer.id)}
                          className={cn(
                            "flex min-h-11 w-full flex-col items-start justify-center border-b border-muted px-3 py-2 text-left transition-colors last:border-b-0",
                            active
                              ? "bg-accent text-primary dark:bg-muted dark:text-foreground"
                              : "hover:bg-muted/60",
                          )}
                        >
                          <span className="text-[13px] font-semibold">
                            {customer.fullName}
                          </span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {customer.phone ?? customer.email ?? "bez kontaktu"}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}
        </PanelDialogBody>

        <DialogFooter>
          <Button
            variant="outline"
            className="rounded-full max-lg:h-11"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Anuluj
          </Button>
          <Button
            className="rounded-full font-semibold max-lg:h-11"
            onClick={submit}
            disabled={isPending || !packageId || !customerId}
          >
            {isPending ? "Zapisywanie…" : "Sprzedaj karnet"}
          </Button>
        </DialogFooter>
      </PanelDialogContent>
    </Dialog>
  );
}
