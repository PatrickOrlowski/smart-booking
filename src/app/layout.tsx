import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  DM_Mono,
  Instrument_Sans,
} from "next/font/google";
import "./globals.css";
import { HtmlLangSync } from "@/i18n/html-lang";

const displayFont = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin", "latin-ext"],
  weight: ["600", "700", "800"],
});

const sansFont = Instrument_Sans({
  variable: "--font-sans",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
});

const monoFont = DM_Mono({
  variable: "--font-mono",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Planner — rezerwacje online",
  description:
    "Platforma rezerwacji dla firm usługowych: grafiki pracowników, cennik i rezerwacja terminów online.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // `lang="pl"` to serwerowy default: layout nie może czytać cookie języka,
  // bo zdegradowałby trasy statyczne (ISR miast/kategorii) do renderu
  // dynamicznego. <HtmlLangSync /> poprawia atrybut po hydracji, a boty
  // (bez cookie) i tak dostają polską treść — dla nich "pl" jest poprawne.
  return (
    <html
      lang="pl"
      className={`${displayFont.variable} ${sansFont.variable} ${monoFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <HtmlLangSync />
        {children}
      </body>
    </html>
  );
}
