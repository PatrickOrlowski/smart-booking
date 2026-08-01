import Link from "next/link";
import { cityDisplay } from "@/app/m/miasta";
import { RestaurantSlotPill } from "./restaurant-slot-pill";
import { TableSlotBadge } from "./table-slot-badge";

/**
 * Karta restauracji na listingach. Geometria i typografia są te same co
 * w `marketplace/business-card.tsx` — różni się treść ostatniego wiersza:
 * zamiast „od 70 zł" (restauracja nie ma cennika usług) pokazujemy najbliższy
 * wolny stolik: „Stolik dziś od 18:00".
 *
 * Etykieta ma dwie drogi: `slotLabel` policzone na serwerze (listing
 * dynamiczny) albo — gdy props nie podano — doliczenie w przeglądarce
 * (listingi ISR, gdzie „dziś" z czasu builda byłoby kłamstwem).
 */

export type RestaurantCardData = {
  id: string;
  slug: string;
  name: string;
  locations: { addressLine1: string; city: string; timezone: string }[];
  rating: { score: string; count: number };
};

export function RestaurantCard({
  business,
  promoted = false,
  slotLabel,
}: {
  business: RestaurantCardData;
  promoted?: boolean;
  /** Pominięcie propsa włącza doliczenie po stronie klienta. */
  slotLabel?: string | null;
}) {
  const location = business.locations[0];
  const address = location
    ? `${location.addressLine1}, ${cityDisplay(location.city)}`
    : "";
  const timezone = location?.timezone ?? "Europe/Warsaw";

  const slot = (variant: "pill" | "text") =>
    slotLabel === undefined ? (
      <RestaurantSlotPill
        slug={business.slug}
        timezone={timezone}
        variant={variant}
      />
    ) : (
      <TableSlotBadge label={slotLabel} variant={variant} />
    );

  if (promoted) {
    return (
      <Link
        href={`/b/${business.slug}`}
        className="block overflow-hidden rounded-2xl border-[1.5px] border-border-strong bg-card md:flex md:flex-col"
      >
        <div className="photo-placeholder flex h-28 flex-none items-center justify-center font-mono text-[10px] tracking-[0.08em] text-[#8f8b81]">
          ZDJĘCIE LOKALU 16:9
        </div>
        <div className="px-[15px] pt-[13px] pb-[15px] md:flex md:flex-1 md:flex-col">
          <div className="flex items-start justify-between gap-2.5">
            <div className="font-display text-[17px] font-bold tracking-tight">
              {business.name}
            </div>
            <div className="flex-none font-mono text-xs font-medium">
              {business.rating.score}{" "}
              <span className="text-[#8f8b81]">({business.rating.count})</span>
            </div>
          </div>
          <div className="mt-[3px] text-xs text-muted-foreground">
            {address} · restauracja
          </div>
          <div className="mt-[11px] md:mt-auto md:pt-[11px]">{slot("pill")}</div>
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={`/b/${business.slug}`}
      className="flex items-center gap-[13px] rounded-2xl border border-border bg-card px-[15px] py-[13px] md:flex-col md:items-stretch md:gap-0 md:overflow-hidden md:p-0"
    >
      <div className="photo-placeholder flex size-[62px] flex-none items-center justify-center rounded-xl md:h-28 md:w-full md:rounded-none">
        <span className="hidden font-mono text-[10px] tracking-[0.08em] text-[#8f8b81] md:block">
          ZDJĘCIE LOKALU
        </span>
      </div>
      <div className="min-w-0 md:flex md:flex-1 md:flex-col md:px-[15px] md:pt-[13px] md:pb-[15px]">
        <div className="font-display text-base font-bold tracking-tight md:text-[17px]">
          {business.name}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground md:mt-[3px]">
          {address ? `${address} · ` : ""}
          {business.rating.score} ({business.rating.count})
        </div>
        <div className="mt-1.5 md:mt-auto md:pt-2">{slot("text")}</div>
      </div>
    </Link>
  );
}
