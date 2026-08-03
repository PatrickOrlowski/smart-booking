"use client";

import { useState, useTransition } from "react";
import { Heart } from "lucide-react";
import { toggleFavorite } from "@/app/b/[slug]/favorite-action";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/i18n/client";

/**
 * Serce „dodaj do ulubionych" na profilu firmy. Stan przełącza się
 * optymistycznie, server action robi toggle w bazie; niezalogowanego
 * akcja przekierowuje na /login.
 */
export function FavoriteButton({
  businessId,
  initialIsFavorite,
  className,
}: {
  businessId: string;
  initialIsFavorite: boolean;
  className?: string;
}) {
  const { t } = useTranslations();
  const [isFavorite, setIsFavorite] = useState(initialIsFavorite);
  const [, startTransition] = useTransition();

  const handleClick = () => {
    const next = !isFavorite;
    setIsFavorite(next);
    startTransition(async () => {
      try {
        await toggleFavorite(businessId);
      } catch {
        // Niepowodzenie (np. sieć) — wracamy do stanu sprzed kliknięcia.
        setIsFavorite(!next);
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={isFavorite}
      aria-label={isFavorite ? t("favorite.remove") : t("favorite.add")}
      title={isFavorite ? t("favorite.remove") : t("favorite.add")}
      className={cn(
        "flex size-11 flex-none items-center justify-center rounded-full border-[1.5px] border-border-strong bg-card transition-colors hover:bg-muted lg:size-10",
        className,
      )}
    >
      <Heart
        className={cn(
          "size-[18px] transition-colors",
          isFavorite ? "fill-primary stroke-primary" : "stroke-foreground",
        )}
      />
    </button>
  );
}
