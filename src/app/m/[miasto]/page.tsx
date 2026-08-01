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
import {
  citySlug,
  cityInPhrase,
  cityVariants,
  getCityIndex,
  resolveCity,
} from "../miasta";

/**
 * Strona SEO miasta: /m/warszawa. Statyczna z rewalidacją co godzinę —
 * dlatego karty nie pokazują „najbliższego wolnego terminu" (zależy od
 * „teraz"), tylko ocenę i cenę od. Z tego samego powodu belka renderuje
 * statyczny link „Zaloguj się" (`showAuth={false}`): czytanie sesji przez
 * `auth()` zdegradowałoby całą trasę do renderu dynamicznego.
 */

export const revalidate = 3600;

/** Ile firm pokazujemy na jednej (statycznej) stronie miasta. */
const LISTING_LIMIT = 60;

export async function generateStaticParams() {
  const index = await getCityIndex();
  return [...index.keys()].map((miasto) => ({ miasto }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ miasto: string }>;
}): Promise<Metadata> {
  const { miasto } = await params;
  const city = await resolveCity(miasto);
  if (!city) return {};
  const inCity = cityInPhrase(city);
  return {
    title: `Salony i usługi ${inCity} — rezerwacja online | Planner`,
    description:
      `Znajdź salon ${inCity} i zarezerwuj wizytę online: barberzy, fryzjerzy, ` +
      `uroda, zdrowie i więcej. Wolne terminy i opinie klientów w jednym miejscu.`,
    alternates: {
      canonical: `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/m/${citySlug(city)}`,
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
        ),
      };
    }),
    total,
  };
}

export default async function CityPage({
  params,
}: {
  params: Promise<{ miasto: string }>;
}) {
  const { miasto } = await params;
  const city = await resolveCity(miasto);
  if (!city) notFound();

  const { businesses, total } = await findBusinessesInCity(
    await cityVariants(miasto),
  );

  return (
    <>
      <SiteHeader showAuth={false} />
      <main className="mx-auto w-full max-w-md px-5 pt-6 pb-16 md:max-w-3xl lg:max-w-6xl lg:px-8 lg:pt-8">
        <div className="meta-label mb-1.5">Miasto</div>
        <h1 className="mb-2 font-display text-[30px] leading-[1.05] font-extrabold tracking-tight lg:text-[40px]">
          Salony i usługi {cityInPhrase(city)}
        </h1>
        <p className="mb-6 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
          Zarezerwuj wizytę online — sprawdź opinie, cennik i wolne terminy bez
          dzwonienia.
        </p>

        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-base font-bold tracking-tight">
            Firmy
          </h2>
          <span className="font-mono text-[11px] text-muted-foreground">
            {resultsCountLabel(total)}
          </span>
        </div>

        {businesses.length === 0 ? (
          <div className="mx-auto max-w-md py-14 text-center">
            <h2 className="mb-2 font-display text-[27px] leading-tight font-extrabold tracking-tight">
              Jeszcze tu
              <br />
              nie jesteśmy.
            </h2>
            <p className="mx-auto mb-6 max-w-[260px] text-[13px] leading-relaxed text-muted-foreground">
              Brak aktywnych firm w tym mieście. Sprawdź wyszukiwarkę — nowe
              salony dochodzą co tydzień.
            </p>
            <Link
              href="/"
              className="inline-block rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground"
            >
              Przejdź do wyszukiwarki
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
                  />
                ) : (
                  <BusinessCard
                    key={business.id}
                    business={business}
                    promoted={index === 0}
                  />
                ),
              )}
            </div>
            {total > businesses.length ? (
              <p className="mt-6 text-center text-[12.5px] text-muted-foreground">
                Pokazujemy {businesses.length} z {total} firm.{" "}
                <Link href="/" className="font-semibold underline">
                  Zawęź wyniki w wyszukiwarce
                </Link>
                .
              </p>
            ) : null}
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
