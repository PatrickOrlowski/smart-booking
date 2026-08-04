import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { MAX_RADIUS_KM, findBusinessesNearby } from "@/lib/geo";
import { getNearestSlot } from "@/lib/availability-data";
import {
  BusinessCard,
  resultsCountLabel,
  type RatingSummary,
} from "@/components/marketplace/business-card";
import { SearchInput } from "@/components/marketplace/search-input";
import { NearbyButton } from "@/components/marketplace/geo/nearby-button";
import { DistanceChip } from "@/components/marketplace/geo/distance-chip";
import { parseCoordinate } from "@/components/marketplace/geo/coords";
import { SiteFooter } from "@/components/marketplace/site-footer";
import { SiteHeader } from "@/components/marketplace/site-header";
import { RestaurantCard } from "@/components/restaurant/restaurant-card";
import { getNearestTableSlot } from "@/components/restaurant/nearest-table";
import { tableSlotLabel } from "@/components/restaurant/format";
import {
  distanceLabel,
  nearestSlotLabel,
} from "@/components/marketplace/format";
import { LocaleProvider } from "@/i18n/client";
import { getTranslations } from "@/i18n/server";
import type { MessageKey } from "@/i18n";
import type { BusinessType } from "@/generated/prisma/enums";

// Dostępność zależy od „teraz" — strona nie może być statyczna.
export const dynamic = "force-dynamic";

/** Chipy bez chipa odległości — ten jest interaktywny (DistanceChip). */
const STATIC_CHIP_KEYS: MessageKey[] = [
  "home.chip.today",
  "home.chip.rating",
  "home.chip.price",
];

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return {
    title: t("home.meta.title"),
    description: t("home.meta.description"),
  };
}

