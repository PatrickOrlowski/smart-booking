"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslations } from "@/i18n/client";
import { loginAction, type AuthFormState } from "./actions";

const initialState: AuthFormState = { error: null };

const inputClassName =
  "h-auto rounded-xl border-[1.5px] border-border-strong bg-card px-3.5 py-3 text-sm md:text-sm";

export function LoginForm() {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <div>
      <div className="meta-label">{t("auth.login.label")}</div>
      <h1 className="mt-1.5 font-display text-[28px] leading-none font-extrabold tracking-tight md:text-[32px]">
        {t("auth.login.title")}
      </h1>
      <p className="mt-2 text-[13px] text-muted-foreground">
        {t("auth.login.subtitle")}
      </p>

      <div className="mt-5 rounded-2xl border-[1.5px] border-border-strong bg-card p-5 sm:p-6">
        <form action={formAction} className="flex flex-col gap-4">
          {state.error ? (
            <div
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] font-semibold text-destructive"
            >
              {state.error}
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="email"
              className="text-[11px] font-semibold text-muted-foreground"
            >
              {t("auth.email")}
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="adres@example.com"
              className={inputClassName}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="password"
              className="text-[11px] font-semibold text-muted-foreground"
            >
              {t("auth.password")}
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              placeholder="••••••••"
              className={inputClassName}
            />
          </div>

          <Button
            type="submit"
            disabled={pending}
            className="mt-1 h-auto w-full rounded-full px-4 py-3 text-[14px] font-bold"
          >
            {pending ? t("auth.login.pending") : t("auth.login.submit")}
          </Button>
        </form>
      </div>

      <p className="mt-4 text-center text-[13px] text-muted-foreground">
        {t("auth.login.noAccount")}{" "}
        <Link
          href="/rejestracja"
          className="font-semibold text-foreground underline underline-offset-4"
        >
          {t("auth.login.registerLink")}
        </Link>
      </p>
    </div>
  );
}
