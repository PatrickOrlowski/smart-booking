import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiBusiness } from "@/app/api/public/v1/common";

/**
 * GET /api/public/v1/services — cennik firmy właściciela klucza.
 * Wyłącznie usługi standardowe (techniczny nośnik rezerwacji stolika
 * nie jest pozycją cennika).
 */
export async function GET(request: Request) {
  const auth = await requireApiBusiness(request);
  if (!auth.ok) return auth.response;
  const { business } = auth.ctx;

  const services = await prisma.service.findMany({
    where: { businessId: business.id, isActive: true, kind: "STANDARD" },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      durationMin: true,
      priceCents: true,
      priceType: true,
      currency: true,
      onlineBookable: true,
      category: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({
    services: services.map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description,
      durationMin: service.durationMin,
      priceCents: service.priceCents,
      priceType: service.priceType,
      currency: service.currency,
      onlineBookable: service.onlineBookable,
      category: service.category,
    })),
  });
}
