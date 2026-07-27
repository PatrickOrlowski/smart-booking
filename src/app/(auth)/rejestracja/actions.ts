"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { z } from "zod";

import { signIn } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type AuthFormState = { error: string | null };

const registerSchema = z.object({
  accountType: z.enum(["klient", "firma"]),
  name: z.string().trim().min(3, "Podaj imię i nazwisko"),
  email: z.email("Podaj poprawny adres e-mail"),
  password: z.string().min(8, "Hasło musi mieć co najmniej 8 znaków"),
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
  const parsed = registerSchema.safeParse({
    accountType: formData.get("accountType"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Sprawdź poprawność danych",
    };
  }

  const { accountType, name, password } = parsed.data;
  const email = parsed.data.email.toLowerCase();

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    return { error: "Konto z tym adresem już istnieje" };
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
      return { error: "Konto z tym adresem już istnieje" };
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
