import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { roleHomePath } from "@/components/auth/paths";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Rejestracja — Planner",
};

export default async function RegisterPage() {
  const session = await auth();
  if (session?.user) {
    redirect(roleHomePath(session.user.role));
  }

  return <RegisterForm />;
}
