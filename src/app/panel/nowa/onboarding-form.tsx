"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BusinessType } from "@/generated/prisma/enums";
import {
  BUSINESS_TYPE_LABELS,
  WEEKDAY_LABELS,
  formatMinutes,
  timeOptions,
} from "@/components/panel/format";
import { createBusinessAction } from "./actions";

type DayHours = { open: boolean; startMinute: number; endMinute: number };

const STEPS = ["Firma i typ działalności", "Lokalizacja", "Godziny otwarcia"];

const DEFAULT_HOURS: DayHours[] = WEEKDAY_LABELS.map((_, weekday) => {
  if (weekday === 6) return { open: false, startMinute: 9 * 60, endMinute: 17 * 60 };
  if (weekday === 5) return { open: true, startMinute: 9 * 60, endMinute: 15 * 60 };
  return { open: true, startMinute: 9 * 60, endMinute: 19 * 60 };
});

const HOUR_OPTIONS = timeOptions(0, 24 * 60, 30);

/** Kreator konfiguracji firmy — 3 kroki wg zakładki Onboarding prototypu. */
export function OnboardingForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [type, setType] = useState<BusinessType>("BARBER");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [timezone, setTimezone] = useState("Europe/Warsaw");
  const [hours, setHours] = useState<DayHours[]>(DEFAULT_HOURS);

  const stepValid = useMemo(() => {
    if (step === 0) return name.trim().length >= 2;
    if (step === 1)
      return (
        addressLine1.trim().length >= 3 &&
        city.trim().length >= 2 &&
        postalCode.trim().length >= 3
      );
    return hours.some((day) => day.open);
  }, [step, name, addressLine1, city, postalCode, hours]);

  const updateDay = (weekday: number, patch: Partial<DayHours>) => {
    setHours((previous) =>
      previous.map((day, index) =>
        index === weekday ? { ...day, ...patch } : day,
      ),
    );
  };

  const submit = () => {
    startTransition(async () => {
      const result = await createBusinessAction({
        name: name.trim(),
        type,
        addressLine1: addressLine1.trim(),
        city: city.trim(),
        postalCode: postalCode.trim(),
        timezone: timezone.trim() || "Europe/Warsaw",
        openingHours: hours
          .map((day, weekday) => ({ ...day, weekday }))
          .filter((day) => day.open)
          .map((day) => ({
            weekday: day.weekday,
            startMinute: day.startMinute,
            endMinute: day.endMinute,
          })),
      });
      if (result.ok) {
        toast.success("Firma utworzona. Witaj w panelu!");
        router.push("/panel");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-md gap-8 px-5 py-8 md:max-w-2xl md:px-6 md:py-10 lg:max-w-5xl">
      <div className="min-w-0 max-w-2xl flex-1">
        <div className="meta-label">
          Krok {step + 1} / {STEPS.length}
        </div>
        <h1 className="mt-2 mb-1.5 font-display text-3xl font-extrabold leading-none tracking-tight md:text-4xl">
          {step === 0 && (
            <>
              Nazwij swoją firmę
              <br />i wybierz branżę.
            </>
          )}
          {step === 1 && (
            <>
              Gdzie przyjmujesz
              <br />
              klientów?
            </>
          )}
          {step === 2 && (
            <>
              Kiedy lokal
              <br />
              jest otwarty?
            </>
          )}
        </h1>
        <p className="mb-5 text-[13.5px] text-muted-foreground">
          {step === 0 &&
            "Nazwa będzie widoczna w wyszukiwarce i w linku do rezerwacji."}
          {step === 1 &&
            "Adres i strefa czasowa lokalizacji — wszystkie godziny liczymy względem niej."}
          {step === 2 &&
            "Godziny otwarcia to zewnętrzna granica dostępności. Grafiki pracowników ustawisz później."}
        </p>

        <div className="mb-7 flex gap-1.5">
          {STEPS.map((label, index) => (
            <div
              key={label}
              className={`h-1.5 flex-1 rounded-full ${index <= step ? "bg-primary" : "bg-border"}`}
            />
          ))}
        </div>

        {step === 0 && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="business-name">Nazwa firmy</Label>
              <Input
                id="business-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="np. Kruk Barber"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Typ działalności</Label>
              <Select
                value={type}
                onValueChange={(value) => setType(value as BusinessType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(BusinessType).map((value) => (
                    <SelectItem key={value} value={value}>
                      {BUSINESS_TYPE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="address">Ulica i numer</Label>
              <Input
                id="address"
                value={addressLine1}
                onChange={(event) => setAddressLine1(event.target.value)}
                placeholder="np. ul. Puławska 24"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-[2fr_1fr] md:gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="city">Miasto</Label>
                <Input
                  id="city"
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  placeholder="np. Warszawa"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="postal">Kod pocztowy</Label>
                <Input
                  id="postal"
                  value={postalCode}
                  onChange={(event) => setPostalCode(event.target.value)}
                  placeholder="00-001"
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="timezone">Strefa czasowa</Label>
              <Input
                id="timezone"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Domyślnie Europe/Warsaw — zmień tylko, jeśli lokal jest za
                granicą.
              </p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-2.5">
            {WEEKDAY_LABELS.map((label, weekday) => {
              const day = hours[weekday];
              return (
                <div
                  key={label}
                  className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-2.5 md:grid md:grid-cols-[1.2fr_auto_auto_auto] md:items-center md:gap-3"
                >
                  <label className="flex min-h-11 items-center gap-3 text-[13px] font-semibold lg:min-h-0">
                    <Checkbox
                      checked={day.open}
                      onCheckedChange={(checked) =>
                        updateDay(weekday, { open: checked === true })
                      }
                    />
                    {label}
                  </label>
                  {day.open ? (
                    <div className="flex items-center gap-2 md:contents">
                      <TimeSelect
                        value={day.startMinute}
                        onChange={(minute) =>
                          updateDay(weekday, {
                            startMinute: minute,
                            endMinute: Math.max(day.endMinute, minute + 30),
                          })
                        }
                        options={HOUR_OPTIONS.filter((m) => m < 24 * 60)}
                      />
                      <span className="shrink-0 text-xs text-muted-foreground">
                        –
                      </span>
                      <TimeSelect
                        value={day.endMinute}
                        onChange={(minute) => updateDay(weekday, { endMinute: minute })}
                        options={HOUR_OPTIONS.filter((m) => m > day.startMinute)}
                      />
                    </div>
                  ) : (
                    <span className="hidden font-mono text-xs text-muted-foreground md:col-span-3 md:block md:text-right">
                      zamknięte
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-8 flex items-center gap-2.5">
          {step > 0 && (
            <Button
              type="button"
              variant="outline"
              className="rounded-full px-5 max-lg:h-11"
              onClick={() => setStep(step - 1)}
              disabled={isPending}
            >
              Wstecz
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button
              type="button"
              className="min-w-0 rounded-full px-5 font-semibold max-lg:h-11"
              onClick={() => setStep(step + 1)}
              disabled={!stepValid}
            >
              <span className="truncate">
                Dalej: {STEPS[step + 1].toLowerCase()}
              </span>
            </Button>
          ) : (
            <Button
              type="button"
              className="min-w-0 rounded-full px-5 font-semibold max-lg:h-11"
              onClick={submit}
              disabled={!stepValid || isPending}
            >
              <span className="truncate">
                {isPending ? "Tworzenie firmy…" : "Utwórz firmę i otwórz panel"}
              </span>
            </Button>
          )}
        </div>
      </div>

      <aside className="hidden w-72 shrink-0 flex-col gap-4 lg:flex">
        <div className="rounded-2xl bg-ink p-5 text-ink-foreground">
          <div className="meta-label mb-2.5 text-ink-foreground/50">
            Cel onboardingu
          </div>
          <div className="font-display text-3xl font-extrabold leading-none tracking-tight">
            15 minut
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-foreground/70">
            Od rejestracji do działającego kalendarza. Usługi i zespół dodasz
            już w panelu.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 text-[12.5px] font-bold">Kroki</div>
          <ol className="flex flex-col gap-2.5 text-[12.5px]">
            {STEPS.map((label, index) => (
              <li key={label} className="flex items-center gap-2.5">
                <span
                  className={`flex size-[18px] items-center justify-center rounded-full font-mono text-[10px] ${
                    index < step
                      ? "bg-primary text-primary-foreground"
                      : index === step
                        ? "border-[1.5px] border-border-strong font-bold"
                        : "border border-border text-muted-foreground"
                  }`}
                >
                  {index < step ? "✓" : index + 1}
                </span>
                <span
                  className={
                    index === step ? "font-bold" : "text-muted-foreground"
                  }
                >
                  {label}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}

function TimeSelect({
  value,
  onChange,
  options,
}: {
  value: number;
  onChange: (minute: number) => void;
  options: number[];
}) {
  return (
    <Select
      value={String(value)}
      onValueChange={(next) => onChange(Number(next))}
    >
      <SelectTrigger className="w-[92px] font-mono text-xs max-lg:min-h-11 max-md:w-auto max-md:min-w-0 max-md:flex-1">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {options.map((minute) => (
          <SelectItem key={minute} value={String(minute)} className="font-mono">
            {formatMinutes(minute)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
