import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/v1/businesses/[slug]
 *
 * Publiczny profil firmy: usługi pogrupowane w kategorie, zespół,
 * lokalizacje z godzinami otwarcia.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const business = await prisma.business.findFirst({
    where: { slug, status: "ACTIVE" },
    select: {
      id: true,
      slug: true,
      name: true,
      type: true,
      description: true,
      categories: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, sortOrder: true },
      },
      services: {
        // `TABLE_RESERVATION` to techniczny nośnik rezerwacji stolika —
        // nigdy nie jest pozycją cennika (klient API wyrenderowałby ją jako
        // usługę, a POST /api/v1/bookings i tak nie ma dla niej zasobów).
        where: { isActive: true, kind: "STANDARD" },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          categoryId: true,
          name: true,
          description: true,
          durationMin: true,
          priceCents: true,
          priceType: true,
          currency: true,
          onlineBookable: true,
        },
      },
      locations: {
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          postalCode: true,
          phone: true,
          timezone: true,
          cancellationCutoffHours: true,
          openingHours: {
            orderBy: { weekday: "asc" },
            select: { weekday: true, startMinute: true, endMinute: true },
          },
          resources: {
            where: { isActive: true, type: "STAFF" },
            orderBy: { sortOrder: "asc" },
            select: {
              id: true,
              name: true,
              description: true,
              imageUrl: true,
              staffProfile: { select: { title: true, bio: true } },
            },
          },
        },
      },
    },
  });

  if (!business) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "Nie znaleziono firmy" },
      { status: 404 },
    );
  }

  const reviewStats = await prisma.review.aggregate({
    where: { businessId: business.id, isPublished: true },
    _avg: { rating: true },
    _count: true,
  });

  return NextResponse.json({
    business: {
      ...business,
      rating: {
        average: reviewStats._avg.rating,
        count: reviewStats._count,
      },
    },
  });
}
