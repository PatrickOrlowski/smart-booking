import { Lock, Martini, Sun, Utensils, type LucideIcon } from "lucide-react";
import type { RestaurantArea } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

/**
 * Ikona strefy lokalu. Osobny moduł, bo używają jej i server components
 * (sekcja „Strefy" na profilu), i komponenty klienckie (flow rezerwacji).
 */

const AREA_ICONS: Record<RestaurantArea, LucideIcon> = {
  INDOOR: Utensils,
  OUTDOOR: Sun,
  BAR: Martini,
  PRIVATE: Lock,
};

export function AreaIcon({
  area,
  className,
}: {
  area: RestaurantArea;
  className?: string;
}) {
  const Icon = AREA_ICONS[area];
  return <Icon aria-hidden className={cn("size-4", className)} />;
}
