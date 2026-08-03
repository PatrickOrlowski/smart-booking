import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { utcToZonedWallClock } from "@/lib/time";
import { weekdaysShort } from "@/components/marketplace/format";
import { LocaleProvider } from "@/i18n/client";
import { getTranslations } from "@/i18n/server";
import { WidgetFlow, type WidgetDay, type WidgetService } from "./widget-flow";

/** Dostępność zależy od „teraz" — bez cache. */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const [{ t }, business] = await Promise.all([
    getTranslations(),
    prisma.business.findFirst({
      where: { slug, status: "ACTIVE" },
      select: { name: true },
    }),
  ]);
  return {
    title: business
      ? t("wg.metaTitle", { name: business.name })
      : t("wg.metaFallback"),
  };
}

/**
 * /widget/[slug] — lekka strona rezerwacji do osadzenia w iframe na stronie
 * firmy. Wybór usługi → termin → dane → potwierdzenie; rezerwacja dostaje
 * źródło WEB_WIDGET. Działa od 320 px szerokości.
 */
export default async function WidgetPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { locale } = await getTranslations();

  const business = await prisma.business.findFirst({
    where: { slug, status: "ACTIVE" },
    select: {
      id: true,
      slug: true,
      name: true,
      locations: {
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          addressLine1: true,
          city: true,
          timezone: true,
          maxAdvanceDays: true,
        },
      },
      services: {
        // Tylko usługi rezerwowalne online i z konkretną ceną — pozycja
        // „na zapytanie" byłaby w widgecie ślepą uliczką (API ją odrzuca).
        where: {
          isActive: true,
          kind: "STANDARD",
          onlineBookable: true,
          priceType: { not: "ON_REQUEST" },
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          description: true,
          durationMin: true,
          priceCents: true,
          priceType: true,
          currency: true,
        },
      },
    },
  });

  const location = business?.locations[0];
  if (!business || !location) notFound();

  // Pasek 14 dni liczony w strefie lokalu — dzień „dziś" musi być dniem
  // salonu, nie przeglądarki osoby rezerwującej.
  const timezone = location.timezone;
  const todayWall = utcToZonedWallClock(new Date(), timezone);
  const horizon = Math.min(14, Math.max(1, location.maxAdvanceDays));
  const days: WidgetDay[] = [];
  for (let offset = 0; offset < horizon; offset += 1) {
    // Normalizacja przez Date.UTC — przekręca miesiąc/rok za nas.
    const utcDay = new Date(
      Date.UTC(todayWall.year, todayWall.month - 1, todayWall.day + offset),
    );
    const iso = utcDay.toISOString().slice(0, 10);
    days.push({
      value: iso,
      // weekdaysShort jest indeksowane od poniedziałku; getUTCDay od niedzieli.
      weekday: weekdaysShort(locale)[(utcDay.getUTCDay() + 6) % 7]!,
      label: `${String(utcDay.getUTCDate()).padStart(2, "0")}.${String(utcDay.getUTCMonth() + 1).padStart(2, "0")}`,
      isToday: offset === 0,
    });
  }
  const services: WidgetService[] = business.services.map((service) => ({
    id: service.id,
    name: service.name,
    description: service.description,
    durationMin: service.durationMin,
    priceCents: service.priceCents,
    priceType: service.priceType,
    currency: service.currency,
  }));

  return (
    <LocaleProvider locale={locale}>
      <WidgetFlow
        businessSlug={business.slug}
        businessName={business.name}
        address={`${location.addressLine1}, ${location.city}`}
        timezone={timezone}
        days={days}
        services={services}
      />
    </LocaleProvider>
  );
}
