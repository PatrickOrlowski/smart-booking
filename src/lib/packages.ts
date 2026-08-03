import type { Prisma } from "@/generated/prisma/client";
import type { PackageStatus } from "@/generated/prisma/enums";

/**
 * Karnety (ServicePackage → CustomerPackage → PackageUsage).
 *
 * Ta sama zasada co przy rabatach: liczby całkowite, a wykorzystanie wejścia
 * jest atomowe i utrwalane w TEJ SAMEJ transakcji co rezerwacja. Licznik
 * `entriesUsed` podnosimy warunkowo (`updateMany` z `entriesUsed < entriesTotal`),
 * a unikalny `bookingId` na PackageUsage gwarantuje, że jedna wizyta nie
 * skasuje dwóch wejść nawet przy dwóch równoległych żądaniach.
 *
 * Import Prismy jest wyłącznie typowy — klient/transakcja przychodzi
 * parametrem, więc moduł nie ciągnie za sobą połączenia z bazą.
 */

type Db = Prisma.TransactionClient;

export const PACKAGE_STATUS_LABELS: Record<PackageStatus, string> = {
  ACTIVE: "Aktywny",
  EXPIRED: "Przeterminowany",
  USED_UP: "Wykorzystany",
  CANCELLED: "Anulowany",
};

export const PACKAGE_STATUS_CLASSES: Record<PackageStatus, string> = {
  ACTIVE: "bg-success-soft text-success",
  EXPIRED: "bg-warning-soft text-warning-strong",
  USED_UP: "bg-secondary text-foreground/70",
  CANCELLED: "bg-muted text-muted-foreground",
};

export type CustomerPackageState = {
  status: PackageStatus;
  entriesTotal: number;
  entriesUsed: number;
  expiresAt: Date;
};

/**
 * Status widoczny dla użytkownika. Zapisane `status` bywa nieaktualne
 * (karnet wygasa z upływem czasu, bez żadnego zapisu), więc prezentację
 * zawsze wyprowadzamy z danych, a nie z samej kolumny.
 */
