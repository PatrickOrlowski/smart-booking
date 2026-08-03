import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getRestaurantLocation } from "@/lib/restaurant-data";
import { SiteHeader } from "@/components/marketplace/site-header";
import { toBookingData } from "@/components/restaurant/serialize";
import type { RestaurantBookingData } from "@/components/restaurant/types";
import { LocaleProvider } from "@/i18n/client";
import { getTranslations } from "@/i18n/server";
import { TableFlow } from "./table-flow";

export const dynamic = "force-dynamic";

/**
 * Rezerwacja stolika — /b/[slug]/stolik.
 *
 * Serwer ładuje wyłącznie konfigurację lokalu (sale, strefy, turn time,
 * limity) i ewentualną sesję; wolne godziny dociąga już klient, bo zależą od
 * liczby osób i dnia, które gość zmienia w locie. Stan kroków siedzi
 * w searchParams — patrz `table-flow.tsx`.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const context = await getRestaurantLocation(slug);
  if (!context) return {};

  const { t } = await getTranslations();
  return {
    title: t("stolik.metaTitle", { name: context.business.name }),
    description: t("stolik.metaDescription", {
      name: context.business.name,
      city: context.location.city,
    }),
    alternates: {
      canonical: `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/b/${slug}/stolik`,
    },
    // Ekran transakcyjny — do indeksu wystarczy profil restauracji.
    robots: { index: false, follow: true },
  };
}

export default async function TableBookingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { locale } = await getTranslations();

  const context = await getRestaurantLocation(slug);
  if (!context) notFound();

  // Auth defensywnie — rezerwacja gościa ma działać także wtedy, gdy sesja
  // nie jest skonfigurowana.
  let user: RestaurantBookingData["user"] = null;
  try {
    const session = await auth();
    if (session?.user?.id) {
      const profile = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { name: true, email: true, phone: true },
      });
      user = {
        name: profile?.name ?? session.user.name ?? null,
        email: profile?.email ?? session.user.email ?? null,
        phone: profile?.phone ?? null,
      };
    }
  } catch {
    user = null;
  }

  return (
    <LocaleProvider locale={locale}>
      <SiteHeader locale={locale} />
      <TableFlow data={toBookingData(context, user)} />
    </LocaleProvider>
  );
}
