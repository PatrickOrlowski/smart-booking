import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";
import type { BookingStatus } from "@/generated/prisma/enums";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { SiteHeader } from "@/components/marketplace/site-header";
import { ratingFromAggregate } from "@/components/marketplace/business-card";
import {
  formatDateTimeLabel,
  formatPrice,
} from "@/components/marketplace/format";
import { UserMenu } from "@/components/auth/user-menu";
import {
  PACKAGE_STATUS_CLASSES,
  effectivePackageStatus,
  entriesLeft,
  expireCustomerPackages,
} from "@/lib/packages";
import { CancelBookingDialog } from "@/components/konto/cancel-booking-dialog";
import { PushToggle } from "@/components/konto/push-toggle";
import { ReviewForm } from "@/components/konto/review-form";
import { env } from "@/lib/env";
import { isPushEnabled } from "@/lib/push";
import { LocaleProvider } from "@/i18n/client";
import { getTranslations } from "@/i18n/server";
import { INTL_LOCALE, type Translations } from "@/i18n";
import { removeFavoriteAction } from "./actions";
import {
  OPEN_BOOKING_STATUSES,
  TERMINAL_BOOKING_STATUSES,
  isReviewable,
} from "./booking-status";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return { title: t("konto.metaTitle") };
}

// Listy zależą od sesji i od „teraz" — strona zawsze dynamiczna.
export const dynamic = "force-dynamic";

const STATUS_BADGE_CLASSES: Record<BookingStatus, string> = {
  PENDING: "bg-warning-soft text-warning-strong",
  CONFIRMED: "bg-success-soft text-success",
  COMPLETED: "bg-secondary text-foreground/70",
  CANCELLED_BY_CUSTOMER: "bg-muted text-muted-foreground",
  CANCELLED_BY_BUSINESS: "bg-destructive/10 text-destructive",
  NO_SHOW: "bg-destructive/10 text-destructive",
};

const bookingSelect = {
  id: true,
  status: true,
  startAt: true,
  endAt: true,
  totalPriceCents: true,
  currency: true,
  business: { select: { name: true, slug: true } },
  location: {
    select: { timezone: true, cancellationCutoffHours: true },
  },
  items: {
    orderBy: { sortOrder: "asc" as const },
    select: {
      id: true,
      serviceId: true,
      service: { select: { name: true } },
      resource: { select: { name: true } },
    },
  },
  review: { select: { rating: true, comment: true, reply: true } },
};

type KontoBooking = {
  id: string;
  status: BookingStatus;
  startAt: Date;
  endAt: Date;
  totalPriceCents: number;
  currency: string;
  business: { name: string; slug: string };
  location: { timezone: string; cancellationCutoffHours: number };
  items: {
    id: string;
    serviceId: string;
    service: { name: string };
    resource: { name: string };
  }[];
  review: { rating: number; comment: string | null; reply: string | null } | null;
};

const tabTriggerClass =
  "flex-none px-0 text-[13px] font-medium text-[#8f8b81] data-active:font-bold data-active:text-foreground rounded-none border-0 pb-2 after:bottom-0 after:h-[2.5px]";

function StatusBadge({
  status,
  t,
}: {
  status: BookingStatus;
  t: Translations["t"];
}) {
  return (
    <span
      className={cn(
        "inline-flex h-auto flex-none items-center rounded-md px-2 py-1 font-mono text-[10px] tracking-wide",
        STATUS_BADGE_CLASSES[status],
      )}
    >
      {t(`konto.status.${status}`)}
    </span>
  );
}

function Stars({ rating, label }: { rating: number; label: string }) {
  return (
    <span aria-label={label} className="font-mono text-[14px] tracking-[0.1em]">
      {[1, 2, 3, 4, 5].map((value) => (
        <span
          key={value}
          aria-hidden
          className={value <= rating ? "text-warning" : "text-border-strong/30"}
        >
          ★
        </span>
      ))}
    </span>
  );
}

