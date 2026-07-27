"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  PanelDialogBody,
  PanelDialogContent,
} from "@/components/panel/panel-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { PriceType } from "@/generated/prisma/enums";
import {
  formatMinutes,
  formatPrice,
  parseDateParam,
  timeOptions,
  weekdayOf,
} from "@/components/panel/format";
import { createManualBookingAction } from "@/app/panel/(dashboard)/actions";

export type BookingStaffOption = { id: string; name: string };

export type BookingServiceOption = {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
  priceType: PriceType;
  currency: string;
  overrides: {
    resourceId: string;
    durationMin: number | null;
    priceCents: number | null;
  }[];
};

export type OpeningBlock = {
  weekday: number;
  startMinute: number;
  endMinute: number;
};

/** Dialog „Dodaj wizytę" — ręczna rezerwacja przez obsługę (MANUAL_STAFF). */
export function AddBookingDialog({
  businessId,
  staff,
  services,
  openingHours,
  defaultDate,
  granularityMin,
}: {
  businessId: string;
  staff: BookingStaffOption[];
  services: BookingServiceOption[];
  openingHours: OpeningBlock[];
  defaultDate: string;
  granularityMin: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [resourceId, setResourceId] = useState(staff[0]?.id ?? "");
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [date, setDate] = useState(defaultDate);
  const [startMinute, setStartMinute] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [note, setNote] = useState("");

  const service = services.find((entry) => entry.id === serviceId) ?? null;
  const override =
    service?.overrides.find((entry) => entry.resourceId === resourceId) ?? null;
  const durationMin = override?.durationMin ?? service?.durationMin ?? 0;
  const priceCents = override?.priceCents ?? service?.priceCents ?? 0;

  const startOptions = useMemo(() => {
    const parsedDate = parseDateParam(date);
    if (!parsedDate) return [];
    const weekday = weekdayOf(parsedDate);
    const blocks = openingHours.filter((block) => block.weekday === weekday);
    // Poza godzinami otwarcia obsługa nadal może wpisać wizytę ręcznie —
    // dajemy pełny zakres 7:00–21:00 jako rozsądne domyślne okno.
    const openMin = blocks.length
      ? Math.min(...blocks.map((block) => block.startMinute))
      : 7 * 60;
    const closeMin = blocks.length
      ? Math.max(...blocks.map((block) => block.endMinute))
      : 21 * 60;
    const step = Math.max(granularityMin, 5);
    return timeOptions(openMin, Math.max(openMin, closeMin - step), step);
  }, [date, openingHours, granularityMin]);

  const canSubmit =
    resourceId !== "" &&
    serviceId !== "" &&
    parseDateParam(date) !== null &&
    startMinute !== null &&
    customerName.trim().length >= 2;

  const submit = () => {
    if (!canSubmit || startMinute === null) return;
    startTransition(async () => {
      const result = await createManualBookingAction({
        businessId,
        resourceId,
        serviceId,
        date,
        startMinute,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || undefined,
        customerEmail: customerEmail.trim() || undefined,
        note: note.trim() || undefined,
      });
      if (result.ok) {
        toast.success("Wizyta dodana do kalendarza");
        setOpen(false);
        setCustomerName("");
        setCustomerPhone("");
        setCustomerEmail("");
        setNote("");
        setStartMinute(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-11 rounded-full px-5 font-semibold max-sm:shadow-lg lg:h-8 lg:px-4">
          + Dodaj wizytę
        </Button>
      </DialogTrigger>
      <PanelDialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nowa wizyta</DialogTitle>
          <DialogDescription>
            Rezerwacja ręczna — od razu potwierdzona, bufory blokują grafik.
          </DialogDescription>
        </DialogHeader>

        <PanelDialogBody>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Pracownik</Label>
              <Select value={resourceId} onValueChange={setResourceId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Wybierz" />
                </SelectTrigger>
                <SelectContent>
                  {staff.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Usługa</Label>
              <Select value={serviceId} onValueChange={setServiceId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Wybierz" />
                </SelectTrigger>
                <SelectContent>
                  {services.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="booking-date">Data</Label>
              <Input
                id="booking-date"
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setStartMinute(null);
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Godzina</Label>
              <Select
                value={startMinute === null ? "" : String(startMinute)}
                onValueChange={(value) => setStartMinute(Number(value))}
              >
                <SelectTrigger className="w-full font-mono">
                  <SelectValue placeholder="--:--" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {startOptions.map((minute) => (
                    <SelectItem
                      key={minute}
                      value={String(minute)}
                      className="font-mono"
                    >
                      {formatMinutes(minute)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {service && (
            <div className="rounded-lg border border-dashed border-border bg-card px-3 py-2.5 text-xs text-foreground/80">
              Czas trwania{" "}
              <b className="font-mono">{durationMin} min</b>
              {override?.durationMin != null && " (nadpisany dla pracownika)"} ·
              cena{" "}
              <b className="font-mono">
                {formatPrice(priceCents, service.currency, service.priceType)}
              </b>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="booking-name">Imię i nazwisko klienta</Label>
            <Input
              id="booking-name"
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              placeholder="np. Jan Kowalski"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="booking-phone">Telefon (opcjonalnie)</Label>
              <Input
                id="booking-phone"
                value={customerPhone}
                onChange={(event) => setCustomerPhone(event.target.value)}
                placeholder="+48 600 000 000"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="booking-email">E-mail (opcjonalnie)</Label>
              <Input
                id="booking-email"
                type="email"
                value={customerEmail}
                onChange={(event) => setCustomerEmail(event.target.value)}
                placeholder="jan@przyklad.pl"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="booking-note">Notatka wewnętrzna (opcjonalnie)</Label>
            <Textarea
              id="booking-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
            />
          </div>
        </PanelDialogBody>

        <DialogFooter>
          <Button
            variant="outline"
            className="rounded-full max-lg:h-11"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Anuluj
          </Button>
          <Button
            className="rounded-full font-semibold max-lg:h-11"
            onClick={submit}
            disabled={!canSubmit || isPending}
          >
            {isPending ? "Zapisywanie…" : "Dodaj wizytę"}
          </Button>
        </DialogFooter>
      </PanelDialogContent>
    </Dialog>
  );
}
