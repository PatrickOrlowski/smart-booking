"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { z } from "zod";

import { signIn } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTranslations } from "@/i18n/server";

export type AuthFormState = { error: string | null };

/**
 * Schema bez wbudowanych komunikatów — teksty błędów wybieramy po walidacji
 * na podstawie pola, w aktywnym języku (cookie `planner.locale`).
 */
const registerSchema = z.object({
  accountType: z.enum(["klient", "firma"]),
  name: z.string().trim().min(3),
  email: z.email(),
  password: z.string().min(8),
});

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function registerAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { t } = await getTranslations();

  const parsed = registerSchema.safeParse({
    accountType: formData.get("accountType"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const error =
      field === "name"
        ? t("auth.error.nameRequired")
        : field === "email"
          ? t("auth.error.emailInvalid")
          : field === "password"
            ? t("auth.error.passwordMin")
            : t("auth.error.checkData");
    return { error };
  }

  const { accountType, name, password } = parsed.data;
  const email = parsed.data.email.toLowerCase();

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    return { error: t("auth.error.emailTaken") };
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: accountType === "firma" ? "BUSINESS_OWNER" : "CUSTOMER",
      },
    });
  } catch (error) {
    // Wyścig dwóch rejestracji na ten sam adres — unikat w bazie łapie resztę.
    if (isUniqueViolation(error)) {
      return { error: t("auth.error.emailTaken") };
    }
    throw error;
  }

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      // Konto powstało, ale automatyczne logowanie się nie udało —
      // użytkownik dokończy ręcznie.
      redirect("/login");
    }
    throw error;
  }

  // Firma trafia do panelu (onboarding), klient na stronę główną.
  redirect(accountType === "firma" ? "/panel" : "/");
}
