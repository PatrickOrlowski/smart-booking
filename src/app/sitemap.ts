import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { KATEGORIA_SLUGS } from "@/app/k/kategorie";
import { citySlug, getActiveCities } from "@/app/m/miasta";

// Bez tego mapa strony zostaje zamrożona na etapie builda i firmy dodane
// po deployu nigdy do niej nie trafią.
export const revalidate = 3600;

/**
 * Mapa strony: home, aktywne profile firm, strony miast i kategorii.
 * lastModified stron zbiorczych = najnowsze updatedAt aktywnej firmy.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

  const [businesses, cities] = await Promise.all([
    prisma.business.findMany({
      where: { status: "ACTIVE" },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
    getActiveCities(),
  ]);

  const newestUpdate = businesses[0]?.updatedAt ?? new Date();

  return [
    {
      url: `${base}/`,
      lastModified: newestUpdate,
      changeFrequency: "daily",
      priority: 1,
    },
    ...businesses.map((business) => ({
      url: `${base}/b/${business.slug}`,
      lastModified: business.updatedAt,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...cities.map((city) => ({
      url: `${base}/m/${citySlug(city)}`,
      lastModified: newestUpdate,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
    ...KATEGORIA_SLUGS.map((slug) => ({
      url: `${base}/k/${slug}`,
      lastModified: newestUpdate,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
  ];
}
