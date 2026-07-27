import "dotenv/config";
import { defineConfig } from "prisma/config";

// CLI (migrate/seed/studio) łączy się bezpośrednio, z pominięciem poolera —
// PgBouncer w trybie transakcyjnym nie obsługuje blokad advisory używanych przez
// Prisma Migrate. Runtime aplikacji korzysta z DATABASE_URL (pooled).
const cliUrl = process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"];

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: cliUrl,
  },
});
