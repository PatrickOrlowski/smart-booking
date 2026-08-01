import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { BusinessType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/authz";
import { getNearestSlot } from "@/lib/availability-data";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cityDisplay } from "@/app/m/miasta";
import { AvailabilityPill } from "@/components/marketplace/availability-pill";
import { FavoriteButton } from "@/components/marketplace/favorite-button";
import { OpeningHoursList } from "@/components/marketplace/opening-hours-list";
import { ReviewsSection } from "@/components/marketplace/reviews-section";
import { SiteFooter } from "@/components/marketplace/site-footer";
import { SiteHeader } from "@/components/marketplace/site-header";
import { RestaurantProfile } from "@/components/restaurant/restaurant-profile";
import {
  formatDuration,
  nearestSlotLabel,
  openStatus,
  priceLabel,
} from "@/components/marketplace/format";

export const dynamic = "force-dynamic";

/** Ile opinii renderujemy na profilu (reszta liczy się tylko do średniej). */
const REVIEWS_VISIBLE = 20;

/** Typ firmy → typ schema.org dla danych strukturalnych LocalBusiness. */
const SCHEMA_TYPE: Partial<Record<BusinessType, string>> = {
  BARBER: "HairSalon",
  HAIR_SALON: "HairSalon",
  BEAUTY: "BeautySalon",
  NAILS: "NailSalon",
  SPA: "DaySpa",
  TATTOO: "TattooParlor",
  FITNESS: "ExerciseGym",
  AUTO_SERVICE: "AutoRepair",
  MEDICAL: "MedicalClinic",
  RESTAURANT: "Restaurant",
};

