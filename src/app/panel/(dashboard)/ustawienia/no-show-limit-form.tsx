"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateNoShowLimitAction } from "./actions";

/**
 * Formularz limitu nieobecności — jedyne edytowalne pole strony ustawień.
 * Walidacja miękka w polu (1–10), twarda w akcji serwerowej (Zod).
 */
export function NoShowLimitForm({
  businessId,
  initialLimit,
}: {
  businessId: string;
  initialLimit: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(String(initialLimit));

  const parsed = Number(value);
  const isValid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 10;
  const isDirty = isValid && parsed !== initialLimit;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValid) {
      toast.error("Limit nieobecności musi być liczbą od 1 do 10");
      return;
    }
    startTransition(async () => {
      const result = await updateNoShowLimitAction({
        businessId,
        noShowLimit: parsed,
      });
      if (result.ok) {
        toast.success("Limit nieobecności zapisany");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <form onSubmit={submit}>
      <Label
        htmlFor="no-show-limit"
        className="text-[13px] font-semibold text-foreground"
      >
        Limit nieobecności
      </Label>
      <div className="mt-2 flex items-center gap-2.5">
        <Input
          id="no-show-limit"
          name="noShowLimit"
          type="number"
          inputMode="numeric"
          min={1}
          max={10}
          step={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={isPending}
          aria-invalid={!isValid}
          className="h-11 w-24 rounded-xl font-mono text-[13px] md:h-10"
        />
        <span className="text-[12.5px] text-muted-foreground">
          {parsed === 1 ? "nieobecność" : "nieobecności"}
        </span>
        <Button
          type="submit"
          disabled={isPending || !isDirty}
          className="ml-auto h-11 rounded-full px-4 text-[13px] font-semibold md:h-9"
        >
          {isPending ? "Zapisuję…" : "Zapisz"}
        </Button>
      </div>
      <p className="mt-2.5 text-[12px] leading-snug text-muted-foreground">
        Po tylu nieodwołanych nieobecnościach (no-show) klient zostaje
        automatycznie zablokowany i nie zarezerwuje wizyty online. Blokadę
        można zdjąć ręcznie. Wartość od 1 do 10.
      </p>
    </form>
  );
}