/** Wspólny szkielet karty wizyty: firma, usługa, pracownik, termin, cena. */
function BookingSummary({
  booking,
  tr,
}: {
  booking: KontoBooking;
  tr: Translations;
}) {
  const { locale, t } = tr;
  const serviceNames = booking.items
    .map((item) => item.service.name)
    .join(" + ");
  const staffNames = [
    ...new Set(booking.items.map((item) => item.resource.name)),
  ].join(", ");

  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <Link
          href={`/b/${booking.business.slug}`}
          className="font-display text-[17px] leading-tight font-bold tracking-tight transition-colors hover:text-primary"
        >
          {booking.business.name}
        </Link>
        <StatusBadge status={booking.status} t={t} />
      </div>
      <div className="mt-1 text-[13px] text-foreground/80">
        {serviceNames || t("konto.serviceFallback")}
        {staffNames ? (
          <span className="text-muted-foreground">{` · ${staffNames}`}</span>
        ) : null}
      </div>
      <div className="mt-1.5 font-mono text-[12.5px] text-muted-foreground">
        {formatDateTimeLabel(booking.startAt, booking.location.timezone, locale)}{" "}
        · {formatPrice(booking.totalPriceCents, booking.currency, locale)}
      </div>
    </div>
  );
}

function EmptyState({
  title,
  description,
  cta,
}: {
  title: string;
  description: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-border bg-card px-6 py-12 text-center">
      <h2 className="font-display text-[24px] leading-tight font-extrabold tracking-tight">
        {title}
      </h2>
      <p className="mx-auto mt-2 max-w-[280px] text-[13px] leading-relaxed text-muted-foreground">
        {description}
      </p>
      {cta ? (
        <Link
          href={cta.href}
          className="mt-5 inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/80"
        >
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}

export default async function KontoPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const tr = await getTranslations();
  const { locale, t, tp } = tr;

  const userId = session.user.id;
  const now = new Date();

  // Karnet wygasa samym upływem czasu — domykamy status przed listowaniem,
  // żeby konto klienta i panel firmy pokazywały to samo.
  await expireCustomerPackages(prisma, { customerUserId: userId }, now);

  const [upcoming, past, favorites, packages] = await Promise.all([
    prisma.booking.findMany({
      where: {
        customerUserId: userId,
        status: { in: [...OPEN_BOOKING_STATUSES] },
        startAt: { gt: now },
      },
      orderBy: { startAt: "asc" },
      select: bookingSelect,
    }),
    prisma.booking.findMany({
      // MINIONE musi być dopełnieniem NADCHODZĄCYCH: wizyta CONFIRMED,
      // której nikt nie oznaczył ręcznie jako COMPLETED, po godzinie startu
      // wypadała z obu list i znikała klientowi z konta.
      where: {
        customerUserId: userId,
        OR: [
          { status: { in: [...TERMINAL_BOOKING_STATUSES] } },
          {
            status: { in: [...OPEN_BOOKING_STATUSES] },
            startAt: { lte: now },
          },
        ],
      },
      orderBy: { startAt: "desc" },
      take: 30,
      select: bookingSelect,
    }),
    prisma.favorite.findMany({
      // Zawieszona firma nie ma publicznego profilu — karta prowadziłaby na 404.
      where: { userId, business: { status: "ACTIVE" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        businessId: true,
        business: {
          select: {
            name: true,
            slug: true,
            locations: {
              where: { isActive: true },
              take: 1,
              select: { addressLine1: true, city: true },
            },
          },
        },
      },
    }),
    prisma.customerPackage.findMany({
      where: { customer: { userId } },
      orderBy: [{ status: "asc" }, { expiresAt: "asc" }],
      select: {
        id: true,
        status: true,
        entriesTotal: true,
        entriesUsed: true,
        expiresAt: true,
        business: {
          select: {
            name: true,
            slug: true,
            // Ważność karnetu pokazujemy w strefie lokalu, nie przeglądarki.
            locations: {
              take: 1,
              orderBy: { createdAt: "asc" },
              select: { timezone: true },
            },
          },
        },
        package: {
          select: { name: true, service: { select: { name: true } } },
        },
      },
    }),
  ]);

  // Ocena ulubionych z agregatu — wcześniej strona ściągała komplet opinii
  // każdej firmy tylko po to, żeby wypisać jedną liczbę.
  const favoriteRatings = await prisma.review.groupBy({
    by: ["businessId"],
    where: {
      isPublished: true,
      businessId: { in: favorites.map((favorite) => favorite.businessId) },
    },
    _avg: { rating: true },
    _count: { _all: true },
  });
  const ratingByBusiness = new Map(
    favoriteRatings.map((row) => [row.businessId, row]),
  );

  const firstName = session.user.name?.trim().split(/\s+/)[0] ?? null;

  return (
    <LocaleProvider locale={locale}>
      <SiteHeader locale={locale} />
      <main className="mx-auto w-full max-w-md px-5 pt-4 pb-16 md:max-w-2xl lg:max-w-3xl lg:pt-8">
        {/* Telefon/tablet: site-header jest ukryty — logo i menu użytkownika
            (z wylogowaniem) muszą być dostępne w obrębie strony. */}
        <div className="mb-5 flex items-center justify-between lg:hidden">
          <Link
            href="/"
            className="font-display text-lg font-extrabold tracking-tight"
          >
            Planner
          </Link>
          <UserMenu
            locale={locale}
            user={{
              name: session.user.name,
              email: session.user.email,
              role: session.user.role,
            }}
          />
        </div>

        <div className="meta-label">{t("konto.accountLabel")}</div>
        <h1 className="mt-1.5 font-display text-[30px] leading-none font-extrabold tracking-tight md:text-[36px]">
          {firstName ? t("konto.hi", { name: firstName }) : t("konto.hiNoName")}
        </h1>

        <Tabs defaultValue="nadchodzace" className="mt-6">
          <TabsList
            variant="line"
            className="h-auto w-full justify-start gap-5 overflow-x-auto rounded-none border-b border-[#e2ddd2] p-0"
          >
            <TabsTrigger value="nadchodzace" className={tabTriggerClass}>
              {t("konto.tab.upcoming")}
              <span className="font-mono text-[11px] font-normal text-muted-foreground">
                {upcoming.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="minione" className={tabTriggerClass}>
              {t("konto.tab.past")}
              <span className="font-mono text-[11px] font-normal text-muted-foreground">
                {past.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="karnety" className={tabTriggerClass}>
              {t("konto.tab.packages")}
              <span className="font-mono text-[11px] font-normal text-muted-foreground">
                {packages.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="ulubione" className={tabTriggerClass}>
              {t("konto.tab.favorites")}
              <span className="font-mono text-[11px] font-normal text-muted-foreground">
                {favorites.length}
              </span>
            </TabsTrigger>
          </TabsList>

          {/* NADCHODZĄCE */}
          <TabsContent value="nadchodzace" className="mt-5">
            {upcoming.length === 0 ? (
              <EmptyState
                title={t("konto.empty.upcomingTitle")}
                description={t("konto.empty.upcomingText")}
                cta={{ href: "/", label: t("konto.empty.upcomingCta") }}
              />
            ) : (
              <div className="flex flex-col gap-3">
                {upcoming.map((booking) => (
                  <article
                    key={booking.id}
                    className="rounded-2xl border-[1.5px] border-border-strong bg-card p-4 md:p-5"
                  >
                    <div className="md:flex md:items-start md:justify-between md:gap-4">
                      <BookingSummary booking={booking} tr={tr} />
                      <div className="mt-3 flex flex-col gap-1.5 md:mt-0 md:flex-none md:items-end">
                        <CancelBookingDialog
                          bookingId={booking.id}
                          businessName={booking.business.name}
                          dateLabel={formatDateTimeLabel(
                            booking.startAt,
                            booking.location.timezone,
                            locale,
                          )}
                          cutoffHours={booking.location.cancellationCutoffHours}
                        />
                        <span className="font-mono text-[10.5px] text-muted-foreground md:text-right">
                          {t("konto.cancelFreeUntil", {
                            hours: booking.location.cancellationCutoffHours,
                          })}
                        </span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </TabsContent>

          {/* MINIONE */}
          <TabsContent value="minione" className="mt-5">
            {past.length === 0 ? (
              <EmptyState
                title={t("konto.empty.pastTitle")}
                description={t("konto.empty.pastText")}
              />
            ) : (
              <div className="flex flex-col gap-3">
                {past.map((booking) => {
                  const rebookHref = booking.items[0]
                    ? `/b/${booking.business.slug}/rezerwacja?serviceId=${booking.items[0].serviceId}`
                    : `/b/${booking.business.slug}`;
                  return (
                    <article
                      key={booking.id}
                      className="rounded-2xl border border-border bg-card p-4 md:p-5"
                    >
                      <div className="md:flex md:items-start md:justify-between md:gap-4">
                        <BookingSummary booking={booking} tr={tr} />
                        <Link
                          href={rebookHref}
                          className="mt-3 inline-flex min-h-11 flex-none items-center justify-center rounded-full border-[1.5px] border-border-strong bg-card px-4 text-[13px] font-semibold transition-colors hover:bg-muted md:mt-0"
                        >
                          {t("konto.rebook")}
                        </Link>
                      </div>

                      {isReviewable(booking, now) ? (
                        booking.review ? (
                          <div className="mt-3 rounded-xl border border-border bg-background/60 p-3.5">
                            <div className="flex items-center gap-2">
                              <Stars
                                rating={booking.review.rating}
                                label={t("konto.ratingAria", {
                                  rating: booking.review.rating,
                                })}
                              />
                              <span className="meta-label">
                                {t("konto.yourReview")}
                              </span>
                            </div>
                            {booking.review.comment ? (
                              <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/80">
                                {booking.review.comment}
                              </p>
                            ) : null}
                            {booking.review.reply ? (
                              <div className="mt-2.5 rounded-lg bg-muted px-3 py-2.5">
                                <div className="meta-label">
                                  {t("konto.businessReply")}
                                </div>
                                <p className="mt-1 text-[12.5px] leading-relaxed text-foreground/80">
                                  {booking.review.reply}
                                </p>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <ReviewForm bookingId={booking.id} />
                        )
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* MOJE KARNETY */}
          <TabsContent value="karnety" className="mt-5">
            {packages.length === 0 ? (
              <EmptyState
                title={t("konto.empty.packagesTitle")}
                description={t("konto.empty.packagesText")}
                cta={{ href: "/", label: t("konto.empty.packagesCta") }}
              />
            ) : (
              <div className="flex flex-col gap-3 md:grid md:grid-cols-2 md:gap-4">
                {packages.map((entry) => {
                  const status = effectivePackageStatus(entry, now);
                  const left = entriesLeft(entry);
                  const timezone =
                    entry.business.locations[0]?.timezone ?? "Europe/Warsaw";
                  const expiresLabel = new Intl.DateTimeFormat(
                    INTL_LOCALE[locale],
                    {
                      timeZone: timezone,
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    },
                  ).format(entry.expiresAt);
                  return (
                    <article
                      key={entry.id}
                      className={cn(
                        "rounded-2xl border bg-card p-4 md:p-5",
                        status === "ACTIVE"
                          ? "border-[1.5px] border-border-strong"
                          : "border-border opacity-70",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-display text-[17px] leading-tight font-bold tracking-tight">
                            {entry.package.name}
                          </div>
                          <Link
                            href={`/b/${entry.business.slug}`}
                            className="mt-0.5 block truncate text-[13px] text-muted-foreground transition-colors hover:text-primary"
                          >
                            {entry.business.name}
                          </Link>
                        </div>
                        <span
                          className={cn(
                            "inline-flex flex-none items-center rounded-md px-2 py-1 font-mono text-[10px] tracking-wide uppercase",
                            PACKAGE_STATUS_CLASSES[status],
                          )}
                        >
                          {t(`konto.package.status.${status}`)}
                        </span>
                      </div>

                      <div className="mt-3 flex items-baseline gap-2">
                        <span className="font-display text-[30px] leading-none font-extrabold tracking-tight">
                          {left}
                        </span>
                        <span className="font-mono text-[12px] text-muted-foreground">
                          {tp("konto.package.left", entry.entriesTotal, {
                            total: entry.entriesTotal,
                          })}
                        </span>
                      </div>

                      {/* Pasek wykorzystania — czytelny na każdym rozmiarze */}
                      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{
                            width: `${Math.round((entry.entriesUsed / Math.max(1, entry.entriesTotal)) * 100)}%`,
                          }}
                        />
                      </div>

                      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
                        <span>
                          {t("konto.package.validUntil", { date: expiresLabel })}
                        </span>
                        <span>
                          {entry.package.service?.name ??
                            t("konto.package.anyService")}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ULUBIONE */}
          <TabsContent value="ulubione" className="mt-5">
            {favorites.length === 0 ? (
              <EmptyState
                title={t("konto.empty.favoritesTitle")}
                description={t("konto.empty.favoritesText")}
                cta={{ href: "/", label: t("konto.empty.favoritesCta") }}
              />
            ) : (
              <div className="flex flex-col gap-3 md:grid md:grid-cols-2 md:gap-4">
                {favorites.map((favorite) => {
                  const location = favorite.business.locations[0];
                  // Ta sama formuła oceny co na kartach listingu — bez niej
                  // ulubione pokazywałyby inną liczbę niż wyszukiwarka.
                  const aggregate = ratingByBusiness.get(favorite.businessId);
                  const rating = ratingFromAggregate(
                    aggregate?._avg.rating ?? null,
                    aggregate?._count._all ?? 0,
                    locale,
                  );
                  return (
                    <article
                      key={favorite.id}
                      className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
                    >
                      <Link
                        href={`/b/${favorite.business.slug}`}
                        className="min-w-0 flex-1"
                      >
                        <div className="truncate font-display text-base font-bold tracking-tight">
                          {favorite.business.name}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {location
                            ? `${location.addressLine1}, ${location.city} · `
                            : ""}
                          <span className="font-mono">
                            {rating.score} ★ ({rating.count})
                          </span>
                        </div>
                      </Link>
                      <form action={removeFavoriteAction} className="contents">
                        <input
                          type="hidden"
                          name="favoriteId"
                          value={favorite.id}
                        />
                        <button
                          type="submit"
                          aria-label={t("konto.removeFavoriteAria", {
                            name: favorite.business.name,
                          })}
                          title={t("konto.removeFavoriteTitle")}
                          className="flex size-11 flex-none cursor-pointer items-center justify-center rounded-full border border-border text-[18px] text-destructive transition-colors hover:bg-destructive/10"
                        >
                          ♥
                        </button>
                      </form>
                    </article>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* POWIADOMIENIA — web push per urządzenie. Bez kluczy VAPID sekcja
            pokazuje dopisek „wkrótce" zamiast przełącznika. */}
        <section className="mt-10">
          <div className="meta-label">{t("konto.notif.label")}</div>
          <div className="mt-3">
            <PushToggle
              configured={isPushEnabled()}
              vapidPublicKey={env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
            />
          </div>
        </section>
      </main>
    </LocaleProvider>
  );
}
