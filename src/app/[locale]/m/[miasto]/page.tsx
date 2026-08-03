import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { BusinessType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import {
  BusinessCard,
  type BusinessCardData,
  ratingFromAggregate,
  resultsCountLabel,
} from "@/components/marketplace/business-card";
import { SiteFooter } from "@/components/marketplace/site-footer";
import { SiteHeader } from "@/components/marketplace/site-header";
import { RestaurantCard } from "@/components/restaurant/restaurant-card";
import { LOCALES, isLocale } from "@/i18n";
import { LocaleProvider } from "@/i18n/client";
import { getTranslations } from "@/i18n/server";
import {
  citySlug,
  cityInPhrase,
  cityVariants,
  getCityIndex,
  resolveCity,
} from "@/app/m/miasta";

/**
 * Strona SEO miasta. Publiczny adres to /m/warszawa — proxy (src/proxy.ts)
 * przepisuje go na wariant językowy /pl|en/m/warszawa według cookie
 * `planner.locale`. Fizyczny segment [locale] pozwala prerenderować OBIE
 * wersje językowe bez czytania cookies (co degradowałoby ISR do renderu
 * dynamicznego) — locale przychodzi z parametru trasy, a `getTranslations`
 * dostaje go jawnie.
 *
 * Statyczna z rewalidacją co godzinę — dlatego karty nie pokazują
 * „najbliższego wolnego terminu" (zależy od „teraz"), a belka renderuje
 * statyczny link „Zaloguj się" (`showAuth={false}`): czytanie sesji przez
 * `auth()` zdegradowałoby całą trasę do renderu dynamicznego.
 */

export const revalidate = 3600;

/** Ile firm pokazujemy na jednej (statycznej) stronie miasta. */
const LISTING_LIMIT = 60;

export async function generateStaticParams() {
  const index = await getCityIndex();
  return LOCALES.flatMap((locale) =>
    [...index.keys()].map((miasto) => ({ locale, miasto })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; miasto: string }>;
}): Promise<Metadata> {
  const { locale, miasto } = await params;
  if (!isLocale(locale)) return {};
  const city = await resolveCity(miasto);
  if (!city) return {};
  const { t } = await getTranslations(locale);
  const inCity = cityInPhrase(city, locale);
  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const path = `/m/${citySlug(city)}`;
  return {
    title: t("city.metaTitle", { inCity }),
    description: t("city.metaDescription", { inCity }),
    alternates: {
      // Każdy wariant językowy jest SELF-canonical: polski konsoliduje się
      // do bezprefiksowego adresu (proxy serwuje tam PL), angielski do
      // /en/... — canonical EN wskazujący polski URL kazałby Google
      // skonsolidować wersję EN do treści PL i zignorować hreflang.
      canonical:
        locale === "pl" ? `${appUrl}${path}` : `${appUrl}/${locale}${path}`,
      // hreflang wskazuje URL-e KANONICZNE wariantów (pl = bezprefiksowy).
      languages: {
        pl: `${appUrl}${path}`,
        en: `${appUrl}/en${path}`,
        "x-default": `${appUrl}${path}`,
      },
    },
  };
}

/**
 * Restauracja dostaje inną kartę (najbliższy wolny stolik zamiast ceny „od"),
 * więc listing musi znać typ firmy i strefę lokalu.
 */
type ListingBusiness = BusinessCardData & {
  type: BusinessType;
  locations: { addressLine1: string; city: string; timezone: string }[];
};

async function findBusinessesInCity(
  variants: string[],
  locale: "pl" | "en",
): Promise<{ businesses: ListingBusiness[]; total: number }> {
  // Miasto wpisuje właściciel, więc pod jednym slugiem żyją różne zapisy
  // („Gdańsk", „Gdansk"). Filtrujemy po komplecie wariantów — `equals`
  // na jednym z nich gubiłby firmy z pozostałych.
  const cityFilter = { in: variants };
  const where = {
    status: "ACTIVE" as const,
    locations: { some: { city: cityFilter, isActive: true } },
  };

  const [rows, total] = await Promise.all([
    prisma.business.findMany({
      where,
      select: {
        id: true,
        slug: true,
        name: true,
        type: true,
        locations: {
          // Firma z kilkoma lokalami ma pokazać adres tego z oglądanego miasta.
          where: { isActive: true, city: cityFilter },
          take: 1,
          select: { addressLine1: true, city: true, timezone: true },
        },
        services: {
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
      },
      orderBy: { createdAt: "asc" },
      take: LISTING_LIMIT,
    }),
    prisma.business.count({ where }),
  ]);

  // Ocena agregatem — ściąganie wszystkich opinii każdej firmy potrafiło
  // znaczyć setki tysięcy wierszy na jedno wejście na listing.
  const ratings = await prisma.review.groupBy({
    by: ["businessId"],
    where: {
      isPublished: true,
      businessId: { in: rows.map((business) => business.id) },
    },
    _avg: { rating: true },
    _count: { _all: true },
  });
  const byBusiness = new Map(ratings.map((row) => [row.businessId, row]));

  return {
    businesses: rows.map((business) => {
      const aggregate = byBusiness.get(business.id);
      return {
        ...business,
        rating: ratingFromAggregate(
          aggregate?._avg.rating ?? null,
          aggregate?._count._all ?? 0,
          locale,
        ),
      };
    }),
    total,
  };
}

export default async function CityPage({
  params,
}: {
  params: Promise<{ locale: string; miasto: string }>;
}) {
  const { locale, miasto } = await params;
  if (!isLocale(locale)) notFound();
  const city = await resolveCity(miasto);
  if (!city) notFound();

  const { t } = await getTranslations(locale);
  const { businesses, total } = await findBusinessesInCity(
    await cityVariants(miasto),
    locale,
  );

  return (
    <LocaleProvider locale={locale}>
      <SiteHeader showAuth={false} locale={locale} />
      <main className="mx-auto w-full max-w-md px-5 pt-6 pb-16 md:max-w-3xl lg:max-w-6xl lg:px-8 lg:pt-8">
        <div className="meta-label mb-1.5">{t("city.label")}</div>
        <h1 className="mb-2 font-display text-[30px] leading-[1.05] font-extrabold tracking-tight lg:text-[40px]">
          {t("city.heading", { inCity: cityInPhrase(city, locale) })}
        </h1>
        <p className="mb-6 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
          {t("city.subtitle")}
        </p>

        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-base font-bold tracking-tight">
            {t("listing.businesses")}
          </h2>
          <span className="font-mono text-[11px] text-muted-foreground">
            {resultsCountLabel(total, locale)}
          </span>
        </div>

        {businesses.length === 0 ? (
          <div className="mx-auto max-w-md py-14 text-center">
            <h2 className="mb-2 font-display text-[27px] leading-tight font-extrabold tracking-tight">
              {t("city.empty.title1")}
              <br />
              {t("city.empty.title2")}
            </h2>
            <p className="mx-auto mb-6 max-w-[260px] text-[13px] leading-relaxed text-muted-foreground">
              {t("city.empty.text")}
            </p>
            <Link
              href="/"
              className="inline-block rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground"
            >
              {t("listing.goToSearch")}
            </Link>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3.5 md:grid md:grid-cols-2 md:gap-4 lg:grid-cols-3 lg:gap-5">
              {businesses.map((business, index) =>
                business.type === "RESTAURANT" ? (
                  <RestaurantCard
                    key={business.id}
                    business={business}
                    promoted={index === 0}
                    locale={locale}
                  />
                ) : (
                  <BusinessCard
                    key={business.id}
                    business={business}
                    promoted={index === 0}
                    locale={locale}
                  />
                ),
              )}
            </div>
            {total > businesses.length ? (
              <p className="mt-6 text-center text-[12.5px] text-muted-foreground">
                {t("listing.showingOf", {
                  shown: businesses.length,
                  total,
                })}{" "}
                <Link href="/" className="font-semibold underline">
                  {t("listing.narrow")}
                </Link>
                .
              </p>
            ) : null}
          </>
        )}
      </main>
      <SiteFooter locale={locale} />
    </LocaleProvider>
  );
}
