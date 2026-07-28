"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EllipsisVerticalIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PriceType } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import {
  PRICE_TYPE_LABELS,
  formatPrice,
  initials,
} from "@/components/panel/format";
import {
  deleteServiceAction,
  saveServiceAction,
  toggleServiceActiveAction,
} from "@/app/panel/(dashboard)/uslugi/actions";

export type PanelCategory = { id: string; name: string };
export type PanelStaffOption = { id: string; name: string };

export type PanelService = {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  priceCents: number;
  priceType: PriceType;
  currency: string;
  depositRequired: boolean;
  depositCents: number | null;
  onlineBookable: boolean;
  isActive: boolean;
  hasBookings: boolean;
  assignments: { resourceId: string; durationMinOverride: number | null }[];
};

type EditorState = {
  serviceId: string | null;
  name: string;
  description: string;
  categoryChoice: string; // id kategorii | "none" | "__new"
  newCategoryName: string;
  durationMin: string;
  bufferBeforeMin: string;
  bufferAfterMin: string;
  priceZl: string;
  priceType: PriceType;
  /** Zadatek online — przełącznik + kwota w zł (zapis w groszach). */
  depositEnabled: boolean;
  depositZl: string;
  onlineBookable: boolean;
  hasBookings: boolean;
  assignments: Record<string, { checked: boolean; override: string }>;
};

/** Grosze → wartość pola tekstowego w zł ("120" / "120.50"). */
const centsToZlInput = (cents: number | null): string =>
  cents == null
    ? ""
    : cents % 100 === 0
      ? String(cents / 100)
      : (cents / 100).toFixed(2);

const ROW_GRID =
  "grid grid-cols-[2.2fr_0.7fr_0.7fr_0.9fr_1fr_0.5fr_auto] items-center gap-3";

/** Nakładające się awatary pracowników przypisanych do usługi. */
function AssignmentAvatars({
  service,
  staff,
}: {
  service: PanelService;
  staff: PanelStaffOption[];
}) {
  return (
    <div className="flex">
      {service.assignments.length === 0 ? (
        <span className="text-[11.5px] text-muted-foreground">nikt</span>
      ) : (
        service.assignments.slice(0, 4).map((entry, index) => {
          const member = staff.find(
            (candidate) => candidate.id === entry.resourceId,
          );
          return (
            <span
              key={entry.resourceId}
              title={member?.name}
              className={cn(
                "flex size-6 items-center justify-center rounded-full border-2 border-card bg-muted font-display text-[9px] font-bold",
                index > 0 && "-ml-2",
              )}
            >
              {member ? initials(member.name) : "?"}
            </span>
          );
        })
      )}
      {service.assignments.length > 4 && (
        <span className="-ml-2 flex size-6 items-center justify-center rounded-full border-2 border-card bg-secondary font-mono text-[9px]">
          +{service.assignments.length - 4}
        </span>
      )}
    </div>
  );
}

