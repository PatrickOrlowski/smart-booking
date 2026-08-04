import { prisma } from "@/lib/prisma";

/**
 * Wyszukiwanie geograficzne po odległości.
 *
 * Strategia: kolumny `Location.latitude/longitude` nie mają indeksu
 * przestrzennego, więc zapytanie tnie kandydatów prostym bounding boxem
 * (warunki BETWEEN — indeksowalne), a dokładną odległość liczy Haversine
 * już w JS na przefiltrowanym zbiorze. Przy promieniu ≤ 50 km i skali
 * marketplace'u to w zupełności wystarcza.
 */

export type GeoPoint = { lat: number; lng: number };

const EARTH_RADIUS_KM = 6371;

/** 1° szerokości geograficznej w km (πR/180 ≈ 111,195). */
export const KM_PER_DEGREE_LAT = (Math.PI * EARTH_RADIUS_KM) / 180;

/** Maksymalny promień wyszukiwania — spójny z walidacją API. */
export const MAX_RADIUS_KM = 50;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Odległość po ortodromie (wzór haversine) w kilometrach. Czysta funkcja. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * sinLng * sinLng;
  // min(1, √h) — błąd zmiennoprzecinkowy potrafi dać h minimalnie > 1
  // dla punktów antypodycznych, a asin poza [-1, 1] zwraca NaN.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type BoundingBox = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

/**
 * Bounding box wokół punktu: szerokość ma stały przelicznik km→stopnie,
 * długość kurczy się z cos(lat) — na 52°N stopień długości to ~68 km.
 *
 * Zakresy są przycinane do [-90, 90] / [-180, 180]. Przy promieniu ≤ 50 km
 * box przecinający południk 180° teoretycznie gubi drugą stronę — dla
 * marketplace'u działającego w Polsce to świadome uproszczenie.
 */
export function boundingBox(origin: GeoPoint, radiusKm: number): BoundingBox {
  const dLat = radiusKm / KM_PER_DEGREE_LAT;
  // Blisko biegunów cos(lat) → 0; dolne ograniczenie chroni przed dzieleniem
  // przez ~0 (Infinity w zakresie długości).
  const cosLat = Math.max(Math.cos(toRadians(origin.lat)), 0.01);
  const dLng = radiusKm / (KM_PER_DEGREE_LAT * cosLat);
  return {
    minLat: Math.max(origin.lat - dLat, -90),
    maxLat: Math.min(origin.lat + dLat, 90),
    minLng: Math.max(origin.lng - dLng, -180),
    maxLng: Math.min(origin.lng + dLng, 180),
  };
}

export type NearbyQuery = {
  lat: number;
  lng: number;
  radiusKm: number;
  /** Ilu firm maksymalnie zwrócić (po sortowaniu po odległości). */
  limit?: number;
  /** Opcjonalny filtr tekstowy — nazwa firmy lub miasto (jak ?q= listingów). */
  query?: string;
};

/** Górny limit kandydatów z bounding boxa przed dokładnym filtrem Haversine. */
const BBOX_CANDIDATE_LIMIT = 200;

/**
 * Aktywne firmy w promieniu `radiusKm` od punktu, posortowane po odległości
 * (rosnąco), każda z polem `distanceKm` liczonym do NAJBLIŻSZEJ lokalizacji.
 * Lokalizacje firmy są posortowane po odległości — `locations[0]` to ta,
 * której adres pokazujemy na karcie.
 */
export async function findBusinessesNearby({
  lat,
  lng,
  radiusKm,
  limit = 50,
  query,
}: NearbyQuery) {
  const origin: GeoPoint = { lat, lng };
  const box = boundingBox(origin, radiusKm);
  const inBox = {
    isActive: true,
    latitude: { gte: box.minLat, lte: box.maxLat },
    longitude: { gte: box.minLng, lte: box.maxLng },
  };

  const candidates = await prisma.business.findMany({
    where: {
      status: "ACTIVE",
      locations: { some: inBox },
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              {
                locations: {
                  some: { city: { contains: query, mode: "insensitive" } },
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
        where: inBox,
        select: {
          id: true,
          name: true,
          addressLine1: true,
          city: true,
          timezone: true,
          latitude: true,
          longitude: true,
        },
      },
      services: {
        // Cena „od" tylko z płatnych pozycji cennika — ten sam filtr co na
        // pozostałych listingach (page.tsx, strony miast).
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
      reviews: {
        where: { isPublished: true },
        select: { rating: true },
      },
    },
    // `take` bez orderBy zwraca NIEOKREŚLONE wiersze — przy >limit firm
    // w boxie najbliższa mogłaby w ogóle nie trafić do kandydatów, a wyniki
    // różniłyby się między odświeżeniami. Deterministyczny porządek to
    // minimum; dokładny ranking odległości i tak robi Haversine niżej.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: BBOX_CANDIDATE_LIMIT,
  });

  return candidates
    .flatMap((business) => {
      // Bounding box to nadzbiór koła — rogi boxa wystają poza promień,
      // więc dokładny filtr i sortowanie robi Haversine.
      const locations = business.locations
        .filter((location) => location.latitude !== null && location.longitude !== null)
        .map((location) => ({
          ...location,
          distanceKm: haversineKm(origin, {
            lat: location.latitude as number,
            lng: location.longitude as number,
          }),
        }))
        .sort((a, b) => a.distanceKm - b.distanceKm);
      const nearest = locations[0];
      if (!nearest || nearest.distanceKm > radiusKm) return [];
      return [{ ...business, locations, distanceKm: nearest.distanceKm }];
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

export type NearbyBusiness = Awaited<
  ReturnType<typeof findBusinessesNearby>
>[number];
