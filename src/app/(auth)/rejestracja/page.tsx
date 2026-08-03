import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { roleHomePath } from "@/components/auth/paths";
import { LocaleProvider } from "@/i18n/client";
import { getTranslations } from "@/i18n/server";
import { RegisterForm } from "./register-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return { title: t("auth.register.metaTitle") };
}

export default async function RegisterPage() {
  const session = await auth();
  if (session?.user) {
    redirect(roleHomePath(session.user.role));
  }

  const { locale } = await getTranslations();

  return (
    <LocaleProvider locale={locale}>
      <RegisterForm />
    </LocaleProvider>
  );
}
