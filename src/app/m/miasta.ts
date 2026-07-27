import { cache } from "react";
import { prisma } from "@/lib/prisma";

/**
 * Strony miast (/m/[miasto]) — slugi i lista aktywnych miast.
 *
 * Slug miasta: lowercase + dekompozycja polskich znaków ("Łódź" → "lodz",
 * "Zielona Góra" → "zielona-gora").
 */

export function citySlug(city: string): string {
  return city
    .toLowerCase()
    .replace(/ł/g, "l") // "ł" nie rozkłada się przez NFD
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Nazwa miasta do prezentacji. Miasto wpisuje właściciel przy onboardingu,
 * więc w bazie trafiają się formy „sanok" albo „ZIELONA GÓRA" — na stronie
 * SEO każdy człon dostaje wielką literę („Zielona Góra", „Bielsko-Biała").
 */
export function cityDisplay(city: string): string {
  return city
    .trim()
    .toLocaleLowerCase("pl-PL")
    .replace(
      /(^|[\s-])(\p{L})/gu,
      (_match, separator: string, letter: string) =>
        separator + letter.toLocaleUpperCase("pl-PL"),
    );
}

/** Miejscownik najpopularniejszych miast — „w Warszawie", nie „w Warszawa". */
const LOCATIVE: Record<string, string> = {
  Warszawa: "Warszawie",
  Kraków: "Krakowie",
  Łódź: "Łodzi",
  Wrocław: "Wrocławiu",
  Poznań: "Poznaniu",
  Gdańsk: "Gdańsku",
  Szczecin: "Szczecinie",
  Bydgoszcz: "Bydgoszczy",
  Lublin: "Lublinie",
  Białystok: "Białymstoku",
  Katowice: "Katowicach",
  Gdynia: "Gdyni",
  Częstochowa: "Częstochowie",
  Radom: "Radomiu",
  Toruń: "Toruniu",
  Rzeszów: "Rzeszowie",
  Sosnowiec: "Sosnowcu",
  Kielce: "Kielcach",
  Gliwice: "Gliwicach",
  Zabrze: "Zabrzu",
  Olsztyn: "Olsztynie",
  "Zielona Góra": "Zielonej Górze",
};

/**
 * Fraza „gdzie" do nagłówka i opisów: „w Warszawie" dla miast z tabeli
 * odmian, „w mieście Sanok" dla pozostałych. Odmiana polskich nazw
 * miejscowości jest nieregularna (Sanok → Sanoku, Kraków → Krakowie),
 * więc zamiast zgadywać końcówkę używamy formy z rzeczownikiem
 * pomocniczym — zawsze poprawnej gramatycznie.
 */
export function cityInPhrase(city: string): string {
  const display = cityDisplay(city);
  const locative = LOCATIVE[display];
  return locative ? `w ${locative}` : `w mieście ${display}`;
}

/**
 * Slug miasta → wszystkie surowe zapisy z bazy, które się na niego mapują.
 *
 * Miasto wpisuje ręcznie właściciel, więc „Gdańsk", „Gdansk" i „GDAŃSK"
 * potrafią żyć obok siebie. Wszystkie należą do tej samej strony /m/gdansk,
 * dlatego trzymamy komplet wariantów — filtrowanie po jednym z nich
 * (`equals` insensitive) gubiłoby firmy z pozostałych zapisów.
 *
 * `cache()` z Reacta: jeden render (metadata + strona + stopka) to jedno
 * zapytanie, a nie trzy.
 */
export const getCityIndex = cache(
  async (): Promise<Map<string, { display: string; variants: string[] }>> => {
    const rows = await prisma.location.findMany({
      where: { isActive: true, business: { status: "ACTIVE" } },
      distinct: ["city"],
      select: { city: true },
      orderBy: { city: "asc" },
    });

    const bySlug = new Map<string, { display: string; variants: string[] }>();
    for (const row of rows) {
      const slug = citySlug(row.city);
      if (!slug) continue;
      const entry = bySlug.get(slug);
      if (entry) entry.variants.push(row.city);
      else bySlug.set(slug, { display: cityDisplay(row.city), variants: [row.city] });
    }
    return bySlug;
  },
);

/**
 * Distinct miasta aktywnych lokalizacji aktywnych firm, posortowane
 * alfabetycznie. Deduplikacja po slugu — „Warszawa" i „warszawa" to
 * jedna strona, inaczej sitemap i generateStaticParams dostałyby duplikaty.
 */
export async function getActiveCities(): Promise<string[]> {
  const index = await getCityIndex();
  return [...index.values()]
    .map((entry) => entry.display)
    .sort((a, b) => a.localeCompare(b, "pl-PL"));
}

/** Nazwa miasta dla sluga z URL-a albo null, gdy nieznane. */
export async function resolveCity(slug: string): Promise<string | null> {
  const index = await getCityIndex();
  return index.get(slug)?.display ?? null;
}

/** Wszystkie zapisy miasta spod danego sluga (do filtrów `city: { in }`). */
export async function cityVariants(slug: string): Promise<string[]> {
  const index = await getCityIndex();
  return index.get(slug)?.variants ?? [];
}
