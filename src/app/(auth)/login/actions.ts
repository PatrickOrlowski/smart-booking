"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { credentialsSchema, signIn } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { roleHomePath } from "@/components/auth/paths";
import { getTranslations } from "@/i18n/server";

export type AuthFormState = { error: string | null };

export async function loginAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { t } = await getTranslations();

  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: t("auth.error.invalidCredentials") };
  }

  const email = parsed.data.email.toLowerCase();

  try {
    await signIn("credentials", {
      email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return error.type === "CredentialsSignin"
        ? { error: t("auth.error.invalidCredentials") }
        : { error: t("auth.error.loginFailed") };
    }
    throw error;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { role: true },
  });
  redirect(roleHomePath(user?.role ?? "CUSTOMER"));
}
