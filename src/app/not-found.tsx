import Link from "next/link";

import { getTranslations } from "@/i18n/server";

/**
 * Globalna strona 404 — publiczna, więc dwujęzyczna (cookie decyduje).
 * Odczyt cookies jest tu bezkosztowy: 404 i tak nie jest cache'owane
 * per użytkownik w żaden sposób, który chcielibyśmy chronić.
 */
export default async function NotFound() {
  const { t } = await getTranslations();

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-5 py-16">
      <div className="w-full max-w-md text-center">
        <div className="meta-label">{t("nf.label")}</div>
        <h1 className="mt-2 font-display text-[34px] leading-none font-extrabold tracking-tight">
          {t("nf.title")}
        </h1>
        <p className="mx-auto mt-3 max-w-[320px] text-[13px] leading-relaxed text-muted-foreground">
          {t("nf.text")}
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/80"
        >
          {t("nf.home")}
        </Link>
      </div>
    </main>
  );
}
