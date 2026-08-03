"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/i18n/client";
import type { MessageKey } from "@/i18n";
import { registerAction, type AuthFormState } from "./actions";

const initialState: AuthFormState = { error: null };

const inputClassName =
  "h-auto rounded-xl border-[1.5px] border-border-strong bg-card px-3.5 py-3 text-sm md:text-sm";

type AccountType = "klient" | "firma";

const accountTypes: Array<{
  value: AccountType;
  title: MessageKey;
  description: MessageKey;
}> = [
  {
    value: "klient",
    title: "auth.register.clientTitle",
    description: "auth.register.clientDesc",
  },
  {
    value: "firma",
    title: "auth.register.businessTitle",
    description: "auth.register.businessDesc",
  },
];

export function RegisterForm() {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(
    registerAction,
    initialState,
  );
  const [accountType, setAccountType] = useState<AccountType>("klient");

  return (
    <div>
      <div className="meta-label">{t("auth.register.label")}</div>
      <h1 className="mt-1.5 font-display text-[28px] leading-none font-extrabold tracking-tight md:text-[32px]">
        {t("auth.register.title")}
      </h1>
      <p className="mt-2 text-[13px] text-muted-foreground">
        {t("auth.register.subtitle")}
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

          <input type="hidden" name="accountType" value={accountType} />

          {/* Karty wyboru: 1 kolumna na telefonie, 2 kolumny od sm. */}
          <div
            role="radiogroup"
            aria-label={t("auth.register.typeAria")}
            className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
          >
            {accountTypes.map((option) => {
              const selected = accountType === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setAccountType(option.value)}
                  className={cn(
                    "cursor-pointer rounded-2xl p-4 text-left transition-colors",
                    selected
                      ? "border-[1.5px] border-border-strong bg-card"
                      : "border border-border bg-card/70 hover:bg-muted/50",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[14px] font-bold">
                      {t(option.title)}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "inline-flex size-4 items-center justify-center rounded-full border-[1.5px]",
                        selected
                          ? "border-primary bg-primary"
                          : "border-border bg-card",
                      )}
                    >
                      {selected ? (
                        <span className="size-1.5 rounded-full bg-primary-foreground" />
                      ) : null}
                    </span>
                  </span>
                  <span className="mt-1 block text-[12px] leading-snug text-muted-foreground">
                    {t(option.description)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="name"
              className="text-[11px] font-semibold text-muted-foreground"
            >
              {t("auth.name")}
            </Label>
            <Input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              required
              minLength={3}
              placeholder={t("auth.namePlaceholder")}
              className={inputClassName}
            />
          </div>

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
              {t("auth.password")}{" "}
              <span className="font-normal text-muted-foreground/70">
                {t("auth.passwordHint")}
              </span>
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
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
            {pending ? t("auth.register.pending") : t("auth.register.submit")}
          </Button>
        </form>
      </div>

      <p className="mt-4 text-center text-[13px] text-muted-foreground">
        {t("auth.register.haveAccount")}{" "}
        <Link
          href="/login"
          className="font-semibold text-foreground underline underline-offset-4"
        >
          {t("auth.register.loginLink")}
        </Link>
      </p>
    </div>
  );
}
