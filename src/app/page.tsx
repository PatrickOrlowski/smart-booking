import Link from "next/link";
import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { getNearestSlot } from "@/lib/availability-data";
import { AvailabilityPill } from "@/components/marketplace/availability-pill";
import { resultsCountLabel } from "@/components/marketplace/business-card";
import { SearchInput } from "@/components/marketplace/search-input";
import { SiteFooter } from "@/components/marketplace/site-footer";
import { SiteHeader } from "@/components/marketplace/site-header";
import { RestaurantCard } from "@/components/restaurant/restaurant-card";
import { getNearestTableSlot } from "@/components/restaurant/nearest-table";
import { tableSlotLabel } from "@/components/restaurant/format";
import {
  formatPrice,
  nearestSlotLabel,
} from "@/components/marketplace/format";

// Dostępność zależy od „teraz" — strona nie może być statyczna.
export const dynamic = "force-dynamic";

const FILTER_CHIPS = ["Wolne dziś", "Ocena 4,5+", "do 100 zł", "< 2 km"];

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

const ratingLabel = (reviews: { rating: number }[]) => {
  if (reviews.length === 0) return { score: "5,0", count: 0 };
  const average =
    reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
  return { score: average.toFixed(1).replace(".", ","), count: reviews.length };
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() || undefined;

  const businesses = await findBusinesses(query);
  // Restauracja nie ma „najbliższego wolnego terminu" usługi — ma najbliższy
  // wolny STOLIK, liczony zupełnie innym silnikiem (turn time, pacing).
  const nearestSlots = await Promise.all(
    businesses.map((business) =>
      (business.type === "RESTAURANT"
        ? getNearestTableSlot(business.slug)
        : getNearestSlot(business.slug)
      ).catch(() => null),
    ),
  );

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-md px-5 pt-4 pb-16 md:max-w-3xl lg:max-w-6xl lg:px-8 lg:pt-8">
      <div className="mb-[18px] flex items-center justify-between">
        <div>
          <div className="meta-label">Lokalizacja</div>
          <div className="flex items-center gap-1.5 font-display text-[19px] font-bold tracking-tight">
            Warszawa{" "}
            <span className="text-[11px] text-muted-foreground">▾</span>
          </div>
        </div>
      </div>

      <h1 className="mb-4 font-display text-[34px] leading-none font-extrabold tracking-tight lg:mb-6 lg:text-[44px] xl:text-[52px]">
        Zarezerwuj
        <br />
        na dziś.
      </h1>

      <div className="lg:mb-7 lg:flex lg:items-center lg:gap-3">
        <div className="lg:min-w-0 lg:max-w-md lg:flex-1">
          <Suspense>
            <SearchInput className="lg:mb-0" />
          </Suspense>
        </div>

        <div className="mb-[22px] flex gap-2 overflow-x-auto pb-1 lg:mb-0 lg:flex-none lg:overflow-visible lg:pb-0">
          {FILTER_CHIPS.map((chip, index) => (
            <span
              key={chip}
              className={
                index === 0
                  ? "flex-none rounded-full bg-primary px-[13px] py-2 text-xs font-semibold text-primary-foreground"
                  : "flex-none rounded-full border border-border bg-card px-[13px] py-2 text-xs font-semibold text-foreground/80"
              }
            >
              {chip}
            </span>
          ))}
        </div>
      </div>

      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-base font-bold tracking-tight">
          {query ? `Wyniki dla „${query}"` : "W pobliżu"}
        </h2>
        <span className="font-mono text-[11px] text-muted-foreground">
          {/* Jedna reguła liczebnika dla wszystkich listingów — inline
              `< 5 ? "wyniki"` dawało „0 wyniki" i „22 wyników". */}
          {resultsCountLabel(businesses.length)}
        </span>
      </div>

      {businesses.length === 0 ? (
        <div className="mx-auto max-w-md py-14 text-center">
          <h2 className="mb-2 font-display text-[27px] leading-tight font-extrabold tracking-tight">
            Nic nie
            <br />
            znaleźliśmy.
          </h2>
          <p className="mx-auto mb-6 max-w-[260px] text-[13px] leading-relaxed text-muted-foreground">
            Brak firm pasujących do „{query}”. Spróbuj innej nazwy albo miasta.
          </p>
          <Link
            href="/"
            className="inline-block rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground"
          >
            Wyczyść wyszukiwanie
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5 md:grid md:grid-cols-2 md:gap-4 lg:grid-cols-3 lg:gap-5">
          {businesses.map((business, index) => {
            const location = business.locations[0];
            const nearest = nearestSlots[index];
            const rating = ratingLabel(business.reviews);
            const priceFrom = business.services[0];
            const slotLabel = nearest
              ? nearestSlotLabel(nearest.startAt, nearest.timezone)
              : null;

            if (business.type === "RESTAURANT") {
              return (
                <RestaurantCard
                  key={business.id}
                  business={{ ...business, rating }}
                  promoted={index === 0}
                  slotLabel={
                    nearest
                      ? tableSlotLabel(nearest.startAt, nearest.timezone)
                      : null
                  }
                />
              );
            }

            if (index === 0) {
              // Wynik promowany — pełna karta z obrysem border-strong.
              return (
                <Link
                  key={business.id}
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
                        {rating.score}{" "}
                        <span className="text-[#8f8b81]">({rating.count})</span>
                      </div>
                    </div>
                    <div className="mt-[3px] text-xs text-muted-foreground">
                      {location
                        ? `${location.addressLine1}, ${location.city}`
                        : ""}
                      {priceFrom
                        ? ` · od ${formatPrice(priceFrom.priceCents, priceFrom.currency)}`
                        : ""}
                    </div>
                    <div className="mt-[11px] md:mt-auto md:pt-[11px]">
                      <AvailabilityPill label={slotLabel} />
                    </div>
                  </div>
                </Link>
              );
            }

            return (
              <Link
                key={business.id}
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
                    {location
                      ? `${location.addressLine1}, ${location.city} · `
                      : ""}
                    {rating.score} ({rating.count})
                  </div>
                  <div className="mt-1.5 text-xs text-muted-foreground md:mt-auto md:pt-2">
                    Najbliższy wolny:{" "}
                    <span className="font-semibold text-foreground">
                      {slotLabel ?? "brak w tym tygodniu"}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      </main>
      <SiteFooter />
    </>
  );
}
