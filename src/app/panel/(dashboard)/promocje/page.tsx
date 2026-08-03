import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPanelBusiness } from "@/app/panel/data";
import { utcToZonedWallClock } from "@/lib/time";
import {
  effectivePackageStatus,
  expireCustomerPackages,
} from "@/lib/packages";
import { cn } from "@/lib/utils";
import {
  DiscountCodesView,
  type PanelDiscountCode,
} from "@/components/panel/discount-codes-view";
import {
  PackagesView,
  type PanelServicePackage,
  type PanelSoldPackage,
} from "@/components/panel/package-list-view";

export const metadata: Metadata = {
  title: "Promocje — panel firmy",
};

/** Kody i karnety zależą od „teraz" (ważność, wygasanie) — bez cache. */
export const dynamic = "force-dynamic";

type TabKey = "kody" | "karnety";

const TABS: { key: TabKey; label: string }[] = [
  { key: "kody", label: "Kody rabatowe" },
  { key: "karnety", label: "Karnety" },
];

/** Instant UTC → "2026-08-31" w strefie lokalu (wartość dla <input type="date">). */
function toDayInput(date: Date, timezone: string): string {
  const wall = utcToZonedWallClock(date, timezone);
  return `${wall.year}-${String(wall.month).padStart(2, "0")}-${String(wall.day).padStart(2, "0")}`;
}

