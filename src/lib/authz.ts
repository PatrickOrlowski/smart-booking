import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { StaffRole } from "@/generated/prisma/enums";

/**
 * Jeden punkt prawdy dla autoryzacji dostępu do firmy.
 *
 * Każdy endpoint i server action panelu ma przechodzić przez te funkcje —
 * rozsiane po kodzie sprawdzenia `ownerId === userId` to najprostsza droga
 * do wycieku cudzego grafiku.
 */

export type SessionUser = {
  id: string;
  role: "CUSTOMER" | "BUSINESS_OWNER" | "STAFF" | "PLATFORM_ADMIN";
};

export class UnauthorizedError extends Error {
  constructor(message = "Wymagane zalogowanie") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Brak uprawnień do tego zasobu") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return { id: session.user.id, role: session.user.role };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export type BusinessAccess = {
  businessId: string;
  isOwner: boolean;
  isPlatformAdmin: boolean;
  staffRole: StaffRole | null;
  /// Id zasobu (pracownika) — pracownik widzi wyłącznie swój grafik.
  resourceId: string | null;
};

/**
 * Zwraca zakres dostępu użytkownika do firmy albo null, jeśli go nie ma.
 */
export async function getBusinessAccess(
  userId: string,
  businessId: string,
): Promise<BusinessAccess | null> {
  const [user, business, staffProfile] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    prisma.business.findUnique({
      where: { id: businessId },
      select: { ownerId: true },
    }),
    prisma.staffProfile.findFirst({
      where: { businessId, userId, isActive: true },
      select: { role: true, resourceId: true },
    }),
  ]);

  if (!business) return null;

  const isPlatformAdmin = user?.role === "PLATFORM_ADMIN";
  const isOwner = business.ownerId === userId;

  if (!isPlatformAdmin && !isOwner && !staffProfile) return null;

  return {
    businessId,
    isOwner,
    isPlatformAdmin,
    staffRole: staffProfile?.role ?? null,
    resourceId: staffProfile?.resourceId ?? null,
  };
}

export async function canAccessBusiness(
  userId: string,
  businessId: string,
): Promise<boolean> {
  return (await getBusinessAccess(userId, businessId)) !== null;
}

/**
 * Wymaga zalogowania i dostępu do firmy. Rzuca, gdy któregokolwiek brakuje.
 */
export async function requireBusinessAccess(
  businessId: string,
): Promise<{ user: SessionUser; access: BusinessAccess }> {
  const user = await requireUser();
  const access = await getBusinessAccess(user.id, businessId);
  if (!access) throw new ForbiddenError();
  return { user, access };
}

/**
 * Wymaga uprawnień administracyjnych w firmie — właściciel, manager
 * lub admin platformy. Szeregowy pracownik nie zmienia cennika ani grafików
 * kolegów.
 */
export async function requireBusinessManager(businessId: string) {
  const result = await requireBusinessAccess(businessId);
  const { access } = result;
  const isManager =
    access.isOwner ||
    access.isPlatformAdmin ||
    access.staffRole === "OWNER" ||
    access.staffRole === "MANAGER";

  if (!isManager) throw new ForbiddenError();
  return result;
}
