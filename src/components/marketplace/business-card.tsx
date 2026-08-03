import Link from "next/link";
import { cityDisplay } from "@/app/m/miasta";
import { AvailabilityPill } from "@/components/marketplace/availability-pill";
import { formatPrice } from "@/components/marketplace/format";
import {
  DEFAULT_LOCALE,
  createPluralTranslator,
  createTranslator,
  type Locale,
} from "@/i18n";

/**
 * Karta firmy na listingach (home, strony miast i kategorii) — wzorzec
 * z wyszukiwarki: wynik promowany z pełnym zdjęciem i obrysem border-strong,
 * zwykły jako wiersz (telefon) / karta (md+).
 *
 * `slotLabel === undefined` ukrywa wiersz dostępności — strony statyczne
 * (ISR) nie liczą terminów zależnych od „teraz".
 */

export type RatingSummary = { score: string; count: number };

export type BusinessCardData = {
  id: string;
  slug: string;
  name: string;
  locations: { addressLine1: string; city: string }[];
  services: { priceCents: number; currency: string }[];
  /**
   * Ocena policzona agregatem (groupBy/_avg), a nie z listy opinii — listing
   * nie ma po co ściągać wszystkich wierszy `reviews` każdej firmy.
   */
  rating: RatingSummary;
};

/**
 * „1 wynik" / „3 wyniki" / „0 wyników" — liczebnik przez Intl.PluralRules
 * (PL: 3 formy, EN: 2). Jedna reguła dla wszystkich listingów.
 */
export function resultsCountLabel(
  count: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return createPluralTranslator(locale)("plural.results", count);
}

/** Wspólny format oceny: „4,6" / „4.6"; brak opinii → „5,0" / „5.0". */
export function ratingFromAggregate(
  average: number | null,
  count: number,
  locale: Locale = DEFAULT_LOCALE,
): RatingSummary {
  const separator = locale === "pl" ? "," : ".";
  if (count === 0 || average === null) {
    return { score: `5${separator}0`, count: 0 };
  }
  return { score: average.toFixed(1).replace(".", separator), count };
}

export function BusinessCard({
  business,
  promoted = false,
  slotLabel,
  locale = DEFAULT_LOCALE,
}: {
  business: BusinessCardData;
  promoted?: boolean;
  slotLabel?: string | null;
  locale?: Locale;
}) {
  const t = createTranslator(locale);
  const location = business.locations[0];
  const rating = business.rating;
  const priceFrom = business.services[0];
  // Miasto z bazy bywa wpisane małą literą — na listingu zawsze „Sanok".
  const address = location
    ? `${location.addressLine1}, ${cityDisplay(location.city)}`
    : "";

  if (promoted) {
    return (
      <Link
        href={`/b/${business.slug}`}
        className="block overflow-hidden rounded-2xl border-[1.5px] border-border-strong bg-card md:flex md:flex-col"
      >
        <div className="photo-placeholder flex h-28 flex-none items-center justify-center font-mono text-[10px] tracking-[0.08em] text-[#8f8b81]">
          {t("common.photo169")}
        </div>
        <div className="px-[15px] pt-[13px] pb-[15px] md:flex md:flex-1 md:flex-col">
          <div className="flex items-start justify-between gap-2.5">
            <div className="font-display text-[17px] font-bold tracking-tight">
              {business.name}
            </div>
            <div className="flex-none font-mono text-xs font-medium">
              {rating.score}{" "}
              <span className="text-[#8f8b81]">({rating.count})</span>
            </div>
          </div>
          <div className="mt-[3px] text-xs text-muted-foreground">
            {address}
            {priceFrom
              ? ` · ${t("format.priceFrom", { price: formatPrice(priceFrom.priceCents, priceFrom.currency, locale) })}`
              : ""}
          </div>
          {slotLabel !== undefined ? (
            <div className="mt-[11px] md:mt-auto md:pt-[11px]">
              <AvailabilityPill label={slotLabel} locale={locale} />
            </div>
          ) : null}
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
          {t("common.photo")}
        </span>
      </div>
      <div className="min-w-0 md:flex md:flex-1 md:flex-col md:px-[15px] md:pt-[13px] md:pb-[15px]">
        <div className="font-display text-base font-bold tracking-tight md:text-[17px]">
          {business.name}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground md:mt-[3px]">
          {address ? `${address} · ` : ""}
          {rating.score} ({rating.count})
        </div>
        {slotLabel !== undefined ? (
          <div className="mt-1.5 text-xs text-muted-foreground md:mt-auto md:pt-2">
            {t("home.nearestFree")}{" "}
            <span className="font-semibold text-foreground">
              {slotLabel ?? t("home.noneThisWeek")}
            </span>
          </div>
        ) : priceFrom ? (
          <div className="mt-1.5 text-xs text-muted-foreground md:mt-auto md:pt-2">
            {t("format.from")}{" "}
            <span className="font-semibold text-foreground">
              {formatPrice(priceFrom.priceCents, priceFrom.currency, locale)}
            </span>
          </div>
        ) : null}
      </div>
    </Link>
  );
}
