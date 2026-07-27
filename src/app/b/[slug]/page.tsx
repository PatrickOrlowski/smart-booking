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
import { SiteFooter } from "@/components/marketplace/site-footer";
import { SiteHeader } from "@/components/marketplace/site-header";
import {
  WEEKDAYS_LONG,
  formatDuration,
  minutesToLabel,
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

/** "1 opinia" / "3 opinie" / "12 opinii". */
function reviewsCountLabel(count: number): string {
  if (count === 1) return "1 opinia";
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} opinie`;
  }
  return `${count} opinii`;
}

/** Gwiazdki 1–5 — wypełnione atramentem, reszta w kolorze obramowań. */
function Stars({ rating }: { rating: number }) {
  return (
    <span
      role="img"
      aria-label={`Ocena ${rating} na 5`}
      className="font-mono text-[13px] tracking-[0.15em]"
    >
      <span>{"★".repeat(rating)}</span>
      <span className="text-border">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

const tabTriggerClass =
  "flex-none px-0 text-[13px] font-medium text-[#8f8b81] data-active:font-bold data-active:text-foreground rounded-none border-0 pb-2 after:bottom-0 after:h-[2.5px]";

/** Lista godzin otwarcia per dzień — używana w zakładce Info i sticky karcie. */
function OpeningHoursList({
  openingHours,
}: {
  openingHours: { weekday: number; startMinute: number; endMinute: number }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {WEEKDAYS_LONG.map((dayName, weekday) => {
        const blocks = openingHours.filter(
          (entry) => entry.weekday === weekday,
        );
        return (
          <div key={dayName} className="flex justify-between text-[13px]">
            <span className="capitalize">{dayName}</span>
            <span className="font-mono text-muted-foreground">
              {blocks.length === 0
                ? "zamknięte"
                : blocks
                    .map(
                      (block) =>
                        `${minutesToLabel(block.startMinute)}–${minutesToLabel(block.endMinute)}`,
                    )
                    .join(", ")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

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
      description: true,
      locations: {
        where: { isActive: true },
        take: 1,
        select: { city: true },
      },
    },
  });
  if (!business) return {};

  const city = business.locations[0]?.city;
  const title = city
    ? `${business.name} — ${cityDisplay(city)} | rezerwacja online`
    : `${business.name} | rezerwacja online`;
  const description =
    business.description?.slice(0, 160) ??
    `Sprawdź cennik, zespół i opinie${city ? ` — ${business.name}, ${cityDisplay(city)}` : ""}. Zarezerwuj wizytę online.`;
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
        where: { isActive: true },
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

  const reviewDateLabel = (date: Date) =>
    new Intl.DateTimeFormat("pl-PL", {
      timeZone: location.timezone,
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);

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
            {reviewsTotal === 0 ? (
              <div className="mx-auto max-w-md py-12 text-center">
                <h2 className="mb-2 font-display text-[24px] leading-tight font-extrabold tracking-tight">
                  Jeszcze brak opinii.
                </h2>
                <p className="mx-auto max-w-[280px] text-[13px] leading-relaxed text-muted-foreground">
                  Opinię można wystawić po zakończonej wizycie — bądź pierwszą
                  osobą, która oceni to miejsce.
                </p>
              </div>
            ) : (
              <>
                <div className="mt-5 flex items-center gap-6 rounded-2xl border border-border bg-card p-4 md:gap-8 md:p-5">
                  <div className="flex-none text-center">
                    <div className="font-display text-[44px] leading-none font-extrabold tracking-tight">
                      {ratingScore}
                    </div>
                    <div className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                      {reviewsCountLabel(reviewsTotal)}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
                    {ratingDistribution.map((row) => (
                      <div
                        key={row.stars}
                        className="flex items-center gap-2.5"
                      >
                        <span className="w-3 flex-none text-right font-mono text-[11px] text-muted-foreground">
                          {row.stars}
                        </span>
                        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-foreground"
                            style={{ width: `${row.percent}%` }}
                          />
                        </div>
                        <span className="w-6 flex-none font-mono text-[11px] text-muted-foreground">
                          {row.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-2 flex flex-col">
                  {reviews.map((review) => (
                    <article
                      key={review.id}
                      className="border-t border-muted py-4 first:border-t-0"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="min-w-0 truncate text-[14px] font-bold">
                          {review.author.name ?? "Klient"}
                        </div>
                        <div className="flex-none font-mono text-[11px] text-muted-foreground">
                          {reviewDateLabel(review.createdAt)}
                        </div>
                      </div>
                      <div className="mt-0.5">
                        <Stars rating={review.rating} />
                      </div>
                      {review.comment ? (
                        <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/80">
                          {review.comment}
                        </p>
                      ) : null}
                      {review.reply ? (
                        <div className="mt-3 ml-4 rounded-r-xl border-l-2 border-border-strong bg-muted/60 py-2.5 pr-3.5 pl-3.5">
                          <div className="flex items-baseline justify-between gap-3">
                            <div className="meta-label">
                              Odpowiedź właściciela
                            </div>
                            {review.repliedAt ? (
                              <div className="flex-none font-mono text-[10px] text-muted-foreground">
                                {reviewDateLabel(review.repliedAt)}
                              </div>
                            ) : null}
                          </div>
                          <p className="mt-1 text-[13px] leading-relaxed text-foreground/80">
                            {review.reply}
                          </p>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
                {reviewsTotal > reviews.length ? (
                  <p className="border-t border-muted pt-4 text-[12.5px] text-muted-foreground">
                    Pokazujemy {reviews.length} najnowszych opinii z{" "}
                    {reviewsTotal}.
                  </p>
                ) : null}
              </>
            )}
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
