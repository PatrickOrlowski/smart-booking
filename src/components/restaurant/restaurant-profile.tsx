import Link from "next/link";
import { MapPin, Phone, Users } from "lucide-react";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/authz";
import {
  getTableAvailabilityRange,
  type RestaurantContext,
} from "@/lib/restaurant-data";
import { addLocalDays, isoDateToLocalDate } from "@/lib/availability";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { FavoriteButton } from "@/components/marketplace/favorite-button";
import { OpeningHoursList } from "@/components/marketplace/opening-hours-list";
import { ReviewsSection } from "@/components/marketplace/reviews-section";
import { SiteFooter } from "@/components/marketplace/site-footer";
import { SiteHeader } from "@/components/marketplace/site-header";
import { formatTimeInZone, openStatus } from "@/components/marketplace/format";
import { INTL_LOCALE } from "@/i18n";
import { LocaleProvider } from "@/i18n/client";
import { getTranslations } from "@/i18n/server";
import { AreaIcon } from "./area-icon";
import {
  guestAreaHint,
  guestAreaLabel,
  localIsoDate,
  relativeDayLabel,
  turnTimeLabel,
} from "./format";
import { ReservationWidget } from "./reservation-widget";
import { serializeSlot, toBookingData } from "./serialize";
import type { AvailabilityResponse } from "./types";

/**
 * Publiczny profil restauracji — gałąź `/b/[slug]` dla firm typu RESTAURANT.
 *
 * Zamiast cennika usług centralnym elementem jest rezerwacja stolika: liczba
 * osób, dzień i najbliższe godziny. Usługa techniczna `TABLE_RESERVATION`
 * nigdzie się nie pokazuje jako pozycja cennika — nośnikiem rezerwacji jest
 * `partySize`, nie wybór usługi.
 *
 * Dane liczymy WPROST z `restaurant-data.ts` (żadnego fetcha po HTTP z server
 * componentu): jeden przebieg silnika na 7 dni obsługuje i pastylkę
 * „najbliższy stolik", i pierwszy render widgetu rezerwacji.
 */

/** Ile opinii renderujemy (reszta liczy się tylko do średniej). */
const REVIEWS_VISIBLE = 20;
/** Domyślna liczba osób — dwójka to modalna rezerwacja restauracyjna. */
const DEFAULT_PARTY_SIZE = 2;
/** Horyzont podpowiedzi „najbliższy wolny stolik". */
const LOOKAHEAD_DAYS = 7;

const SCHEMA_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const minutesToHHMM = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const tabTriggerClass =
  "flex-none px-0 text-[13px] font-medium text-[#8f8b81] data-active:font-bold data-active:text-foreground rounded-none border-0 pb-2 after:bottom-0 after:h-[2.5px]";

/**
 * Kontekst restauracji przychodzi z `/b/[slug]` — strona i tak musi go
 * policzyć, żeby wiedzieć, czy lokal ma komplet konfiguracji do rezerwacji
 * stolika (bez niej spada do profilu ogólnego zamiast dawać 404).
 */
