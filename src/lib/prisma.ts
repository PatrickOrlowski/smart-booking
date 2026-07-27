import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

/**
 * Klient Prismy jako singleton.
 *
 * W dev Next.js przeładowuje moduły przy każdej zmianie — bez trzymania
 * instancji na globalThis każdy hot reload otwierałby nową pulę połączeń
 * i wyczerpał limit Neona.
 *
 * Runtime łączy się przez pooled URL (PgBouncer). Migracje idą bezpośrednio —
 * patrz prisma.config.ts.
 */
const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