export function effectivePackageStatus(
  pkg: CustomerPackageState,
  now: Date = new Date(),
): PackageStatus {
  if (pkg.status === "CANCELLED") return "CANCELLED";
  if (pkg.entriesUsed >= pkg.entriesTotal) return "USED_UP";
  if (pkg.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  return pkg.status;
}

/** Ile wejść zostało — nigdy poniżej zera. */
export const entriesLeft = (pkg: {
  entriesTotal: number;
  entriesUsed: number;
}): number => Math.max(0, pkg.entriesTotal - pkg.entriesUsed);

/** Czy z karnetu można jeszcze skorzystać w danym momencie. */
export function isPackageUsable(
  pkg: CustomerPackageState,
  now: Date = new Date(),
): boolean {
  return effectivePackageStatus(pkg, now) === "ACTIVE";
}

/**
 * Domknięcie statusów, które „zestarzały się" samym upływem czasu.
 * Wołane leniwie przy listowaniu (panel, konto) — dzięki temu lista firmy
 * i lista klienta pokazują ten sam stan, bez crona.
 */
export async function expireCustomerPackages(
  db: Db,
  where: { businessId?: string; customerIds?: string[]; customerUserId?: string },
  now: Date = new Date(),
): Promise<number> {
  const result = await db.customerPackage.updateMany({
    where: {
      status: "ACTIVE",
      expiresAt: { lte: now },
      ...(where.businessId ? { businessId: where.businessId } : {}),
      ...(where.customerIds ? { customerId: { in: where.customerIds } } : {}),
      ...(where.customerUserId
        ? { customer: { userId: where.customerUserId } }
        : {}),
    },
    data: { status: "EXPIRED" },
  });
  return result.count;
}

/** Data wygaśnięcia karnetu kupionego teraz (ważność w dniach). */
export function packageExpiryDate(
  validityDays: number,
  purchasedAt: Date = new Date(),
): Date {
  return new Date(purchasedAt.getTime() + validityDays * 24 * 60 * 60 * 1000);
}

export type UsableCustomerPackage = {
  id: string;
  packageName: string;
  entriesTotal: number;
  entriesUsed: number;
  expiresAt: Date;
  /** null = karnet na dowolną usługę firmy. */
  serviceId: string | null;
};

/**
 * Karnety klienta, z których można teraz skorzystać na daną usługę.
 * `serviceId` = null w karnecie znaczy „dowolna usługa firmy".
 */
export async function findUsablePackagesForCustomer(
  db: Db,
  input: {
    businessId: string;
    customerId: string;
    serviceId?: string | null;
    now?: Date;
  },
): Promise<UsableCustomerPackage[]> {
  const now = input.now ?? new Date();
  const rows = await db.customerPackage.findMany({
    where: {
      businessId: input.businessId,
      customerId: input.customerId,
      status: "ACTIVE",
      expiresAt: { gt: now },
      ...(input.serviceId
        ? {
            package: {
              OR: [{ serviceId: null }, { serviceId: input.serviceId }],
            },
          }
        : {}),
    },
    orderBy: { expiresAt: "asc" },
    select: {
      id: true,
      entriesTotal: true,
      entriesUsed: true,
      expiresAt: true,
      package: { select: { name: true, serviceId: true } },
    },
  });

  return rows
    .filter((row) => row.entriesUsed < row.entriesTotal)
    .map((row) => ({
      id: row.id,
      packageName: row.package.name,
      entriesTotal: row.entriesTotal,
      entriesUsed: row.entriesUsed,
      expiresAt: row.expiresAt,
      serviceId: row.package.serviceId,
    }));
}

/** Odmowa użycia karnetu — mapowana na komunikat w UI, nigdy na 500. */
export class PackageRejectedError extends Error {
  constructor(
    readonly reason:
      | "NOT_FOUND"
      | "NOT_ACTIVE"
      | "EXPIRED"
      | "USED_UP"
      | "SERVICE_MISMATCH",
    readonly userMessage: string,
  ) {
    super(reason);
    this.name = "PackageRejectedError";
  }
}

/**
 * Skasowanie jednego wejścia z karnetu na rzecz rezerwacji.
 *
 * MUSI lecieć w tej samej transakcji co tworzenie rezerwacji:
 *  1. `updateMany` z warunkiem `entriesUsed < entriesTotal` i `status = ACTIVE`
 *     — atomowe, więc dwa równoległe żądania nie skasują tego samego wejścia,
 *  2. unikalny `bookingId` na PackageUsage — jedna wizyta = jedno wejście,
 *  3. po wyczerpaniu ostatniego wejścia status schodzi na USED_UP.
 */
export async function consumePackageEntry(
  tx: Db,
  input: {
    businessId: string;
    customerPackageId: string;
    bookingId: string;
    customerId?: string | null;
    serviceId?: string | null;
    now?: Date;
  },
): Promise<{ entriesLeft: number; packageName: string }> {
  const now = input.now ?? new Date();

  const pkg = await tx.customerPackage.findFirst({
    where: { id: input.customerPackageId, businessId: input.businessId },
    select: {
      id: true,
      customerId: true,
      status: true,
      entriesTotal: true,
      entriesUsed: true,
      expiresAt: true,
      package: { select: { name: true, serviceId: true } },
    },
  });
  if (!pkg) {
    throw new PackageRejectedError("NOT_FOUND", "Nie znaleziono karnetu.");
  }
  if (input.customerId && pkg.customerId !== input.customerId) {
    throw new PackageRejectedError(
      "NOT_FOUND",
      "Ten karnet należy do innego klienta.",
    );
  }
  if (pkg.status === "CANCELLED") {
    throw new PackageRejectedError("NOT_ACTIVE", "Ten karnet jest anulowany.");
  }
  if (pkg.entriesUsed >= pkg.entriesTotal) {
    throw new PackageRejectedError(
      "USED_UP",
      "Ten karnet jest już w całości wykorzystany.",
    );
  }
  if (pkg.expiresAt.getTime() <= now.getTime()) {
    // Status w bazie mógł nie nadążyć za zegarem — domykamy go od razu.
    await tx.customerPackage.updateMany({
      where: { id: pkg.id, status: "ACTIVE" },
      data: { status: "EXPIRED" },
    });
    throw new PackageRejectedError(
      "EXPIRED",
      "Ważność tego karnetu już minęła.",
    );
  }
  if (
    input.serviceId &&
    pkg.package.serviceId !== null &&
    pkg.package.serviceId !== input.serviceId
  ) {
    throw new PackageRejectedError(
      "SERVICE_MISMATCH",
      "Ten karnet nie obejmuje wybranej usługi.",
    );
  }

  // Atomowy licznik: warunek w WHERE, nie read-modify-write.
  const consumed = await tx.customerPackage.updateMany({
    where: {
      id: pkg.id,
      status: "ACTIVE",
      expiresAt: { gt: now },
      entriesUsed: { lt: pkg.entriesTotal },
    },
    data: { entriesUsed: { increment: 1 } },
  });
  if (consumed.count === 0) {
    throw new PackageRejectedError(
      "USED_UP",
      "Ten karnet został właśnie wykorzystany. Odśwież widok.",
    );
  }

  await tx.packageUsage.create({
    data: { customerPackageId: pkg.id, bookingId: input.bookingId },
  });

  const left = pkg.entriesTotal - pkg.entriesUsed - 1;
  if (left <= 0) {
    await tx.customerPackage.updateMany({
      where: { id: pkg.id, status: "ACTIVE" },
      data: { status: "USED_UP" },
    });
  }

  return { entriesLeft: Math.max(0, left), packageName: pkg.package.name };
}

/**
 * Zwrot wejścia z karnetu przy anulowaniu rezerwacji — operacja odwrotna
 * do `consumePackageEntry`, wołana w TEJ SAMEJ transakcji co zmiana statusu
 * rezerwacji na CANCELLED_*. Bez tego klient bezpowrotnie traciłby opłacone
 * wejście za wizytę, która się nie odbyła.
 *
 * Usuwa wiersz PackageUsage danej rezerwacji, cofa licznik `entriesUsed`
 * (warunkowo, nigdy poniżej zera) i przywraca status USED_UP → ACTIVE,
 * jeśli karnet wciąż jest ważny. Karnet przeterminowany zostaje przy swoim
 * statusie — `effectivePackageStatus` i tak pokaże EXPIRED.
 *
 * No-op (zwraca false), gdy rezerwacja nie była opłacona karnetem.
 */
export async function refundPackageEntryForBooking(
  tx: Db,
  bookingId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const usage = await tx.packageUsage.findUnique({
    where: { bookingId },
    select: { id: true, customerPackageId: true },
  });
  if (!usage) return false;

  await tx.packageUsage.delete({ where: { id: usage.id } });
  await tx.customerPackage.updateMany({
    where: { id: usage.customerPackageId, entriesUsed: { gt: 0 } },
    data: { entriesUsed: { decrement: 1 } },
  });
  await tx.customerPackage.updateMany({
    where: {
      id: usage.customerPackageId,
      status: "USED_UP",
      expiresAt: { gt: now },
    },
    data: { status: "ACTIVE" },
  });
  return true;
}
