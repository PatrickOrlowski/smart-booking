"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "@/i18n/client";
import { hasValidGeoParams } from "./coords";

/**
 * Chip „< 2 km" — działa dopiero, gdy w URL-u jest pozycja użytkownika
 * (?lat=&lng= z przycisku „Użyj mojej lokalizacji"). Przełącza ?maxKm=2,
 * a filtrowanie po distanceKm robi serwer. Bez pozycji chip jest wygaszony
 * (wariant ghost z design systemu) z podpowiedzią w title.
 */
export function DistanceChip() {
  const { t } = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Ta sama walidacja co serwer — śmieciowe ?lat=999 nie może aktywować chipa,
  // skoro serwer nie filtruje wtedy po odległości.
  const hasGeo = hasValidGeoParams(searchParams);
  const active = hasGeo && searchParams.get("maxKm") !== null;

  const toggle = () => {
    if (!hasGeo) return;
    const params = new URLSearchParams(searchParams.toString());
    if (active) params.delete("maxKm");
    else params.set("maxKm", "2");
    router.replace(params.size ? `/?${params.toString()}` : "/", {
      scroll: false,
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!hasGeo}
      aria-pressed={active}
      title={hasGeo ? undefined : t("geo.chipHint")}
      className={
        active
          ? "flex-none cursor-pointer rounded-full bg-primary px-[13px] py-2 text-xs font-semibold text-primary-foreground"
          : hasGeo
            ? "flex-none cursor-pointer rounded-full border border-border bg-card px-[13px] py-2 text-xs font-semibold text-foreground/80"
            : "flex-none rounded-full border border-border bg-card px-[13px] py-2 text-xs font-semibold text-muted-foreground"
      }
    >
      {t("home.chip.distance")}
    </button>
  );
}