async function findBusinesses(q: string | undefined) {
  return prisma.business.findMany({
    where: {
      status: "ACTIVE",
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              {
                locations: {
                  some: { city: { contains: q, mode: "insensitive" } },
                },
              },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      slug: true,
      name: true,
      type: true,
      locations: {
        where: { isActive: true },
        take: 1,
        select: { addressLine1: true, city: true, timezone: true },
      },
      services: {
        // Cena "od" tylko z usług płatnych — darmowa konsultacja dawałaby "od 0 zł".
        where: {
          isActive: true,
          onlineBookable: true,
          // Rezerwacja stolika nie jest pozycją cennika — restauracja
          // pokazuje najbliższy wolny stolik, nie cenę „od".
          kind: "STANDARD",
          priceType: { in: ["FIXED", "FROM"] },
        },
        orderBy: { priceCents: "asc" },
        take: 1,
        select: { priceCents: true, currency: true },
      },
      reviews: {
        where: { isPublished: true },
        select: { rating: true },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
}

const ratingLabel = (
  reviews: { rating: number }[],
  separator: string,
): RatingSummary => {
  if (reviews.length === 0) return { score: `5${separator}0`, count: 0 };
  const average =
    reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
  return {
    score: average.toFixed(1).replace(".", separator),
    count: reviews.length,
  };
};

/** Wspólny kształt karty dla listy domyślnej i trybu „w pobliżu". */
type ListingItem = {
  id: string;
  slug: string;
  name: string;
  type: BusinessType;
  locations: { addressLine1: string; city: string; timezone: string }[];
  services: { priceCents: number; currency: string }[];
  rating: RatingSummary;
  /** Tylko tryb geo — etykieta „1,2 km" / „850 m" na karcie. */
  distanceLabel?: string;
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    lat?: string;
    lng?: string;
    maxKm?: string;
  }>;
}) {
  const { q, lat, lng, maxKm } = await searchParams;
  const query = q?.trim() || undefined;
  const { locale, t } = await getTranslations();
  const decimalSeparator = locale === "pl" ? "," : ".";

  const originLat = parseCoordinate(lat, 90);
  const originLng = parseCoordinate(lng, 180);
  const origin =
    originLat !== null && originLng !== null
      ? { lat: originLat, lng: originLng }
      : null;
  // Chip „< 2 km" ustawia ?maxKm=2 — filtr działa tylko przy znanej pozycji.
  const maxDistanceKm =
    origin && maxKm && Number.isFinite(Number(maxKm)) && Number(maxKm) > 0
      ? Math.min(Number(maxKm), MAX_RADIUS_KM)
      : null;

  let items: ListingItem[];
  if (origin) {
    const nearby = await findBusinessesNearby({
      ...origin,
      radiusKm: MAX_RADIUS_KM,
      limit: 20,
      query,
    });
    items = nearby
      .filter(
        (business) =>
          maxDistanceKm === null || business.distanceKm < maxDistanceKm,
      )
      .map((business) => ({
        ...business,
        rating: ratingLabel(business.reviews, decimalSeparator),
        distanceLabel: distanceLabel(business.distanceKm, locale),
      }));
  } else {
    items = (await findBusinesses(query)).map((business) => ({
      ...business,
      rating: ratingLabel(business.reviews, decimalSeparator),
    }));
  }

  // Restauracja nie ma „najbliższego wolnego terminu" usługi — ma najbliższy
  // wolny STOLIK, liczony zupełnie innym silnikiem (turn time, pacing).
  const nearestSlots = await Promise.all(
    items.map((business) =>
      (business.type === "RESTAURANT"
        ? getNearestTableSlot(business.slug)
        : getNearestSlot(business.slug)
      ).catch(() => null),
    ),
  );

  return (
    <LocaleProvider locale={locale}>
      <SiteHeader locale={locale} />
      <main className="mx-auto w-full max-w-md px-5 pt-4 pb-16 md:max-w-3xl lg:max-w-6xl lg:px-8 lg:pt-8">
      <div className="mb-[18px] flex items-center justify-between">
        <div>
          <div className="meta-label">{t("home.location")}</div>
          <div className="flex items-center gap-1.5 font-display text-[19px] font-bold tracking-tight">
            Warszawa{" "}
            <span className="text-[11px] text-muted-foreground">▾</span>
          </div>
        </div>
      </div>

      <h1 className="mb-4 font-display text-[34px] leading-none font-extrabold tracking-tight lg:mb-6 lg:text-[44px] xl:text-[52px]">
        {t("home.heading1")}
        <br />
        {t("home.heading2")}
      </h1>

      <div className="lg:mb-7 lg:flex lg:items-start lg:gap-3">
        <div className="lg:min-w-0 lg:max-w-md lg:flex-1">
          <Suspense>
            <SearchInput className="lg:mb-0" />
          </Suspense>
        </div>

        <Suspense>
          <NearbyButton className="mb-3.5 lg:mb-0 lg:flex-none" />
        </Suspense>

        <div className="mb-[22px] flex gap-2 overflow-x-auto pb-1 lg:mb-0 lg:min-h-11 lg:flex-none lg:items-center lg:overflow-visible lg:pb-0">
          {STATIC_CHIP_KEYS.map((chipKey, index) => (
            <span
              key={chipKey}
              className={
                index === 0
                  ? "flex-none rounded-full bg-primary px-[13px] py-2 text-xs font-semibold text-primary-foreground"
                  : "flex-none rounded-full border border-border bg-card px-[13px] py-2 text-xs font-semibold text-foreground/80"
              }
            >
              {t(chipKey)}
            </span>
          ))}
          <Suspense>
            <DistanceChip />
          </Suspense>
        </div>
      </div>

      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-base font-bold tracking-tight">
          {query ? t("home.resultsFor", { query }) : t("home.nearby")}
        </h2>
        <span className="font-mono text-[11px] text-muted-foreground">
          {/* Jedna reguła liczebnika dla wszystkich listingów — Intl.PluralRules. */}
          {resultsCountLabel(items.length, locale)}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="mx-auto max-w-md py-14 text-center">
          <h2 className="mb-2 font-display text-[27px] leading-tight font-extrabold tracking-tight">
            {t("home.empty.title1")}
            <br />
            {t("home.empty.title2")}
          </h2>
          <p className="mx-auto mb-6 max-w-[260px] text-[13px] leading-relaxed text-muted-foreground">
            {origin && !query
              ? t("home.empty.geoText")
              : t("home.empty.text", { query: query ?? "" })}
          </p>
          <Link
            href="/"
            className="inline-block rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground"
          >
            {t("home.empty.clear")}
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5 md:grid md:grid-cols-2 md:gap-4 lg:grid-cols-3 lg:gap-5">
          {items.map((business, index) => {
            const nearest = nearestSlots[index];

            if (business.type === "RESTAURANT") {
              return (
                <RestaurantCard
                  key={business.id}
                  business={business}
                  promoted={index === 0}
                  locale={locale}
                  distanceLabel={business.distanceLabel}
                  slotLabel={
                    nearest
                      ? tableSlotLabel(nearest.startAt, nearest.timezone, locale)
                      : null
                  }
                />
              );
            }

            return (
              <BusinessCard
                key={business.id}
                business={business}
                promoted={index === 0}
                locale={locale}
                distanceLabel={business.distanceLabel}
                slotLabel={
                  nearest
                    ? nearestSlotLabel(nearest.startAt, nearest.timezone, locale)
                    : null
                }
              />
            );
          })}
        </div>
      )}
      </main>
      <SiteFooter locale={locale} />
    </LocaleProvider>
  );
}
