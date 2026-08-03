import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/v1/businesses?city=&q=
 *
 * Lista aktywnych firm z lokalizacjami — zasilanie wyszukiwarki
 * marketplace (web i przyszły mobile).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() || undefined;
  const city = searchParams.get("city")?.trim() || undefined;

  const businesses = await prisma.business.findMany({
    where: {
      status: "ACTIVE",
      ...(city
        ? { locations: { some: { city: { contains: city, mode: "insensitive" } } } }
        : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              {
                locations: {
                  some: { city: { contains: q, mode: "insensitive" } },
                },
              },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      slug: true,
      name: true,
      type: true,
      description: true,
      locations: {
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          addressLine1: true,
          city: true,
          timezone: true,
        },
      },
      services: {
        // Cena „od" tylko z płatnych pozycji cennika: usługa techniczna
        // `TABLE_RESERVATION` (0 zł) zaniżyłaby każdą restaurację do „od 0 zł",
        // a wycena ON_REQUEST nie ma kwoty. Ten sam filtr co w src/app/page.tsx.
        where: {
          isActive: true,
          onlineBookable: true,
          kind: "STANDARD",
          priceType: { in: ["FIXED", "FROM"] },
        },
        orderBy: { priceCents: "asc" },
        take: 1,
        select: { priceCents: true, currency: true, priceType: true },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  return NextResponse.json({
    businesses: businesses.map((business) => ({
      id: business.id,
      slug: business.slug,
      name: business.name,
      type: business.type,
      description: business.description,
      locations: business.locations,
      priceFromCents: business.services[0]?.priceCents ?? null,
      currency: business.services[0]?.currency ?? "PLN",
    })),
  });
}