const SCHEMA_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** Minuty od północy → "09:00" (schema.org wymaga zer wiodących). */
const minutesToHHMM = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const tabTriggerClass =
  "flex-none px-0 text-[13px] font-medium text-[#8f8b81] data-active:font-bold data-active:text-foreground rounded-none border-0 pb-2 after:bottom-0 after:h-[2.5px]";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const business = await prisma.business.findFirst({
    where: { slug, status: "ACTIVE" },
    select: {
      name: true,
      type: true,
      description: true,
      locations: {
        where: { isActive: true },
        take: 1,
        select: { city: true },
      },
    },
  });
  if (!business) return {};

  const isRestaurant = business.type === "RESTAURANT";
  const city = business.locations[0]?.city;
  const suffix = isRestaurant ? "rezerwacja stolika" : "rezerwacja online";
  const title = city
    ? `${business.name} — ${cityDisplay(city)} | ${suffix}`
    : `${business.name} | ${suffix}`;
  const description =
    business.description?.slice(0, 160) ??
    (isRestaurant
      ? `Zarezerwuj stolik online${city ? ` — ${business.name}, ${cityDisplay(city)}` : ""}. Sprawdź godziny, strefy i opinie.`
      : `Sprawdź cennik, zespół i opinie${city ? ` — ${business.name}, ${cityDisplay(city)}` : ""}. Zarezerwuj wizytę online.`);
  const url = `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/b/${slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", title, description, url },
  };
}

export default async function BusinessProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Restauracja ma inny profil (rezerwacja stolika zamiast cennika usług) —
  // rozgałęziamy się PRZED ciężkim zapytaniem o usługi i zespół, bo dla
  // lokalu gastronomicznego nie ma ono sensu.
  const kind = await prisma.business.findFirst({
    where: { slug, status: "ACTIVE" },
    select: { type: true },
  });
  if (!kind) notFound();
  if (kind.type === "RESTAURANT") return <RestaurantProfile slug={slug} />;

  const business = await prisma.business.findFirst({
    where: { slug, status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      slug: true,
      type: true,
      description: true,
      categories: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true },
      },
      services: {
        // `TABLE_RESERVATION` to techniczny nośnik rezerwacji stolika —
        // nigdy nie pokazuje się jako pozycja cennika.
        where: { isActive: true, kind: "STANDARD" },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          categoryId: true,
          name: true,
          durationMin: true,
          priceCents: true,
          priceType: true,
          currency: true,
          onlineBookable: true,
        },
      },
      locations: {
        where: { isActive: true },
        take: 1,
        select: {
          addressLine1: true,
          city: true,
          postalCode: true,
          country: true,
          latitude: true,
          longitude: true,
          phone: true,
          timezone: true,
          cancellationCutoffHours: true,
          openingHours: {
            orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
            select: { weekday: true, startMinute: true, endMinute: true },
          },
          resources: {
            where: { isActive: true, type: "STAFF" },
            orderBy: { sortOrder: "asc" },
            select: {
              id: true,
              name: true,
              staffProfile: { select: { title: true, bio: true } },
            },
          },
        },
      },
      reviews: {
        where: { isPublished: true },
        orderBy: { createdAt: "desc" },
        // Tylko najnowsze — średnia i rozkład idą osobnym agregatem,
        // inaczej firma z tysiącami opinii generuje na każde wejście
        // wielomegabajtowy HTML/RSC.
        take: REVIEWS_VISIBLE,
        select: {
          id: true,
          rating: true,
          comment: true,
          reply: true,
          repliedAt: true,
          createdAt: true,
          author: { select: { name: true } },
        },
      },
    },
  });

  if (!business || business.locations.length === 0) notFound();

  const location = business.locations[0];
  const status = openStatus(location.openingHours, location.timezone);

  // Ulubione — serce na profilu; dla niezalogowanego zawsze puste.
  const user = await getCurrentUser();
  const isFavorite = user
    ? (await prisma.favorite.findUnique({
        where: {
          userId_businessId: { userId: user.id, businessId: business.id },
        },
        select: { id: true },
      })) !== null
    : false;

  // Najbliższy wolny termin — pastylka w sticky karcie „Zarezerwuj" (lg+).
  const nearestSlot = await getNearestSlot(business.slug).catch(() => null);
  const nearestLabel = nearestSlot
    ? nearestSlotLabel(nearestSlot.startAt, nearestSlot.timezone)
    : null;

  const reviews = business.reviews;

  // Średnia, liczba i rozkład ocen — z agregatu po wszystkich opublikowanych
  // opiniach, niezależnie od tego, ile z nich renderujemy.
  const ratingGroups = await prisma.review.groupBy({
    by: ["rating"],
    where: { businessId: business.id, isPublished: true },
    _count: { _all: true },
  });
  const reviewsTotal = ratingGroups.reduce(
    (sum, group) => sum + group._count._all,
    0,
  );
  const averageRating =
    reviewsTotal === 0
      ? null
      : ratingGroups.reduce(
          (sum, group) => sum + group.rating * group._count._all,
          0,
        ) / reviewsTotal;
  const ratingScore =
    averageRating === null ? "5,0" : averageRating.toFixed(1).replace(".", ",");

  // Rozkład ocen 1–5 do pasków w nagłówku zakładki Opinie.
  const ratingDistribution = [5, 4, 3, 2, 1].map((stars) => {
    const count =
      ratingGroups.find((group) => group.rating === stars)?._count._all ?? 0;
    return {
      stars,
      count,
      percent: reviewsTotal === 0 ? 0 : Math.round((count / reviewsTotal) * 100),
    };
  });

  // Dane strukturalne LocalBusiness/HairSalon dla wyszukiwarek.
  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": SCHEMA_TYPE[business.type] ?? "LocalBusiness",
    name: business.name,
    url: `${appUrl}/b/${business.slug}`,
    ...(business.description ? { description: business.description } : {}),
    address: {
      "@type": "PostalAddress",
      streetAddress: location.addressLine1,
      addressLocality: location.city,
      postalCode: location.postalCode,
      addressCountry: location.country,
    },
    ...(location.latitude !== null && location.longitude !== null
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: location.latitude,
            longitude: location.longitude,
          },
        }
      : {}),
    ...(location.phone ? { telephone: location.phone } : {}),
    openingHoursSpecification: location.openingHours.map((block) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: SCHEMA_DAYS[block.weekday],
      opens: minutesToHHMM(block.startMinute),
      closes: minutesToHHMM(block.endMinute),
    })),
    ...(averageRating !== null
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: Number(averageRating.toFixed(1)),
            reviewCount: reviewsTotal,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };

  // Cennik pogrupowany po kategoriach; usługi bez kategorii na końcu.
  const groups = [
    ...business.categories.map((category) => ({
      id: category.id,
      name: category.name,
      services: business.services.filter(
        (service) => service.categoryId === category.id,
      ),
    })),
    {
      id: "bez-kategorii",
      name: "Pozostałe",
      services: business.services.filter((service) => !service.categoryId),
    },
  ].filter((group) => group.services.length > 0);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <SiteHeader />
      <main className="mx-auto w-full max-w-md pb-16 md:max-w-3xl md:px-5 lg:max-w-6xl lg:px-8 lg:pt-6">
      <div className="mb-5 hidden lg:block">
        <Link
          href="/"
          className="text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Wyniki
        </Link>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-12">
      <div className="min-w-0">
      <div className="photo-placeholder relative flex h-[180px] items-center justify-center font-mono text-[10px] tracking-[0.08em] text-[#8f8b81] md:mt-5 md:h-[240px] md:rounded-2xl lg:mt-0 lg:h-[280px]">
        GALERIA
        <Link
          href="/"
          aria-label="Wróć do wyszukiwarki"
          className="absolute top-3 left-3.5 flex size-[34px] items-center justify-center rounded-full border-[1.5px] border-border-strong bg-card text-sm lg:hidden"
        >
          ←
        </Link>
      </div>

      <div className="px-5 pt-4 md:px-0">
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-[27px] leading-[1.02] font-extrabold tracking-tight">
            {business.name}
          </h1>
          <FavoriteButton
            businessId={business.id}
            initialIsFavorite={isFavorite}
            className="lg:hidden"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="font-mono font-medium text-foreground">
            {ratingScore} ★ ({reviewsTotal})
          </span>
          <span>·</span>
          <span>
            {location.addressLine1}, {location.city}
          </span>
          <span>·</span>
          <span
            className={
              status.isOpen ? "font-semibold text-success" : "font-semibold"
            }
          >
            {status.label}
          </span>
        </div>

        <Tabs defaultValue="uslugi" id="cennik" className="mt-4 scroll-mt-6">
          <TabsList
            variant="line"
            className="h-auto w-full justify-start gap-5 rounded-none border-b border-[#e2ddd2] p-0"
          >
            <TabsTrigger value="uslugi" className={tabTriggerClass}>
              Usługi
            </TabsTrigger>
            <TabsTrigger value="zespol" className={tabTriggerClass}>
              Zespół
            </TabsTrigger>
            <TabsTrigger value="opinie" className={tabTriggerClass}>
              Opinie{" "}
              <span className="font-mono text-[11px] font-medium text-muted-foreground">

              </span>
            </TabsTrigger>
            <TabsTrigger value="info" className={tabTriggerClass}>
              Info
            </TabsTrigger>
          </TabsList>

          <TabsContent value="uslugi">
            {groups.map((group) => (
              <section key={group.id}>
                <div className="meta-label mt-5 mb-2">{group.name}</div>
                <div className="flex flex-col">
                  {group.services.map((service) => {
                    const bookable =
                      service.onlineBookable &&
                      service.priceType !== "ON_REQUEST";
                    return (
                      <div
                        key={service.id}
                        className="flex items-center gap-3 border-t border-muted py-3.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[15px] font-semibold">
                            {service.name}
                          </div>
                          <div className="mt-[3px] font-mono text-xs text-muted-foreground">
                            {formatDuration(service.durationMin)} ·{" "}
                            {priceLabel(
                              service.priceCents,
                              service.priceType,
                              service.currency,
                            )}
                          </div>
                        </div>
                        {bookable ? (
                          <Link
                            href={`/b/${business.slug}/rezerwacja?serviceId=${service.id}`}
                            className="flex-none rounded-full border-[1.5px] border-border-strong bg-card px-4 py-[9px] text-[13px] font-semibold"
                          >
                            Wybierz
                          </Link>
                        ) : (
                          <span className="flex-none rounded-full border-[1.5px] border-border bg-card px-4 py-[9px] text-[13px] font-semibold text-muted-foreground">
                            Zapytaj
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </TabsContent>

          <TabsContent value="zespol">
            <div className="mt-5 flex flex-col gap-2.5">
              {location.resources.map((resource) => (
                <div
                  key={resource.id}
                  className="flex items-center gap-[13px] rounded-2xl border border-border bg-card p-[13px]"
                >
                  <div className="photo-placeholder size-[52px] flex-none rounded-full" />
                  <div className="min-w-0">
                    <div className="text-[15px] font-bold">{resource.name}</div>
                    {resource.staffProfile?.title ? (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {resource.staffProfile.title}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              {location.resources.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  Zespół nie został jeszcze uzupełniony.
                </p>
              ) : null}
            </div>
          </TabsContent>

          <TabsContent value="opinie">
            <ReviewsSection
              reviews={reviews}
              total={reviewsTotal}
              ratingScore={ratingScore}
              distribution={ratingDistribution}
              timezone={location.timezone}
            />
          </TabsContent>

          <TabsContent value="info">
            <div className="mt-5 flex flex-col gap-4">
              {business.description ? (
                <p className="text-[13px] leading-relaxed text-foreground/80">
                  {business.description}
                </p>
              ) : null}

              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="meta-label mb-2">Adres</div>
                <div className="text-sm font-semibold">
                  {location.addressLine1}
                </div>
                <div className="text-[13px] text-muted-foreground">
                  {location.postalCode} {location.city}
                </div>
                {location.phone ? (
                  <div className="mt-2 font-mono text-[13px]">
                    {location.phone}
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="meta-label mb-2">Godziny otwarcia</div>
                <OpeningHoursList openingHours={location.openingHours} />
              </div>

              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="mb-1.5 text-xs font-bold">Zasady odwołania</div>
                <p className="text-[11.5px] leading-relaxed text-foreground/80">
                  Bezpłatnie do{" "}
                  <b>{location.cancellationCutoffHours} h</b> przed wizytą.
                  Później termin przepada.
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
      </div>

      <aside className="hidden lg:sticky lg:top-8 lg:block">
        <div className="rounded-2xl border-[1.5px] border-border-strong bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-xl font-bold tracking-tight">
              Zarezerwuj
            </h2>
            <FavoriteButton
              businessId={business.id}
              initialIsFavorite={isFavorite}
            />
          </div>
          <div
            className={
              status.isOpen
                ? "mt-1 text-[13px] font-semibold text-success"
                : "mt-1 text-[13px] font-semibold text-muted-foreground"
            }
          >
            {status.label}
          </div>

          <AvailabilityPill label={nearestLabel} className="mt-3.5" />

          <a
            href="#cennik"
            className="mt-4 block w-full rounded-full bg-primary px-4 py-3 text-center text-sm font-bold text-primary-foreground"
          >
            Zarezerwuj wizytę
          </a>
          <p className="mt-2 text-center text-[11px] text-[#8f8b81]">
            Wybierz usługę z cennika, żeby zobaczyć terminy.
          </p>

          <div className="my-5 h-px bg-border" />

          <div className="meta-label mb-2">Adres</div>
          <div className="text-sm font-semibold">{location.addressLine1}</div>
          <div className="text-[13px] text-muted-foreground">
            {location.postalCode} {location.city}
          </div>
          {location.phone ? (
            <div className="mt-1.5 font-mono text-[13px]">{location.phone}</div>
          ) : null}

          <div className="meta-label mt-5 mb-2">Godziny otwarcia</div>
          <OpeningHoursList openingHours={location.openingHours} />
        </div>
      </aside>
      </div>
      </main>
      <SiteFooter />
    </>
  );
}
