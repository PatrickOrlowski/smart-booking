import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPanelBusiness } from "@/app/panel/data";
import {
  ServicesView,
  type PanelService,
} from "@/components/panel/services-view";

/** Usługi i cennik — lista pogrupowana kategoriami + CRUD w dialogu. */
export default async function ServicesPage() {
  const panel = await getPanelBusiness();
  if (!panel) redirect("/panel/nowa");

  const { business, location, isManager } = panel;

  const [categories, services, staffResources] = await Promise.all([
    prisma.serviceCategory.findMany({
      where: { businessId: business.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.service.findMany({
      // Usługa techniczna `TABLE_RESERVATION` nie jest pozycją cennika:
      // jej wyłączenie albo usunięcie rozbroiłoby CAŁĄ rezerwację stolików
      // (getRestaurantLocation wymaga jej z isActive = true).
      where: { businessId: business.id, kind: "STANDARD" },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        resources: {
          select: { resourceId: true, durationMinOverride: true },
        },
        _count: { select: { bookingItems: true } },
      },
    }),
    location
      ? prisma.resource.findMany({
          where: { locationId: location.id, type: "STAFF", isActive: true },
          orderBy: { sortOrder: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const rows: PanelService[] = services.map((service) => ({
    id: service.id,
    name: service.name,
    description: service.description,
    categoryId: service.categoryId,
    durationMin: service.durationMin,
    bufferBeforeMin: service.bufferBeforeMin,
    bufferAfterMin: service.bufferAfterMin,
    priceCents: service.priceCents,
    priceType: service.priceType,
    currency: service.currency,
    depositRequired: service.depositRequired,
    depositCents: service.depositCents,
    onlineBookable: service.onlineBookable,
    isActive: service.isActive,
    hasBookings: service._count.bookingItems > 0,
    assignments: service.resources.map((entry) => ({
      resourceId: entry.resourceId,
      durationMinOverride: entry.durationMinOverride,
    })),
  }));

  return (
    <ServicesView
      businessId={business.id}
      categories={categories}
      staff={staffResources}
      services={rows}
      isManager={isManager}
    />
  );
}
