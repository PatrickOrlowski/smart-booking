import { z } from "zod";

/**
 * Walidacja zmiennych środowiskowych — wykonywana raz, przy starcie procesu.
 * Brakująca zmienna ma wysypać build, a nie pierwszy request na produkcji.
 *
 * Plik jest przeznaczony wyłącznie dla kodu serwerowego.
 */
const serverEnvSchema = z.object({
  DATABASE_URL: z.url({ error: "DATABASE_URL musi być poprawnym connection stringiem" }),
  DIRECT_URL: z.url().optional(),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET musi mieć co najmniej 32 znaki"),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /// Klucz Resend — bez niego e-maile nie wychodzą, tylko logują się
  /// w tabeli notifications ze statusem SKIPPED.
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default("Planner <onboarding@resend.dev>"),
  /// Autoryzacja endpointu /api/cron/* (nagłówek Authorization: Bearer <sekret>).
  CRON_SECRET: z.string().optional(),
  /// Stripe — bez kluczy płatności działają w trybie MANUAL (rozliczenie na
  /// miejscu), a bramka jest w UI wyłączona zamiast wysypywać checkout.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  /// SMSAPI — bez tokenu SMS-y są logowane w notifications jako SKIPPED.
  SMSAPI_TOKEN: z.string().optional(),
  SMS_FROM: z.string().default("Planner"),
  /// Web Push (VAPID) — bez kluczy push jest wyłączony w UI.
  VAPID_PRIVATE_KEY: z.string().optional(),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:kontakt@planner.pl"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function loadEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Nieprawidłowa konfiguracja środowiska:\n${details}`);
  }

  return parsed.data;
}

export const env = loadEnv();
