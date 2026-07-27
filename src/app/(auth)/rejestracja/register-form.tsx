"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { registerAction, type AuthFormState } from "./actions";

const initialState: AuthFormState = { error: null };

const inputClassName =
  "h-auto rounded-xl border-[1.5px] border-border-strong bg-card px-3.5 py-3 text-sm md:text-sm";

type AccountType = "klient" | "firma";

const accountTypes: Array<{
  value: AccountType;
  title: string;
  description: string;
}> = [
  {
    value: "klient",
    title: "Klient",
    description: "Rezerwuję wizyty i usługi",
  },
  {
    value: "firma",
    title: "Firma",
    description: "Przyjmuję rezerwacje klientów",
  },
];

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(
    registerAction,
    initialState,
  );
  const [accountType, setAccountType] = useState<AccountType>("klient");

  return (
    <div>
      <div className="meta-label">REJESTRACJA</div>
      <h1 className="mt-1.5 font-display text-[28px] leading-none font-extrabold tracking-tight md:text-[32px]">
        Załóż konto.
      </h1>
      <p className="mt-2 text-[13px] text-muted-foreground">
        Wybierz typ konta i podaj swoje dane — zajmie to chwilę.
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
            aria-label="Typ konta"
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
                      {option.title}
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
                    {option.description}
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
              Imię i nazwisko
            </Label>
            <Input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              required
              minLength={3}
              placeholder="Anna Kruk"
              className={inputClassName}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="email"
              className="text-[11px] font-semibold text-muted-foreground"
            >
              E-mail
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
              Hasło{" "}
              <span className="font-normal text-muted-foreground/70">
                · min. 8 znaków
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
            {pending ? "Tworzenie konta…" : "Załóż konto"}
          </Button>
        </form>
      </div>

      <p className="mt-4 text-center text-[13px] text-muted-foreground">
        Masz już konto?{" "}
        <Link
          href="/login"
          className="font-semibold text-foreground underline underline-offset-4"
        >
          Zaloguj się
        </Link>
      </p>
    </div>
  );
}
