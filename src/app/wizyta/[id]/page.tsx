import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { verifyBookingManageToken } from "@/lib/booking-link";
import { SiteHeader } from "@/components/marketplace/site-header";
import {
  formatDateTimeLabel,
  formatPrice,
} from "@/components/marketplace/format";
import { LocaleProvider } from "@/i18n/client";
import { getTranslations } from "@/i18n/server";
import type { MessageKey } from "@/i18n";
import { cancelGuestBookingAction } from "./actions";

/**
 * Strona zarządzania rezerwacją gościa: /wizyta/[id]?t=<podpis>.
 *
 * Gość nie ma konta, więc to jedyne miejsce, w którym może zobaczyć
 * szczegóły wizyty i ją odwołać — link trafia do niego w e-mailu
 * z potwierdzeniem i w przypomnieniu (patrz src/lib/booking-link.ts).
 */

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return {
    title: t("wz.metaTitle"),
    robots: { index: false, follow: false },
  };
}

/** Kod błędu z redirectu server action → klucz komunikatu w słowniku. */
const ERROR_KEYS: Record<string, MessageKey> = {
  INVALID_STATE: "err.INVALID_STATE",
  CUTOFF_PASSED: "err.CUTOFF_PASSED",
  FORBIDDEN: "err.FORBIDDEN",
  NOT_FOUND: "err.NOT_FOUND",
};

const HOUR_MS = 60 * 60 * 1000;

export default async function GuestBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string; blad?: string }>;
}) {
  const { id } = await params;
  const { t: token, blad } = await searchParams;
  const { locale, t } = await getTranslations();
  // „Teraz" ustalone raz, przed renderem (strona jest force-dynamic).
  const now = new Date();

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      startAt: true,
      guestEmail: true,
      customerUserId: true,
      totalPriceCents: true,
      currency: true,
      customerNote: true,
      business: { select: { name: true, slug: true } },
      location: {
        select: {
          addressLine1: true,
          postalCode: true,
          city: true,
          phone: true,
          timezone: true,
          cancellationCutoffHours: true,
        },
      },
      items: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          service: { select: { name: true } },
          resource: { select: { name: true } },
        },
      },
    },
  });

  // Bez ważnego podpisu strona ma nie istnieć — id rezerwacji samo w sobie
  // nie może dawać wglądu w cudze dane.
  if (
    !booking ||
    booking.customerUserId !== null ||
    !booking.guestEmail ||
    !token ||
    !verifyBookingManageToken(booking.id, booking.guestEmail, token)
  ) {
    notFound();
  }

  const { location } = booking;
  const cutoffHours = location.cancellationCutoffHours;
  const canCancel =
    (booking.status === "PENDING" || booking.status === "CONFIRMED") &&
    now.getTime() <= booking.startAt.getTime() - cutoffHours * HOUR_MS;
  const isCancelled =
    booking.status === "CANCELLED_BY_CUSTOMER" ||
    booking.status === "CANCELLED_BY_BUSINESS";

  const rows: { label: string; value: string }[] = [
    {
      label: t("wz.service"),
      value: booking.items.map((item) => item.service.name).join(" + "),
    },
    {
      label: t("wz.staff"),
      value: [
        ...new Set(booking.items.map((item) => item.resource.name)),
      ].join(", "),
    },
    {
      label: t("wz.term"),
      value: formatDateTimeLabel(booking.startAt, location.timezone, locale),
    },
    {
      label: t("wz.place"),
      value: `${booking.business.name}, ${location.addressLine1}, ${location.postalCode} ${location.city}`,
    },
    {
      label: t("wz.price"),
      value: formatPrice(booking.totalPriceCents, booking.currency, locale),
    },
  ];

  return (
    // LocaleProvider jak na pozostałych stronach publicznych — bez niego
    // kliencki LocaleSwitcher w nagłówku czyta domyślne "pl" i przy cookie
    // EN podświetla zły język, a klik w „PL" jest no-opem.
    <LocaleProvider locale={locale}>
      <SiteHeader showAuth={false} locale={locale} />
      <main className="mx-auto w-full max-w-md px-5 pt-6 pb-16 lg:pt-10">
        <div className="meta-label">{t("wz.label")}</div>
        <h1 className="mt-1.5 mb-4 font-display text-[30px] leading-none font-extrabold tracking-tight">
          {isCancelled ? t("wz.cancelledTitle") : t("wz.confirmedTitle")}
        </h1>

        {blad && ERROR_KEYS[blad] ? (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[12.5px] font-medium text-destructive"
          >
            {t(ERROR_KEYS[blad])}
          </p>
        ) : null}

        <div className="rounded-2xl border-[1.5px] border-border-strong bg-card p-4 md:p-5">
          <dl className="flex flex-col gap-2.5">
            {rows.map((row) => (
              <div key={row.label} className="flex items-baseline gap-3">
                <dt className="meta-label w-24 flex-none">{row.label}</dt>
                <dd className="min-w-0 flex-1 text-[13px] font-semibold">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>

          {canCancel ? (
            <form action={cancelGuestBookingAction} className="mt-5">
              <input type="hidden" name="bookingId" value={booking.id} />
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-destructive/30 bg-card px-4 text-[13px] font-semibold text-destructive transition-colors hover:bg-destructive/10"
              >
                {t("wz.cancelCta")}
              </button>
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                {t("wz.freeUntil", { hours: cutoffHours })}
              </p>
            </form>
          ) : (
            <p className="mt-5 text-[12.5px] leading-relaxed text-muted-foreground">
              {isCancelled
                ? t("wz.alreadyCancelled")
                : t("wz.cannotCancel", { hours: cutoffHours })}
              {location.phone
                ? t("wz.callQuestions", { phone: location.phone })
                : ""}
            </p>
          )}
        </div>

        <Link
          href={`/b/${booking.business.slug}`}
          className="mt-5 inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/80"
        >
          {isCancelled ? t("wz.bookNew") : t("wz.seeProfile")}
        </Link>
      </main>
    </LocaleProvider>
  );
}
