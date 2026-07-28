"use client";

import { useState, useTransition } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { updateCustomerAction } from "@/app/panel/(dashboard)/klienci/actions";

export type EditableCustomer = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  tags: string[];
};

/**
 * Dialog edycji danych klienta (CRM): imię, kontakt, notatki i tagi.
 * Tagi wpisywane po przecinku — serwer waliduje Zodem i deduplikuje.
 */
export function CustomerEditDialog({
  businessId,
  customer,
}: {
  businessId: string;
  customer: EditableCustomer;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState(customer.fullName);
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [email, setEmail] = useState(customer.email ?? "");
  const [notes, setNotes] = useState(customer.notes ?? "");
  const [tags, setTags] = useState(customer.tags.join(", "));

  const openDialog = (next: boolean) => {
    if (next) {
      // Świeże wartości przy każdym otwarciu — po edycji i refresh() props
      // się zmieniają, a stan z pierwszego renderu byłby nieaktualny.
      setFullName(customer.fullName);
      setPhone(customer.phone ?? "");
      setEmail(customer.email ?? "");
      setNotes(customer.notes ?? "");
      setTags(customer.tags.join(", "));
    }
    setOpen(next);
  };

  const canSubmit = fullName.trim().length >= 2;

  const submit = () => {
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await updateCustomerAction({
        businessId,
        customerId: customer.id,
        fullName: fullName.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        notes: notes.trim() || undefined,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      if (result.ok) {
        toast.success("Dane klienta zapisane");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={openDialog}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="h-11 rounded-full border-[1.5px] border-border-strong px-4 font-semibold lg:h-8"
        >
          Edytuj dane
        </Button>
      </DialogTrigger>
      <PanelDialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edycja klienta</DialogTitle>
          <DialogDescription>
            Dane widoczne tylko dla twojej firmy — klient ich nie zobaczy.
          </DialogDescription>
        </DialogHeader>

        <PanelDialogBody>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="customer-name">Imię i nazwisko</Label>
            <Input
              id="customer-name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="np. Anna Lewandowska"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="customer-phone">Telefon</Label>
              <Input
                id="customer-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+48 600 000 000"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="customer-email">E-mail</Label>
              <Input
                id="customer-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="anna@przyklad.pl"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="customer-tags">Tagi</Label>
            <Input
              id="customer-tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="VIP, stały klient"
            />
            <p className="text-[11px] text-muted-foreground">
              Oddzielaj przecinkami — maksymalnie 12 tagów.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="customer-notes">Notatki wewnętrzne</Label>
            <Textarea
              id="customer-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              placeholder="np. preferuje wizyty rano, uczulenie na henne"
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
            {isPending ? "Zapisywanie…" : "Zapisz zmiany"}
          </Button>
        </DialogFooter>
      </PanelDialogContent>
    </Dialog>
  );
}