export async function RestaurantProfile({
  slug,
  context,
}: {
  slug: string;
  context: RestaurantContext;
}) {
  const { business, location } = context;
  const { locale, t, tp } = await getTranslations();
  const now = new Date();
  const todayIso = localIsoDate(now, location.timezone);
  const today = isoDateToLocalDate(todayIso);

  const [user, ratingGroups, reviews, availability] = await Promise.all([
    getCurrentUser().catch(() => null),
    prisma.review.groupBy({
      by: ["rating"],
      where: { businessId: business.id, isPublished: true },
      _count: { _all: true },
    }),
    prisma.review.findMany({
      where: { businessId: business.id, isPublished: true },
      orderBy: { createdAt: "desc" },
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
    }),
    today
      ? getTableAvailabilityRange({
          slug,
          context,
          dateFrom: today,
          dateTo: addLocalDays(today, LOOKAHEAD_DAYS - 1),
          partySize: DEFAULT_PARTY_SIZE,
          now,
        })
      : null,
  ]);

  const isFavorite = user
    ? (await prisma.favorite.findUnique({
        where: {
          userId_businessId: { userId: user.id, businessId: business.id },
        },
        select: { id: true },
      })) !== null
    : false;

  const status = openStatus(
    location.openingHours,
    location.timezone,
    locale,
    now,
  );

  // Rozkład ocen i średnia z agregatu po WSZYSTKICH opublikowanych opiniach.
  const decimalSeparator = locale === "pl" ? "," : ".";
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
    averageRating === null
      ? `5${decimalSeparator}0`
      : averageRating.toFixed(1).replace(".", decimalSeparator);
  const ratingDistribution = [5, 4, 3, 2, 1].map((stars) => {
    const count =
      ratingGroups.find((group) => group.rating === stars)?._count._all ?? 0;
    return {
      stars,
      count,
      percent: reviewsTotal === 0 ? 0 : Math.round((count / reviewsTotal) * 100),
    };
  });

  const firstDay = availability?.days[0];
  const initialAvailability: AvailabilityResponse = {
    date: todayIso,
    partySize: DEFAULT_PARTY_SIZE,
    timezone: location.timezone,
    durationMin: firstDay?.durationMin ?? location.defaultTurnTimeMin,
    maxPartySizeOnline: location.maxPartySizeOnline,
    waitlistEnabled: location.waitlistEnabled,
    areas: context.areas,
    slots: (firstDay?.slots ?? []).map(serializeSlot),
  };

  // Najbliższy wolny stolik w horyzoncie tygodnia — pastylka w sticky karcie.
  const nearest = availability?.days.flatMap((day) => day.slots)[0] ?? null;

  // Strefy lokalu z liczbą stolików — „Sala · 12 stolików · do 48 miejsc".
  const areaCards = context.areas.map((area) => {
    const tables = context.tables.filter((table) => table.area === area);
    // Nazwa sali bywa tożsama z nazwą strefy („Taras" w strefie OUTDOOR) —
    // wtedy nie powtarzamy jej pod nagłówkiem, tylko dajemy podpowiedź.
    // Porównujemy z etykietą polską (język danych właściciela) ORAZ aktywną.
    const areaNames = new Set(
      [guestAreaLabel(area, "pl"), guestAreaLabel(area, locale)].map((name) =>
        name.toLowerCase(),
      ),
    );
    const rooms = [
      ...new Set(
        tables
          .map(
            (table) =>
              context.rooms.find((room) => room.id === table.roomId)?.name,
          )
          .filter((name): name is string => name !== undefined)
          .filter((name) => !areaNames.has(name.toLowerCase())),
      ),
    ];
    return {
      area,
      tables: tables.length,
      seats: tables.reduce((sum, table) => sum + table.capacityMax, 0),
      rooms,
    };
  });

  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const profileUrl = `${appUrl}/b/${business.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: business.name,
    url: profileUrl,
    ...(business.description ? { description: business.description } : {}),
    acceptsReservations: `${profileUrl}/stolik`,
    address: {
      "@type": "PostalAddress",
      streetAddress: location.addressLine1,
      addressLocality: location.city,
      postalCode: location.postalCode,
      // Kontekst restauracji nie niesie kraju — marketplace jest na razie
      // wyłącznie polski, a osobne zapytanie po jedno pole byłoby przesadą.
      addressCountry: "PL",
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
    potentialAction: {
      "@type": "ReserveAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${profileUrl}/stolik`,
        inLanguage: INTL_LOCALE[locale],
      },
      result: {
        "@type": "FoodEstablishmentReservation",
        name: t("rest.jsonLdReservation"),
      },
    },
  };

  // Widget na profilu nie zbiera danych gościa (robi to dopiero flow), więc
  // nie ma po co ciągnąć profilu użytkownika.
  const bookingData = toBookingData(context, null, now);

  const nearestLabel = nearest
    ? `${relativeDayLabel(nearest.startAt, location.timezone, locale, now)} ${formatTimeInZone(nearest.startAt, location.timezone)}`
    : null;

  return (
    <LocaleProvider locale={locale}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <SiteHeader locale={locale} />
      <main className="mx-auto w-full max-w-md pb-16 md:max-w-3xl md:px-5 lg:max-w-6xl lg:px-8 lg:pt-6">
        <div className="mb-5 hidden lg:block">
          <Link
            href="/"
            className="text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            ← {t("profile.backResults")}
          </Link>
        </div>

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-12">
          <div className="min-w-0">
            <div className="photo-placeholder relative flex h-[180px] items-center justify-center font-mono text-[10px] tracking-[0.08em] text-[#8f8b81] md:mt-5 md:h-[240px] md:rounded-2xl lg:mt-0 lg:h-[280px]">
              {t("rest.galleryInterior")}
              <Link
                href="/"
                aria-label={t("profile.backToSearch")}
                className="absolute top-3 left-3.5 flex size-[34px] items-center justify-center rounded-full border-[1.5px] border-border-strong bg-card text-sm lg:hidden"
              >
                ←
              </Link>
            </div>
            <div className="mt-2 hidden gap-2 px-5 md:grid md:grid-cols-3 md:px-0">
              {[
                t("rest.tile.room"),
                t("rest.tile.terrace"),
                t("rest.tile.kitchen"),
              ].map((tile) => (
                <div
                  key={tile}
                  className="photo-placeholder flex h-20 items-center justify-center rounded-xl font-mono text-[10px] tracking-[0.08em] text-[#8f8b81]"
                >
                  {tile}
                </div>
              ))}
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
                    status.isOpen
                      ? "font-semibold text-success"
                      : "font-semibold"
                  }
                >
                  {status.label}
                </span>
              </div>

              <Tabs
                defaultValue="rezerwacja"
                id="rezerwacja"
                className="mt-4 scroll-mt-6"
              >
                <TabsList
                  variant="line"
                  className="h-auto w-full justify-start gap-5 rounded-none border-b border-[#e2ddd2] p-0"
                >
                  <TabsTrigger value="rezerwacja" className={tabTriggerClass}>
                    {t("rest.tab.booking")}
                  </TabsTrigger>
                  <TabsTrigger value="opinie" className={tabTriggerClass}>
                    {t("profile.tab.reviews")}
                  </TabsTrigger>
                  <TabsTrigger value="info" className={tabTriggerClass}>
                    {t("profile.tab.info")}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="rezerwacja">
                  {business.description ? (
                    <p className="mt-5 text-[13px] leading-relaxed text-foreground/80">
                      {business.description}
                    </p>
                  ) : null}

                  <ReservationWidget
                    data={bookingData}
                    initial={{
                      date: todayIso,
                      partySize: DEFAULT_PARTY_SIZE,
                      data: initialAvailability,
                    }}
                  />

                  <section className="mt-6">
                    <div className="meta-label mb-2">{t("rest.zones")}</div>
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {areaCards.map((card) => (
                        <div
                          key={card.area}
                          className="flex items-start gap-3 rounded-2xl border border-border bg-card p-[13px]"
                        >
                          <span className="flex size-9 flex-none items-center justify-center rounded-full bg-accent text-primary dark:text-accent-foreground">
                            <AreaIcon area={card.area} />
                          </span>
                          <div className="min-w-0">
                            <div className="text-[14px] font-bold">
                              {guestAreaLabel(card.area, locale)}
                            </div>
                            <div className="mt-0.5 text-[12px] text-muted-foreground">
                              {card.rooms.join(", ") ||
                                guestAreaHint(card.area, locale)}
                            </div>
                            <div className="mt-1 font-mono text-[11px] text-[#8f8b81]">
                              {tp("plural.tables", card.tables)} ·{" "}
                              {t("rest.upToSeats", { seats: card.seats })}
                            </div>
                          </div>
                        </div>
                      ))}
                      {areaCards.length === 0 ? (
                        <p className="text-[13px] text-muted-foreground">
                          {t("rest.floorPlanEmpty")}
                        </p>
                      ) : null}
                    </div>
                  </section>

                  <section className="mt-6 rounded-2xl border border-border bg-card p-4">
                    <div className="meta-label mb-2">{t("rest.howWeBook")}</div>
                    <ul className="flex flex-col gap-2 text-[12.5px] leading-relaxed text-foreground/80">
                      <li className="flex gap-2">
                        <Users
                          aria-hidden
                          className="mt-0.5 size-4 flex-none text-muted-foreground"
                        />
                        <span>{t("rest.how1")}</span>
                      </li>
                      <li className="flex gap-2">
                        <MapPin
                          aria-hidden
                          className="mt-0.5 size-4 flex-none text-muted-foreground"
                        />
                        <span>{t("rest.how2")}</span>
                      </li>
                      <li className="flex gap-2">
                        <Phone
                          aria-hidden
                          className="mt-0.5 size-4 flex-none text-muted-foreground"
                        />
                        <span>
                          {t("rest.how3", {
                            max:
                              location.maxPartySizeOnline ??
                              t("rest.onlineLimit"),
                          })}
                        </span>
                      </li>
                    </ul>
                  </section>
                </TabsContent>

                <TabsContent value="opinie">
                  <ReviewsSection
                    reviews={reviews}
                    total={reviewsTotal}
                    ratingScore={ratingScore}
                    distribution={ratingDistribution}
                    timezone={location.timezone}
                    locale={locale}
                    emptyText={t("reviews.emptyTextRestaurant")}
                  />
                </TabsContent>

                <TabsContent value="info">
                  <div className="mt-5 flex flex-col gap-4">
                    {business.description ? (
                      <p className="text-[13px] leading-relaxed text-foreground/80">
                        {business.description}
                      </p>
                    ) : null}

                    <div className="overflow-hidden rounded-2xl border border-border bg-card">
                      <div className="photo-placeholder flex h-[140px] items-center justify-center font-mono text-[10px] tracking-[0.08em] text-[#8f8b81]">
                        {t("rest.map")}
                      </div>
                      <div className="p-4">
                        <div className="meta-label mb-2">
                          {t("profile.address")}
                        </div>
                        <div className="text-sm font-semibold">
                          {location.addressLine1}
                        </div>
                        <div className="text-[13px] text-muted-foreground">
                          {location.postalCode} {location.city}
                        </div>
                        {location.phone ? (
                          <a
                            href={`tel:${location.phone.replace(/\s/g, "")}`}
                            className="mt-2.5 flex min-h-11 w-full items-center justify-center gap-2 rounded-full border-[1.5px] border-border-strong bg-card text-[13px] font-semibold"
                          >
                            <Phone aria-hidden className="size-4" />
                            {location.phone}
                          </a>
                        ) : null}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border bg-card p-4">
                      <div className="meta-label mb-2">
                        {t("profile.openingHours")}
                      </div>
                      <OpeningHoursList
                        openingHours={location.openingHours}
                        locale={locale}
                      />
                    </div>

                    <div className="rounded-2xl border border-border bg-card p-4">
                      <div className="mb-1.5 text-xs font-bold">
                        {t("profile.cancelPolicy")}
                      </div>
                      <p className="text-[11.5px] leading-relaxed text-foreground/80">
                        {t("rest.cancelPolicyText", {
                          hours: location.cancellationCutoffHours,
                          turn: turnTimeLabel(location.defaultTurnTimeMin),
                        })}
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
                  {t("rest.bookTable")}
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

              <div
                className={
                  nearestLabel
                    ? "mt-3.5 flex items-center gap-[7px] rounded-lg border border-success-soft-border bg-success-soft px-2.5 py-1.5"
                    : "mt-3.5 flex items-center gap-[7px] rounded-lg border border-border bg-muted px-2.5 py-1.5"
                }
              >
                {nearestLabel ? (
                  <span className="size-1.5 rounded-full bg-success [animation:pulse-dot_1.8s_infinite]" />
                ) : null}
                <span
                  className={
                    nearestLabel
                      ? "text-xs font-semibold text-primary"
                      : "text-xs font-semibold text-muted-foreground"
                  }
                >
                  {nearestLabel
                    ? t("rest.freeTableFor2", { label: nearestLabel })
                    : t("badge.noneWeek")}
                </span>
              </div>

              <Link
                href={`/b/${business.slug}/stolik`}
                className="mt-4 flex min-h-11 w-full items-center justify-center rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground"
              >
                {t("rest.bookTableCta")}
              </Link>
              <p className="mt-2 text-center text-[11px] text-[#8f8b81]">
                {t("rest.instantHint")}
              </p>

              <div className="my-5 h-px bg-border" />

              <div className="meta-label mb-2">{t("profile.address")}</div>
              <div className="text-sm font-semibold">
                {location.addressLine1}
              </div>
              <div className="text-[13px] text-muted-foreground">
                {location.postalCode} {location.city}
              </div>
              {location.phone ? (
                <div className="mt-1.5 font-mono text-[13px]">
                  {location.phone}
                </div>
              ) : null}

              <div className="meta-label mt-5 mb-2">{t("rest.zonesShort")}</div>
              <div className="flex flex-wrap gap-1.5">
                {context.areas.map((area) => (
                  <span
                    key={area}
                    className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11.5px] font-semibold"
                  >
                    <AreaIcon area={area} className="size-3.5" />
                    {guestAreaLabel(area, locale)}
                  </span>
                ))}
              </div>

              <div className="meta-label mt-5 mb-2">
                {t("profile.openingHours")}
              </div>
              <OpeningHoursList
                openingHours={location.openingHours}
                locale={locale}
              />
            </div>
          </aside>
        </div>
      </main>
      <SiteFooter locale={locale} />
    </LocaleProvider>
  );
}
