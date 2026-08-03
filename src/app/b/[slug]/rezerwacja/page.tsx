import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { loadServiceContext } from "@/lib/availability-data";
import { SiteHeader } from "@/components/marketplace/site-header";
import { LocaleProvider } from "@/i18n/client";
import { getTranslations } from "@/i18n/server";
import { BookingFlow, type BookingFlowData } from "./booking-flow";

export const dynamic = "force-dynamic";

/**
 * Flow rezerwacji (kroki 1-3 + sukces). Serwer ładuje kontekst usługi
 * i ewentualną sesję; cała interakcja dzieje się w kliencie, ze stanem
 * kroków w searchParams (działa back button).
 */
export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ serviceId?: string }>;
}) {
  const { slug } = await params;
  const { serviceId } = await searchParams;
  const { locale } = await getTranslations();

  if (!serviceId) redirect(`/b/${slug}`);

  const context = await loadServiceContext(slug, serviceId);
  if (!context || context.service.priceType === "ON_REQUEST") {
    redirect(`/b/${slug}`);
  }

  // Zadatek usługi — kontekst dostępności go nie niesie, więc dociągamy
  // wprost z bazy. `stripeEnabled` mówi flow, czy zadatek będzie płatny
  // online (Stripe za flagą env), czy na miejscu (MANUAL).
  const depositFields = await prisma.service.findUnique({
    where: { id: context.service.id },
    select: { depositRequired: true, depositCents: true },
  });
  const deposit =
    depositFields?.depositRequired && depositFields.depositCents
      ? {
          amountCents: depositFields.depositCents,
          stripeEnabled: Boolean(env.STRIPE_SECRET_KEY),
        }
      : null;

  // Auth defensywnie — logowanie buduje inny agent; flow gościa ma działać
  // także bez skonfigurowanej sesji.
  let user: BookingFlowData["user"] = null;
  try {
    const session = await auth();
    if (session?.user?.id) {
      user = {
        name: session.user.name ?? null,
        email: session.user.email ?? null,
      };
    }
  } catch {
    user = null;
  }

  const data: BookingFlowData = {
    businessSlug: context.business.slug,
    businessName: context.business.name,
    address: `${context.location.addressLine1}, ${context.location.city}`,
    timezone: context.location.timezone,
    slotGranularityMin: context.location.slotGranularityMin,
    minLeadTimeMin: context.location.minLeadTimeMin,
    cancellationCutoffHours: context.location.cancellationCutoffHours,
    service: {
      id: context.service.id,
      name: context.service.name,
      durationMin: context.service.durationMin,
      priceCents: context.service.priceCents,
      priceType: context.service.priceType,
      currency: context.service.currency,
    },
    deposit,
    resources: context.resources,
    user,
  };

  return (
    <LocaleProvider locale={locale}>
      <SiteHeader locale={locale} />
      <BookingFlow data={data} />
    </LocaleProvider>
  );
}
