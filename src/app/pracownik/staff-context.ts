import { cache } from "react";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Sesja + profil pracownika (zasób, firma, lokalizacja) dla panelu
 * /pracownik. Owinięte w React cache — layout i strona współdzielą wynik
 * w obrębie jednego żądania.
 */
export const getStaffContext = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) {
    return { sessionUser: null, profile: null };
  }

  const profile = await prisma.staffProfile.findFirst({
    where: { userId: session.user.id, isActive: true },
    include: {
      business: true,
      resource: { include: { location: true } },
    },
  });

  return { sessionUser: session.user, profile };
});

export type StaffContext = Awaited<ReturnType<typeof getStaffContext>>;
