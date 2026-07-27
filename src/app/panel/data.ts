import { cache } from "react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Wspólny kontekst panelu: pierwsza firma zalogowanego użytkownika
 * (własna albo taka, w której ma aktywny profil pracownika) wraz
 * z pierwszą lokalizacją.
 *
 * `cache()` deduplikuje zapytanie między layoutem a stroną w jednym renderze.
 * To wyłącznie helper odczytu do renderowania — mutacje przechodzą przez
 * `requireBusinessManager` w server actions.
 */
export const getPanelBusiness = cache(async () => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const business = await prisma.business.findFirst({
    where: {
      OR: [
        { ownerId: userId },
        { staff: { some: { userId, isActive: true } } },
      ],
    },
    orderBy: { createdAt: "asc" },
    include: {
      locations: {
        orderBy: { createdAt: "asc" },
        include: {
          openingHours: {
            orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
          },
        },
      },
      staff: {
        where: { userId, isActive: true },
        select: { role: true, resourceId: true },
      },
    },
  });

  if (!business) return null;

  const staffRole = business.staff[0]?.role ?? null;
  const isOwner = business.ownerId === userId;
  const isManager =
    isOwner ||
    session.user.role === "PLATFORM_ADMIN" ||
    staffRole === "OWNER" ||
    staffRole === "MANAGER";

  return {
    business,
    location: business.locations[0] ?? null,
    isOwner,
    isManager,
    userEmail: session.user.email ?? null,
  };
});