const dayFormatter = (timezone: string) =>
  new Intl.DateTimeFormat("pl-PL", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

/**
 * Promocje firmy: kody rabatowe i karnety.
 *
 * Zakładka siedzi w adresie (`?zakladka=`), nie w stanie klienta — dzięki
 * temu wejście z linku, odświeżenie i przycisk „wstecz" trafiają tam, gdzie
 * użytkownik był.
 */
export default async function PromocjePage({
  searchParams,
}: {
  searchParams: Promise<{ zakladka?: string }>;
}) {
  const [panel, params] = await Promise.all([
    getPanelBusiness(),
    searchParams,
  ]);
  if (!panel) redirect("/panel/nowa");

  const { business, location, isManager } = panel;
  const timezone = location?.timezone ?? "Europe/Warsaw";
  const currency = business.currency;
  const activeTab: TabKey = params.zakladka === "karnety" ? "karnety" : "kody";
  const now = new Date();

  // Statusy karnetów starzeją się samym upływem czasu — domykamy je przy
  // wejściu na listę, żeby panel i konto klienta pokazywały to samo.
  await expireCustomerPackages(prisma, { businessId: business.id }, now);

  const [codes, packages, sold, customers, services] = await Promise.all([
    prisma.discountCode.findMany({
      where: { businessId: business.id },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        code: true,
        description: true,
        type: true,
        value: true,
        minAmountCents: true,
        maxUses: true,
        maxUsesPerCustomer: true,
        usedCount: true,
        validFrom: true,
        validTo: true,
        isActive: true,
        _count: { select: { redemptions: true } },
      },
    }),
    prisma.servicePackage.findMany({
      where: { businessId: business.id },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        description: true,
        serviceId: true,
        entries: true,
        priceCents: true,
        validityDays: true,
        isActive: true,
        service: { select: { name: true } },
        _count: { select: { sold: true } },
      },
    }),
    prisma.customerPackage.findMany({
      where: { businessId: business.id },
      orderBy: [{ status: "asc" }, { purchasedAt: "desc" }],
      take: 200,
      select: {
        id: true,
        status: true,
        entriesTotal: true,
        entriesUsed: true,
        purchasedAt: true,
        expiresAt: true,
        customer: { select: { id: true, fullName: true } },
        package: { select: { name: true } },
      },
    }),
    prisma.customer.findMany({
      where: { businessId: business.id },
      orderBy: { fullName: "asc" },
      take: 500,
      select: { id: true, fullName: true, phone: true, email: true },
    }),
    prisma.service.findMany({
      where: { businessId: business.id, kind: "STANDARD" },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  const formatDay = dayFormatter(timezone);

  const codeRows: PanelDiscountCode[] = codes.map((code) => {
    // validTo trzymamy jako północ dnia NASTĘPNEGO po ostatnim dniu ważności
    // (granica otwarta) — użytkownikowi pokazujemy ostatni dzień działania.
    const lastValidDay = code.validTo
      ? new Date(code.validTo.getTime() - 1)
      : null;
    const usedCount = Math.max(code.usedCount, code._count.redemptions);
    const expired = code.validTo !== null && code.validTo.getTime() <= now.getTime();
    const scheduled =
      code.validFrom !== null && code.validFrom.getTime() > now.getTime();
    const exhausted = code.maxUses !== null && usedCount >= code.maxUses;

    return {
      id: code.id,
      code: code.code,
      description: code.description,
      type: code.type,
      value: code.value,
      minAmountCents: code.minAmountCents,
      maxUses: code.maxUses,
      maxUsesPerCustomer: code.maxUsesPerCustomer,
      usedCount,
      isActive: code.isActive,
      hasRedemptions: code._count.redemptions > 0 || code.usedCount > 0,
      validFromInput: code.validFrom ? toDayInput(code.validFrom, timezone) : "",
      validToInput: lastValidDay ? toDayInput(lastValidDay, timezone) : "",
      validityLabel:
        code.validFrom || lastValidDay
          ? [
              code.validFrom ? `od ${formatDay.format(code.validFrom)}` : null,
              lastValidDay ? `do ${formatDay.format(lastValidDay)}` : null,
            ]
              .filter(Boolean)
              .join(" ")
          : "bezterminowo",
      // Ta sama kolejność co w calculateDiscount: kod archiwalny (wyłączony
      // i przeterminowany naraz) opisujemy wygaśnięciem, nie przełącznikiem.
      state: expired
        ? "expired"
        : !code.isActive
          ? "inactive"
          : exhausted
            ? "exhausted"
            : scheduled
              ? "scheduled"
              : "active",
    };
  });

  const packageRows: PanelServicePackage[] = packages.map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    serviceId: pkg.serviceId,
    serviceName: pkg.service?.name ?? null,
    entries: pkg.entries,
    priceCents: pkg.priceCents,
    validityDays: pkg.validityDays,
    isActive: pkg.isActive,
    soldCount: pkg._count.sold,
  }));

  const soldRows: PanelSoldPackage[] = sold.map((entry) => ({
    id: entry.id,
    customerId: entry.customer.id,
    customerName: entry.customer.fullName,
    packageName: entry.package.name,
    entriesTotal: entry.entriesTotal,
    entriesUsed: entry.entriesUsed,
    status: effectivePackageStatus(entry, now),
    purchasedLabel: formatDay.format(entry.purchasedAt),
    expiresLabel: formatDay.format(entry.expiresAt),
  }));

  return (
    <div className="px-4 py-6 sm:px-6">
      <div className="mb-4">
        <div className="meta-label">Promocje</div>
        <h1 className="mt-1 font-display text-[22px] leading-tight font-extrabold tracking-tight sm:text-[27px]">
          Kody rabatowe i karnety
        </h1>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          Rabat schodzi z ceny przy rezerwacji online, karnet zapisujesz
          klientowi z panelu — wejście kasuje się przy wizycie.
        </p>
      </div>

      <nav
        aria-label="Sekcje promocji"
        className="mb-5 flex gap-5 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <Link
              key={tab.key}
              href={`/panel/promocje?zakladka=${tab.key}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 flex-none items-center border-b-[2.5px] pb-2 text-[13px] whitespace-nowrap transition-colors lg:min-h-0",
                active
                  ? "border-foreground font-bold text-foreground"
                  : "border-transparent font-medium text-[#8f8b81] hover:text-foreground",
              )}
            >
              {tab.label}
              <span className="ml-1.5 font-mono text-[11px] font-normal text-muted-foreground">
                {tab.key === "kody" ? codeRows.length : packageRows.length}
              </span>
            </Link>
          );
        })}
      </nav>

      {activeTab === "kody" ? (
        <DiscountCodesView
          businessId={business.id}
          currency={currency}
          codes={codeRows}
          isManager={isManager}
        />
      ) : (
        <PackagesView
          businessId={business.id}
          currency={currency}
          packages={packageRows}
          sold={soldRows}
          services={services}
          customers={customers}
          isManager={isManager}
        />
      )}
    </div>
  );
}
