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
  KATEGORIA_SLUGS,
  KATEGORIE,
  kategoriaDescription,
  kategoriaHeading,
} from "@/app/k/kategorie";

/**
 * Strona SEO kategorii. Publiczny adres to /k/barber — proxy (src/proxy.ts)
 * przepisuje go na wariant językowy /pl|en/k/barber według cookie
 * `planner.locale`. Fizyczny segment [locale] pozwala prerenderować obie
 * wersje bez czytania cookies — patrz komentarz w [locale]/m/[miasto].
 *
 * Statyczna z rewalidacją co godzinę — karty bez „najbliższego wolnego
 * terminu" (zależy od „teraz"), a belka bez `auth()` (`showAuth={false}`).
 */

export const revalidate = 3600;

/** Ile firm pokazujemy na jednej (statycznej) stronie kategorii. */
const LISTING_LIMIT = 60;

export function generateStaticParams() {
  return LOCALES.flatMap((locale) =>
    KATEGORIA_SLUGS.map((kategoria) => ({ locale, kategoria })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; kategoria: string }>;
}): Promise<Metadata> {
  const { locale, kategoria } = await params;
  if (!isLocale(locale)) return {};
  const entry = KATEGORIE[kategoria];
  if (!entry) return {};
  const { t } = await getTranslations(locale);
  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const path = `/k/${kategoria}`;
  return {
    title: t("cat.metaTitle", { heading: kategoriaHeading(entry, locale) }),
    description: kategoriaDescription(entry, locale),
    alternates: {
      // Self-canonical per wariant + hreflang na URL-e kanoniczne —
      // patrz komentarz w [locale]/m/[miasto]/page.tsx.
      canonical:
        locale === "pl" ? `${appUrl}${path}` : `${appUrl}/${locale}${path}`,
      languages: {
        pl: `${appUrl}${path}`,
        en: `${appUrl}/en${path}`,
        "x-default": `${appUrl}${path}`,
      },
    },
  };
}

/**
 * Karta restauracji potrzebuje strefy lokalu — pastylkę „Stolik dziś od
 * 18:00" dolicza przeglądarka (strona jest statyczna), a dzień lokalny musi
 * wyjść ze strefy lokalu, nie z zegara gościa.
 */
type ListingBusiness = BusinessCardData & {
  locations: { addressLine1: string; city: string; timezone: string }[];
};

async function findBusinessesOfType(
  type: BusinessType,
  locale: "pl" | "en",
): Promise<{ businesses: ListingBusiness[]; total: number }> {
  const where = { status: "ACTIVE" as const, type };

  const [rows, total] = await Promise.all([
    prisma.business.findMany({
      where,
      select: {
        id: true,
        slug: true,
        name: true,
        locations: {
          where: { isActive: true },
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

  // Ocena agregatem zamiast ściągania wszystkich opinii każdej firmy.
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

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ locale: string; kategoria: string }>;
}) {
  const { locale, kategoria } = await params;
  if (!isLocale(locale)) notFound();
  const entry = KATEGORIE[kategoria];
  if (!entry) notFound();

  const { t } = await getTranslations(locale);
  const { businesses, total } = await findBusinessesOfType(entry.type, locale);

  return (
    <LocaleProvider locale={locale}>
      <SiteHeader showAuth={false} locale={locale} />
      <main className="mx-auto w-full max-w-md px-5 pt-6 pb-16 md:max-w-3xl lg:max-w-6xl lg:px-8 lg:pt-8">
        <div className="meta-label mb-1.5">{t("cat.label")}</div>
        <h1 className="mb-2 font-display text-[30px] leading-[1.05] font-extrabold tracking-tight lg:text-[40px]">
          {kategoriaHeading(entry, locale)}
        </h1>
        <p className="mb-6 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
          {kategoriaDescription(entry, locale)}
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
              {t("cat.empty.title1")}
              <br />
              {t("cat.empty.title2")}
            </h2>
            <p className="mx-auto mb-6 max-w-[260px] text-[13px] leading-relaxed text-muted-foreground">
              {t("cat.empty.text")}
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
                entry.type === "RESTAURANT" ? (
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
