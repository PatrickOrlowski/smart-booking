import type { Metadata } from "next";

/**
 * Minimalny layout widgetu do osadzenia w iframe: bez SiteHeader/SiteFooter,
 * bez nawigacji — sama treść flow rezerwacji na tle aplikacji. Strona jest
 * przeznaczona do ramek na cudzych stronach, więc nie indeksujemy jej.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function WidgetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-dvh bg-background">{children}</div>;
}