/** Lista usług pogrupowana kategoriami + dialog CRUD — zakładka Usługi i cennik. */
export function ServicesView({
  businessId,
  categories,
  staff,
  services,
  isManager,
}: {
  businessId: string;
  categories: PanelCategory[];
  staff: PanelStaffOption[];
  services: PanelService[];
  isManager: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editor, setEditor] = useState<EditorState | null>(null);

  const emptyEditor = (): EditorState => ({
    serviceId: null,
    name: "",
    description: "",
    categoryChoice: categories[0]?.id ?? "none",
    newCategoryName: "",
    durationMin: "30",
    bufferBeforeMin: "0",
    bufferAfterMin: "0",
    priceZl: "",
    priceType: "FIXED",
    depositEnabled: false,
    depositZl: "",
    onlineBookable: true,
    hasBookings: false,
    assignments: Object.fromEntries(
      staff.map((member) => [member.id, { checked: true, override: "" }]),
    ),
  });

  const editorFor = (service: PanelService): EditorState => ({
    serviceId: service.id,
    name: service.name,
    description: service.description ?? "",
    categoryChoice: service.categoryId ?? "none",
    newCategoryName: "",
    durationMin: String(service.durationMin),
    bufferBeforeMin: String(service.bufferBeforeMin),
    bufferAfterMin: String(service.bufferAfterMin),
    priceZl:
      service.priceCents % 100 === 0
        ? String(service.priceCents / 100)
        : (service.priceCents / 100).toFixed(2),
    priceType: service.priceType,
    depositEnabled: service.depositRequired && service.depositCents != null,
    depositZl: centsToZlInput(service.depositCents),
    onlineBookable: service.onlineBookable,
    hasBookings: service.hasBookings,
    assignments: Object.fromEntries(
      staff.map((member) => {
        const assignment = service.assignments.find(
          (entry) => entry.resourceId === member.id,
        );
        return [
          member.id,
          {
            checked: assignment !== undefined,
            override:
              assignment?.durationMinOverride != null
                ? String(assignment.durationMinOverride)
                : "",
          },
        ];
      }),
    ),
  });

  const groups: { key: string; label: string; services: PanelService[] }[] = [
    ...categories.map((category) => ({
      key: category.id,
      label: category.name,
      services: services.filter((service) => service.categoryId === category.id),
    })),
    {
      key: "none",
      label: "Bez kategorii",
      services: services.filter((service) => service.categoryId === null),
    },
  ].filter((group) => group.services.length > 0);

  const toggleActive = (service: PanelService, isActive: boolean) => {
    startTransition(async () => {
      const result = await toggleServiceActiveAction({
        businessId,
        serviceId: service.id,
        isActive,
      });
      if (result.ok) {
        toast.success(isActive ? "Usługa aktywna" : "Usługa wyłączona");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const save = () => {
    if (!editor) return;
    const durationMin = Number(editor.durationMin);
    const bufferBeforeMin = Number(editor.bufferBeforeMin || "0");
    const bufferAfterMin = Number(editor.bufferAfterMin || "0");
    const priceFree =
      editor.priceType === "FREE" || editor.priceType === "ON_REQUEST";
    const priceZl = Number(editor.priceZl.replace(",", "."));
    if (!Number.isFinite(durationMin) || durationMin < 5) {
      toast.error("Podaj czas trwania (min. 5 minut)");
      return;
    }
    if (!priceFree && (!Number.isFinite(priceZl) || priceZl < 0)) {
      toast.error("Podaj poprawną cenę");
      return;
    }

    // Zadatek: kwota > 0 i nieprzekraczająca ceny usługi; wymaga cennika
    // z konkretną kwotą (przy „bezpłatna"/„na zapytanie" nie ma od czego
    // liczyć zadatku). Wyłączony przełącznik zawsze czyści kwotę.
    const priceCents = priceFree ? 0 : Math.round(priceZl * 100);
    const depositZl = Number(editor.depositZl.replace(",", "."));
    const depositCents = editor.depositEnabled ? Math.round(depositZl * 100) : null;
    if (editor.depositEnabled) {
      if (!Number.isFinite(depositZl) || (depositCents ?? 0) <= 0) {
        toast.error("Podaj kwotę zadatku większą od zera");
        return;
      }
      if (priceCents <= 0 || (depositCents ?? 0) > priceCents) {
        toast.error("Zadatek nie może przekraczać ceny usługi");
        return;
      }
    }

    startTransition(async () => {
      const result = await saveServiceAction({
        businessId,
        serviceId: editor.serviceId ?? undefined,
        name: editor.name.trim(),
        description: editor.description.trim() || undefined,
        categoryId:
          editor.categoryChoice === "none" || editor.categoryChoice === "__new"
            ? null
            : editor.categoryChoice,
        newCategoryName:
          editor.categoryChoice === "__new"
            ? editor.newCategoryName.trim() || undefined
            : undefined,
        durationMin,
        bufferBeforeMin: Number.isFinite(bufferBeforeMin) ? bufferBeforeMin : 0,
        bufferAfterMin: Number.isFinite(bufferAfterMin) ? bufferAfterMin : 0,
        priceCents,
        priceType: editor.priceType,
        depositRequired: editor.depositEnabled,
        depositCents,
        onlineBookable: editor.onlineBookable,
        assignments: Object.entries(editor.assignments)
          .filter(([, value]) => value.checked)
          .map(([resourceId, value]) => {
            const override = Number(value.override);
            return {
              resourceId,
              durationMinOverride:
                value.override.trim() !== "" && Number.isFinite(override)
                  ? override
                  : null,
            };
          }),
      });
      if (result.ok) {
        toast.success(
          editor.serviceId ? "Zapisano zmiany" : "Usługa dodana do cennika",
        );
        setEditor(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const remove = () => {
    if (!editor?.serviceId) return;
    startTransition(async () => {
      const result = await deleteServiceAction({
        businessId,
        serviceId: editor.serviceId!,
      });
      if (result.ok) {
        toast.success(
          result.deactivated
            ? "Usługa ma rezerwacje w historii — została dezaktywowana"
            : "Usługa usunięta",
        );
        setEditor(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight sm:text-[27px]">
            Usługi i cennik
          </h1>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
            {services.length}{" "}
            {services.length === 1 ? "usługa" : services.length < 5 ? "usługi" : "usług"}{" "}
            · czas trwania i bufory sterują siatką terminów
          </div>
        </div>
        {isManager && (
          <Button
            className="h-11 rounded-full px-5 font-semibold lg:h-8 lg:px-4"
            onClick={() => setEditor(emptyEditor())}
          >
            + Dodaj usługę
          </Button>
        )}
      </div>

      {services.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-20 text-center">
          <h2 className="font-display text-2xl font-extrabold tracking-tight">
            Cennik jest pusty
          </h2>
          <p className="max-w-sm text-[13px] text-muted-foreground">
            Dodaj pierwszą usługę — z czasu trwania powstaje siatka terminów
            widoczna dla klientów.
          </p>
          {isManager && (
            <Button
              className="rounded-full px-5 font-semibold max-lg:h-11"
              onClick={() => setEditor(emptyEditor())}
            >
              + Dodaj usługę
            </Button>
          )}
        </div>
      ) : (
        <>
          <div
            className={cn(
              ROW_GRID,
              "hidden border-b border-border px-3 pb-2 font-mono text-[10px] tracking-[0.08em] text-muted-foreground lg:grid",
            )}
          >
            <span>USŁUGA</span>
            <span>CZAS</span>
            <span>BUFOR</span>
            <span>CENA</span>
            <span>PRACOWNICY</span>
            <span>AKTYWNA</span>
            <span />
          </div>

          {groups.map((group) => (
            <div key={group.key}>
              <div className="meta-label px-3 pt-5 pb-1.5">{group.label}</div>
              {group.services.map((service) => {
                const bufferTotal =
                  service.bufferBeforeMin + service.bufferAfterMin;
                return (
                  <Fragment key={service.id}>
                    {/* Wiersz tabeli — desktop (lg+), jak w prototypie */}
                    <div
                      className={cn(
                        ROW_GRID,
                        "hidden border-b border-muted px-3 py-3 lg:grid",
                        !service.isActive && "opacity-55",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-semibold">
                          {service.name}
                        </div>
                        {service.description && (
                          <div className="truncate text-[11.5px] text-muted-foreground">
                            {service.description}
                          </div>
                        )}
                      </div>
                      <span className="font-mono text-[13px]">
                        {service.durationMin} min
                      </span>
                      <span className="font-mono text-[13px] text-muted-foreground">
                        {bufferTotal > 0 ? `+${bufferTotal}` : "—"}
                      </span>
                      <span className="font-mono text-[13px]">
                        {formatPrice(
                          service.priceCents,
                          service.currency,
                          service.priceType,
                        )}
                      </span>
                      <AssignmentAvatars service={service} staff={staff} />
                      <Switch
                        checked={service.isActive}
                        disabled={!isManager || isPending}
                        onCheckedChange={(checked) =>
                          toggleActive(service, checked === true)
                        }
                        aria-label={`Aktywność usługi ${service.name}`}
                      />
                      {isManager ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="justify-self-end"
                          onClick={() => setEditor(editorFor(service))}
                        >
                          Edytuj
                        </Button>
                      ) : (
                        <span />
                      )}
                    </div>

                    {/* Karta — telefon/tablet (<lg) */}
                    <div
                      className={cn(
                        "flex flex-col gap-1 border-b border-muted px-1 py-3 lg:hidden",
                        !service.isActive && "opacity-55",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                          {service.name}
                        </div>
                        <span className="shrink-0 font-mono text-[13px]">
                          {formatPrice(
                            service.priceCents,
                            service.currency,
                            service.priceType,
                          )}
                        </span>
                        {isManager && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="-my-2 -mr-1 size-11 shrink-0"
                                aria-label={`Akcje usługi ${service.name}`}
                              >
                                <EllipsisVerticalIcon />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => setEditor(editorFor(service))}
                              >
                                Edytuj
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={isPending}
                                onClick={() =>
                                  toggleActive(service, !service.isActive)
                                }
                              >
                                {service.isActive
                                  ? "Wyłącz usługę"
                                  : "Włącz usługę"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                      {service.description && (
                        <div className="truncate text-[11.5px] text-muted-foreground">
                          {service.description}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
                        <span className="font-mono">
                          {service.durationMin} min
                        </span>
                        {bufferTotal > 0 && (
                          <span className="font-mono">
                            bufor +{bufferTotal} min
                          </span>
                        )}
                        {!service.isActive && (
                          <span className="font-semibold text-warning-strong">
                            wyłączona
                          </span>
                        )}
                        <AssignmentAvatars service={service} staff={staff} />
                      </div>
                    </div>
                  </Fragment>
                );
              })}
            </div>
          ))}
        </>
      )}

      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      >
        <PanelDialogContent className="sm:max-h-[90vh] sm:max-w-lg sm:overflow-y-auto">
          {editor && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {editor.serviceId ? "Edycja usługi" : "Nowa usługa"}
                </DialogTitle>
                <DialogDescription>
                  Klient widzi czas trwania — bufory blokują grafik, ale są
                  niewidoczne publicznie.
                </DialogDescription>
              </DialogHeader>

              <PanelDialogBody>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="service-name">Nazwa</Label>
                  <Input
                    id="service-name"
                    value={editor.name}
                    onChange={(event) =>
                      setEditor({ ...editor, name: event.target.value })
                    }
                    placeholder="np. Strzyżenie + broda"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="service-description">
                    Opis (opcjonalnie)
                  </Label>
                  <Textarea
                    id="service-description"
                    value={editor.description}
                    onChange={(event) =>
                      setEditor({ ...editor, description: event.target.value })
                    }
                    rows={2}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>Kategoria</Label>
                  <Select
                    value={editor.categoryChoice}
                    onValueChange={(value) =>
                      setEditor({ ...editor, categoryChoice: value })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Bez kategorii</SelectItem>
                      {categories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                      <SelectItem value="__new">+ Nowa kategoria…</SelectItem>
                    </SelectContent>
                  </Select>
                  {editor.categoryChoice === "__new" && (
                    <Input
                      value={editor.newCategoryName}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          newCategoryName: event.target.value,
                        })
                      }
                      placeholder="Nazwa nowej kategorii"
                    />
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="service-duration">Czas (min)</Label>
                    <Input
                      id="service-duration"
                      type="number"
                      min={5}
                      step={5}
                      className="font-mono"
                      value={editor.durationMin}
                      onChange={(event) =>
                        setEditor({ ...editor, durationMin: event.target.value })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="service-buffer-before">Bufor przed</Label>
                    <Input
                      id="service-buffer-before"
                      type="number"
                      min={0}
                      step={5}
                      className="font-mono"
                      value={editor.bufferBeforeMin}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          bufferBeforeMin: event.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="service-buffer-after">Bufor po</Label>
                    <Input
                      id="service-buffer-after"
                      type="number"
                      min={0}
                      step={5}
                      className="font-mono"
                      value={editor.bufferAfterMin}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          bufferAfterMin: event.target.value,
                        })
                      }
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>Cena</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.values(PriceType).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          setEditor({ ...editor, priceType: value })
                        }
                        className={cn(
                          "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors max-lg:min-h-11",
                          editor.priceType === value
                            ? "bg-ink text-ink-foreground"
                            : "border border-border bg-card text-foreground/80",
                        )}
                      >
                        {PRICE_TYPE_LABELS[value]}
                      </button>
                    ))}
                  </div>
                  {editor.priceType !== "FREE" &&
                    editor.priceType !== "ON_REQUEST" && (
                      <div className="relative">
                        <Input
                          className="pr-9 font-mono"
                          inputMode="decimal"
                          value={editor.priceZl}
                          onChange={(event) =>
                            setEditor({ ...editor, priceZl: event.target.value })
                          }
                          placeholder="np. 120"
                        />
                        <span className="absolute top-1/2 right-3 -translate-y-1/2 font-mono text-xs text-muted-foreground">
                          zł
                        </span>
                      </div>
                    )}
                </div>

                <label className="flex items-center justify-between rounded-xl border border-border bg-card px-3.5 py-2.5">
                  <span className="text-[13px] font-semibold">
                    Rezerwacja online
                  </span>
                  <Switch
                    checked={editor.onlineBookable}
                    onCheckedChange={(checked) =>
                      setEditor({ ...editor, onlineBookable: checked === true })
                    }
                  />
                </label>

                <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
                  <label className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold">
                        Zadatek online
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                        Klient widzi kwotę przy rezerwacji; przy odwołaniu w
                        terminie zadatek wraca.
                      </span>
                    </span>
                    <Switch
                      checked={editor.depositEnabled}
                      onCheckedChange={(checked) =>
                        setEditor({
                          ...editor,
                          depositEnabled: checked === true,
                          // Wyłączenie czyści kwotę — zapis wyśle null.
                          depositZl: checked === true ? editor.depositZl : "",
                        })
                      }
                    />
                  </label>
                  {editor.depositEnabled && (
                    <div className="mt-2.5 flex flex-col gap-1.5">
                      <Label htmlFor="service-deposit">Kwota zadatku</Label>
                      <div className="relative">
                        <Input
                          id="service-deposit"
                          className="pr-9 font-mono"
                          inputMode="decimal"
                          value={editor.depositZl}
                          onChange={(event) =>
                            setEditor({
                              ...editor,
                              depositZl: event.target.value,
                            })
                          }
                          placeholder="np. 50"
                        />
                        <span className="absolute top-1/2 right-3 -translate-y-1/2 font-mono text-xs text-muted-foreground">
                          zł
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Więcej niż 0 zł i nie więcej niż cena usługi.
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>Kto wykonuje · nadpisanie czasu</Label>
                  <div className="overflow-hidden rounded-xl border border-border bg-card">
                    <div className="grid grid-cols-[1.4fr_0.8fr] gap-2 border-b border-muted px-3 py-2 font-mono text-[9.5px] tracking-[0.06em] text-muted-foreground">
                      <span>PRACOWNIK</span>
                      <span>CZAS (MIN)</span>
                    </div>
                    {staff.length === 0 && (
                      <div className="px-3 py-3 text-xs text-muted-foreground">
                        Najpierw dodaj pracowników w zakładce Zespół.
                      </div>
                    )}
                    {staff.map((member) => {
                      const assignment = editor.assignments[member.id];
                      return (
                        <div
                          key={member.id}
                          className="grid grid-cols-[1.4fr_0.8fr] items-center gap-2 border-b border-muted px-3 py-2 last:border-b-0"
                        >
                          <label className="flex items-center gap-2.5 text-[12.5px] font-semibold">
                            <Checkbox
                              checked={assignment?.checked ?? false}
                              onCheckedChange={(checked) =>
                                setEditor({
                                  ...editor,
                                  assignments: {
                                    ...editor.assignments,
                                    [member.id]: {
                                      checked: checked === true,
                                      override: assignment?.override ?? "",
                                    },
                                  },
                                })
                              }
                            />
                            {member.name}
                          </label>
                          <Input
                            type="number"
                            min={5}
                            step={5}
                            className="h-7 font-mono text-xs"
                            placeholder="domyślny"
                            disabled={!assignment?.checked}
                            value={assignment?.override ?? ""}
                            onChange={(event) =>
                              setEditor({
                                ...editor,
                                assignments: {
                                  ...editor.assignments,
                                  [member.id]: {
                                    checked: assignment?.checked ?? false,
                                    override: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Nadpisania trafiają do ServiceResource i zmieniają długość
                    slotu u konkretnej osoby.
                  </p>
                </div>
              </PanelDialogBody>

              <DialogFooter className="sm:justify-between">
                {editor.serviceId ? (
                  <Button
                    variant="destructive"
                    className="rounded-full max-lg:h-11"
                    onClick={remove}
                    disabled={isPending}
                  >
                    {editor.hasBookings ? "Dezaktywuj" : "Usuń usługę"}
                  </Button>
                ) : (
                  <span className="max-sm:hidden" />
                )}
                <div className="flex gap-2 max-sm:flex-col-reverse">
                  <Button
                    variant="outline"
                    className="rounded-full max-lg:h-11"
                    onClick={() => setEditor(null)}
                    disabled={isPending}
                  >
                    Anuluj
                  </Button>
                  <Button
                    className="rounded-full font-semibold max-lg:h-11"
                    onClick={save}
                    disabled={isPending || editor.name.trim().length < 2}
                  >
                    {isPending ? "Zapisywanie…" : "Zapisz"}
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </PanelDialogContent>
      </Dialog>
    </div>
  );
}
