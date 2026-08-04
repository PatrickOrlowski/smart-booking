"use client";

import { cn } from "@/lib/utils";
import { useTranslations } from "@/i18n/client";
import { useGeolocation, type GeoErrorKind } from "./use-geolocation";

/**
 * Przycisk „Użyj mojej lokalizacji" przy polu szukania. Po uzyskaniu pozycji
 * wpisuje ?lat=&lng= do URL-a (lista sortuje się po odległości na serwerze),
 * aktywny działa jak wyłącznik. Odmowa uprawnień → komunikat pod przyciskiem
 * i lista domyślna.
 */

const ERROR_KEY: Record<GeoErrorKind, "geo.error.denied" | "geo.error.unavailable" | "geo.error.unsupported"> = {
  denied: "geo.error.denied",
  unavailable: "geo.error.unavailable",
  unsupported: "geo.error.unsupported",
};

export function NearbyButton({ className }: { className?: string }) {
  const { t } = useTranslations();
  const { hasGeo, locating, errorKind, request, clear } = useGeolocation();

  return (
    <div className={className}>
      <button
        type="button"
        onClick={hasGeo ? clear : request}
        disabled={locating}
        aria-pressed={hasGeo}
        className={cn(
          "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold",
          hasGeo
            ? "bg-primary text-primary-foreground"
            : "border-[1.5px] border-border-strong bg-card",
          locating && "cursor-default opacity-60",
        )}
      >
        <span aria-hidden className="font-mono text-[13px] leading-none">
          ◎
        </span>
        {locating
          ? t("geo.locating")
          : hasGeo
            ? t("geo.clear")
            : t("geo.useLocation")}
      </button>
      {errorKind ? (
        <p
          role="status"
          className="mt-1.5 max-w-sm text-xs leading-snug text-destructive"
        >
          {t(ERROR_KEY[errorKind])}
        </p>
      ) : null}
    </div>
  );
}
