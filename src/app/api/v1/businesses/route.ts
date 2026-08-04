import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { MAX_RADIUS_KM, findBusinessesNearby } from "@/lib/geo";

/**
 * GET /api/v1/businesses?city=&q=&lat=&lng=&radiusKm=
 *
 * Lista aktywnych firm z lokalizacjami — zasilanie wyszukiwarki
 * marketplace (web i przyszły mobile).
 *
 * Tryb geograficzny: podanie `lat` i `lng` (opcjonalnie `radiusKm`,
 * domyślnie i maksymalnie 50) zwraca firmy w promieniu, posortowane po
 * odległości, każdą z polem `distanceKm`. `q` dalej filtruje po nazwie
 * i mieście; `city` jest w trybie geo ignorowane — kontekst miasta
 * zastępuje odległość. Bez `lat`/`lng` zachowanie bez zmian.
 */

const geoSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().positive().max(MAX_RADIUS_KM).default(MAX_RADIUS_KM),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() || undefined;
  const city = searchParams.get("city")?.trim() || undefined;

  // Każdy parametr geo aktywuje walidację kompletu — samotne `lat` albo
  // `radiusKm` to błąd żądania, nie cicha lista domyślna.
  const hasGeoParams =
    searchParams.get("lat") !== null ||
    searchParams.get("lng") !== null ||
    searchParams.get("radiusKm") !== null;

  if (hasGeoParams) {
    const parsed = geoSchema.safeParse({
      // null, "" i białe znaki z searchParams.get() przeszłyby przez z.coerce
      // (Number(null), Number("") i Number(" ") = 0) — brakująca albo pusta
      // wartość musi być undefined, żeby oblać walidację, a nie szukać
      // po cichu na równiku.
      lat: searchParams.get("lat")?.trim() || undefined,
      lng: searchParams.get("lng")?.trim() || undefined,
      radiusKm: searchParams.get("radiusKm")?.trim() || undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Nieprawidłowe parametry geograficzne",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    const { lat, lng, radiusKm } = parsed.data;
    const nearby = await findBusinessesNearby({
      lat,
      lng,
      radiusKm,
      limit: 50,
      query: q,
    });

    return NextResponse.json({
      businesses: nearby.map((business) => ({
        id: business.id,
        slug: business.slug,
        name: business.name,
        type: business.type,
        description: business.description,
        // Lokalizacje posortowane po odległości — [0] jest najbliższa.
        locations: business.locations.map((location) => ({
          id: location.id,
          name: location.name,
          addressLine1: location.addressLine1,
          city: location.city,
          timezone: location.timezone,
          distanceKm: Math.round(location.distanceKm * 100) / 100,
        })),
        priceFromCents: business.services[0]?.priceCents ?? null,
        currency: business.services[0]?.currency ?? "PLN",
        distanceKm: Math.round(business.distanceKm * 100) / 100,
      })),
    });
  }

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
