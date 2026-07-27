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
import { CancelBookingDialog } from "@/components/konto/cancel-booking-dialog";
import { ReviewForm } from "@/components/konto/review-form";
import { removeFavoriteAction } from "./actions";
import {
  OPEN_BOOKING_STATUSES,
  TERMINAL_BOOKING_STATUSES,
  isReviewable,
} from "./booking-status";

export const metadata: Metadata = {
  title: "Moje wizyty — Planner",
};

// Listy zależą od sesji i od „teraz" — strona zawsze dynamiczna.
export const dynamic = "force-dynamic";

const statusBadge: Record<BookingStatus, { label: string; className: string }> =
  {
    PENDING: { label: "OCZEKUJE", className: "bg-warning-soft text-warning-strong" },
    CONFIRMED: { label: "POTWIERDZONA", className: "bg-success-soft text-success" },
    COMPLETED: { label: "ZAKOŃCZONA", className: "bg-secondary text-foreground/70" },
    CANCELLED_BY_CUSTOMER: { label: "ODWOŁANA", className: "bg-muted text-muted-foreground" },
    CANCELLED_BY_BUSINESS: { label: "ODWOŁANA PRZEZ FIRMĘ", className: "bg-destructive/10 text-destructive" },
    NO_SHOW: { label: "NIEOBECNOŚĆ", className: "bg-destructive/10 text-destructive" },
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

function StatusBadge({ status }: { status: BookingStatus }) {
  const badge = statusBadge[status];
  return (
    <span
      className={cn(
        "inline-flex h-auto flex-none items-center rounded-md px-2 py-1 font-mono text-[10px] tracking-wide",
        badge.className,
      )}
    >
      {badge.label}
    </span>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span
      aria-label={`Ocena ${rating} z 5`}
      className="font-mono text-[14px] tracking-[0.1em]"
    >
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
function BookingSummary({ booking }: { booking: KontoBooking }) {
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
        <StatusBadge status={booking.status} />
      </div>
      <div className="mt-1 text-[13px] text-foreground/80">
        {serviceNames || "Usługa"}
        {staffNames ? (
          <span className="text-muted-foreground">{` · ${staffNames}`}</span>
        ) : null}
      </div>
      <div className="mt-1.5 font-mono text-[12.5px] text-muted-foreground">
        {formatDateTimeLabel(booking.startAt, booking.location.timezone)} ·{" "}
        {formatPrice(booking.totalPriceCents, booking.currency)}
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

  const userId = session.user.id;
  const now = new Date();

  const [upcoming, past, favorites] = await Promise.all([
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
    <>
      <SiteHeader />
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
            user={{
              name: session.user.name,
              email: session.user.email,
              role: session.user.role,
            }}
          />
        </div>

        <div className="meta-label">Twoje konto</div>
        <h1 className="mt-1.5 font-display text-[30px] leading-none font-extrabold tracking-tight md:text-[36px]">
          {firstName ? `Cześć, ${firstName}.` : "Cześć."}
        </h1>

        <Tabs defaultValue="nadchodzace" className="mt-6">
          <TabsList
            variant="line"
            className="h-auto w-full justify-start gap-5 overflow-x-auto rounded-none border-b border-[#e2ddd2] p-0"
          >
            <TabsTrigger value="nadchodzace" className={tabTriggerClass}>
              Nadchodzące
              <span className="font-mono text-[11px] font-normal text-muted-foreground">
                {upcoming.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="minione" className={tabTriggerClass}>
              Minione
              <span className="font-mono text-[11px] font-normal text-muted-foreground">
                {past.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="ulubione" className={tabTriggerClass}>
              Ulubione
              <span className="font-mono text-[11px] font-normal text-muted-foreground">
                {favorites.length}
              </span>
            </TabsTrigger>
          </TabsList>

          {/* NADCHODZĄCE */}
          <TabsContent value="nadchodzace" className="mt-5">
            {upcoming.length === 0 ? (
              <EmptyState
                title="Nic nie zaplanowane."
                description="Nie masz nadchodzących wizyt. Znajdź wolny termin i zarezerwuj online."
                cta={{ href: "/", label: "Znajdź termin" }}
              />
            ) : (
              <div className="flex flex-col gap-3">
                {upcoming.map((booking) => (
                  <article
                    key={booking.id}
                    className="rounded-2xl border-[1.5px] border-border-strong bg-card p-4 md:p-5"
                  >
                    <div className="md:flex md:items-start md:justify-between md:gap-4">
                      <BookingSummary booking={booking} />
                      <div className="mt-3 flex flex-col gap-1.5 md:mt-0 md:flex-none md:items-end">
                        <CancelBookingDialog
                          bookingId={booking.id}
                          businessName={booking.business.name}
                          dateLabel={formatDateTimeLabel(
                            booking.startAt,
                            booking.location.timezone,
                          )}
                          cutoffHours={booking.location.cancellationCutoffHours}
                        />
                        <span className="font-mono text-[10.5px] text-muted-foreground md:text-right">
                          bezpłatnie do{" "}
                          {booking.location.cancellationCutoffHours} h przed
                          wizytą
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
                title="Jeszcze nic tu nie ma."
                description="Historia wizyt pojawi się po pierwszej zakończonej rezerwacji."
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
                        <BookingSummary booking={booking} />
                        <Link
                          href={rebookHref}
                          className="mt-3 inline-flex min-h-11 flex-none items-center justify-center rounded-full border-[1.5px] border-border-strong bg-card px-4 text-[13px] font-semibold transition-colors hover:bg-muted md:mt-0"
                        >
                          Zarezerwuj ponownie
                        </Link>
                      </div>

                      {isReviewable(booking, now) ? (
                        booking.review ? (
                          <div className="mt-3 rounded-xl border border-border bg-background/60 p-3.5">
                            <div className="flex items-center gap-2">
                              <Stars rating={booking.review.rating} />
                              <span className="meta-label">Twoja opinia</span>
                            </div>
                            {booking.review.comment ? (
                              <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/80">
                                {booking.review.comment}
                              </p>
                            ) : null}
                            {booking.review.reply ? (
                              <div className="mt-2.5 rounded-lg bg-muted px-3 py-2.5">
                                <div className="meta-label">
                                  Odpowiedź firmy
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

          {/* ULUBIONE */}
          <TabsContent value="ulubione" className="mt-5">
            {favorites.length === 0 ? (
              <EmptyState
                title="Brak ulubionych."
                description="Zapisuj firmy serduszkiem, żeby mieć je zawsze pod ręką."
                cta={{ href: "/", label: "Przeglądaj firmy" }}
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
                          aria-label={`Usuń ${favorite.business.name} z ulubionych`}
                          title="Usuń z ulubionych"
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
      </main>
    </>
  );
}
