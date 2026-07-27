import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { roleHomePath } from "@/components/auth/paths";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Logowanie — Planner",
};

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) {
    redirect(roleHomePath(session.user.role));
  }

  return <LoginForm />;
}
