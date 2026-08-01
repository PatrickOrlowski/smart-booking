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
import { KATEGORIA_SLUGS, KATEGORIE } from "../kategorie";

/**
 * Strona SEO kategorii: /k/barber. Statyczna z rewalidacją co godzinę —
 * karty bez „najbliższego wolnego terminu" (zależy od „teraz"), a belka
 * bez `auth()` (`showAuth={false}`), bo czytanie sesji degraduje trasę
 * do renderu dynamicznego.
 */

export const revalidate = 3600;

/** Ile firm pokazujemy na jednej (statycznej) stronie kategorii. */
const LISTING_LIMIT = 60;

export function generateStaticParams() {
  return KATEGORIA_SLUGS.map((kategoria) => ({ kategoria }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ kategoria: string }>;
}): Promise<Metadata> {
  const { kategoria } = await params;
  const entry = KATEGORIE[kategoria];
  if (!entry) return {};
  return {
    title: `${entry.heading} — rezerwacja online | Planner`,
    description: entry.description,
    alternates: {
      canonical: `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/k/${kategoria}`,
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
        ),
      };
    }),
    total,
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ kategoria: string }>;
}) {
  const { kategoria } = await params;
  const entry = KATEGORIE[kategoria];
  if (!entry) notFound();

  const { businesses, total } = await findBusinessesOfType(entry.type);

  return (
    <>
      <SiteHeader showAuth={false} />
      <main className="mx-auto w-full max-w-md px-5 pt-6 pb-16 md:max-w-3xl lg:max-w-6xl lg:px-8 lg:pt-8">
        <div className="meta-label mb-1.5">Kategoria</div>
        <h1 className="mb-2 font-display text-[30px] leading-[1.05] font-extrabold tracking-tight lg:text-[40px]">
          {entry.heading}
        </h1>
        <p className="mb-6 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
          {entry.description}
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
              Jeszcze
              <br />
              pusto.
            </h2>
            <p className="mx-auto mb-6 max-w-[260px] text-[13px] leading-relaxed text-muted-foreground">
              Brak aktywnych firm w tej kategorii. Sprawdź wyszukiwarkę — nowe
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
                entry.type === "RESTAURANT" ? (
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
