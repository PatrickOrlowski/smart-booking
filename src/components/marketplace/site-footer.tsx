import Link from "next/link";
import { KATEGORIE } from "@/app/k/kategorie";
import { cityDisplay, citySlug, getActiveCities } from "@/app/m/miasta";

/**
 * Stopka marketplace — ciemna (bg-ink), kolumny: logo + opis, Miasta,
 * Kategorie, Dla firm. Linki miast prowadzą do stron SEO /m/[miasto],
 * kategorii do /k/[kategoria].
 */

const columnHeading =
  "font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-ink-foreground/50";
const columnLink =
  "text-[13px] text-ink-foreground/75 transition-colors hover:text-ink-foreground";

export async function SiteFooter() {
  const cities = await getActiveCities().catch(() => [] as string[]);

  return (
    <footer className="bg-ink text-ink-foreground">
      <div className="mx-auto w-full max-w-6xl px-5 py-12 md:px-8">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr] lg:gap-8">
          <div>
            <div className="font-display text-xl font-extrabold tracking-tight">
              Planner
            </div>
            <p className="mt-3 max-w-[280px] text-[13px] leading-relaxed text-ink-foreground/60">
              Marketplace rezerwacji: znajdź salon, wybierz termin i umów
              wizytę online — bez telefonu, o każdej porze.
            </p>
          </div>

          <div>
            <div className={columnHeading}>Miasta</div>
            <ul className="mt-3 flex flex-col gap-2">
              {cities.length === 0 ? (
                <li className="text-[13px] text-ink-foreground/50">
                  Wkrótce więcej miast
                </li>
              ) : (
                cities.map((city) => (
                  <li key={city}>
                    <Link href={`/m/${citySlug(city)}`} className={columnLink}>
                      {cityDisplay(city)}
                    </Link>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div>
            <div className={columnHeading}>Kategorie</div>
            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-1">
              {Object.entries(KATEGORIE).map(([slug, kategoria]) => (
                <li key={slug}>
                  <Link href={`/k/${slug}`} className={columnLink}>
                    {kategoria.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className={columnHeading}>Dla firm</div>
            <ul className="mt-3 flex flex-col gap-2">
              <li>
                <Link href="/rejestracja" className={columnLink}>
                  Załóż profil firmy
                </Link>
              </li>
              <li>
                <Link href="/login" className={columnLink}>
                  Zaloguj się
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-ink-foreground/15 pt-5 font-mono text-[11px] text-ink-foreground/45">
          © {new Date().getFullYear()} Planner
        </div>
      </div>
    </footer>
  );
}
