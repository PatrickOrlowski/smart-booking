"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  PanelDialogBody,
  PanelDialogContent,
} from "@/components/panel/panel-dialog";
import { cn } from "@/lib/utils";
import { runAction } from "@/components/panel/run-action";
import {
  deleteCombinationAction,
  saveCombinationAction,
} from "@/app/panel/(dashboard)/sale/actions";

/**
 * Zestawienia stolików — nazwane zestawy, które obsługa potrafi zsunąć w jeden
 * większy stół. Rezerwacja zestawu tworzy pozycję na KAŻDYM stoliku, więc
 * ograniczenie wykluczające w bazie pilnuje ich pojedynczo.
 */

export type CombinationTableOption = {
  id: string;
  tableNumber: string;
  roomName: string;
  capacityMin: number;
  capacityMax: number;
  combinable: boolean;
};

export type PanelCombination = {
  id: string;
  name: string;
  capacityMin: number;
  capacityMax: number;
  isActive: boolean;
  memberIds: string[];
};

type EditorState = {
  combinationId: string | null;
  name: string;
  capacityMin: string;
  capacityMax: string;
  isActive: boolean;
  memberIds: string[];
};

export function TableCombinationsView({
  businessId,
  locationId,
  combinations,
  tables,
  isManager,
}: {
  businessId: string;
  locationId: string;
  combinations: PanelCombination[];
  tables: CombinationTableOption[];
  isManager: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editor, setEditor] = useState<EditorState | null>(null);

  const byId = new Map(tables.map((table) => [table.id, table]));
  const rooms = [...new Set(tables.map((table) => table.roomName))];

  const emptyEditor = (): EditorState => ({
    combinationId: null,
    name: "",
    capacityMin: "",
    capacityMax: "",
    isActive: true,
    memberIds: [],
  });

  const toggleMember = (tableId: string) => {
    if (!editor) return;
    const has = editor.memberIds.includes(tableId);
    setEditor({
      ...editor,
      memberIds: has
        ? editor.memberIds.filter((id) => id !== tableId)
        : [...editor.memberIds, tableId],
    });
  };

  /** Suma pojemności zaznaczonych stolików — podpowiedź, nie twarda reguła. */
  const suggested = editor
    ? editor.memberIds.reduce(
        (sum, id) => {
          const table = byId.get(id);
          return table
            ? {
                min: sum.min + table.capacityMin,
                max: sum.max + table.capacityMax,
              }
            : sum;
        },
        { min: 0, max: 0 },
      )
    : { min: 0, max: 0 };

  const save = () => {
    if (!editor) return;
    const capacityMin = Number(editor.capacityMin);
    const capacityMax = Number(editor.capacityMax);
    if (editor.memberIds.length < 2) {
      toast.error("Zestawienie musi mieć co najmniej 2 stoliki");
      return;
    }
    if (
      !Number.isFinite(capacityMin) ||
      !Number.isFinite(capacityMax) ||
      capacityMin < 1 ||
      capacityMax < capacityMin
    ) {
      toast.error("Podaj poprawny zakres pojemności");
      return;
    }
    // Ta sama granica co na serwerze: zestawienie nie może obiecywać więcej
    // miejsc, niż fizycznie jest przy wybranych stołach.
    if (capacityMax > suggested.max) {
      toast.error(
        `Wybrane stoliki mają razem ${suggested.max} miejsc — „do” nie może być większe`,
      );
      return;
    }
    startTransition(async () => {
      const result = await runAction(() =>
        saveCombinationAction({
          businessId,
          locationId,
          combinationId: editor.combinationId ?? undefined,
          name: editor.name.trim(),
          capacityMin,
          capacityMax,
          resourceIds: editor.memberIds,
          isActive: editor.isActive,
        }),
      );
      if (result.ok) {
        toast.success(
          editor.combinationId ? "Zapisano zestawienie" : "Zestawienie dodane",
        );
        setEditor(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const remove = (combinationId: string) => {
    startTransition(async () => {
      const result = await runAction(() =>
        deleteCombinationAction({ businessId, combinationId }),
      );
      if (result.ok) {
        toast.success("Zestawienie usunięte");
        setEditor(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-[12.5px] text-muted-foreground">
          Zestawienie pozwala przyjąć grupę większą niż największy stolik.
          Rezerwacja blokuje wszystkie stoliki zestawu naraz.
        </p>
        {isManager && (
          <Button
            className="h-9 rounded-full px-4 font-semibold max-lg:h-11"
            onClick={() => setEditor(emptyEditor())}
            disabled={tables.length < 2}
          >
            + Dodaj zestawienie
          </Button>
        )}
      </div>

      {combinations.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-14 text-center">
          <h2 className="font-display text-xl font-extrabold tracking-tight">
            Brak zestawień
          </h2>
          <p className="max-w-sm text-[13px] text-muted-foreground">
            Dodaj zestaw dwóch lub więcej stolików, żeby przyjmować większe
            grupy bez telefonu do lokalu.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {combinations.map((combination) => {
            const members = combination.memberIds
              .map((id) => byId.get(id))
              .filter((table): table is CombinationTableOption => Boolean(table));
            return (
              <div
                key={combination.id}
                className={cn(
                  "flex flex-col gap-2 rounded-2xl border border-border bg-card p-4",
                  !combination.isActive && "opacity-60",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-semibold">
                      {combination.name}
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {combination.capacityMin}–{combination.capacityMax} osób
                      {combination.isActive ? "" : " · wyłączone"}
                    </div>
                  </div>
                  {isManager && (
                    <Button
                      variant="ghost"
                      className="h-8 shrink-0 rounded-full px-3 text-xs max-lg:h-11"
                      onClick={() =>
                        setEditor({
                          combinationId: combination.id,
                          name: combination.name,
                          capacityMin: String(combination.capacityMin),
                          capacityMax: String(combination.capacityMax),
                          isActive: combination.isActive,
                          memberIds: [...combination.memberIds],
                        })
                      }
                    >
                      Edytuj
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {members.map((table) => (
                    <span
                      key={table.id}
                      className="rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-[11px]"
                    >
                      {table.tableNumber}
                      <span className="ml-1 text-muted-foreground">
                        {table.roomName}
                      </span>
                    </span>
                  ))}
                  {members.length !== combination.memberIds.length && (
                    <span className="rounded-full bg-destructive/10 px-2.5 py-1 font-mono text-[11px] text-destructive">
                      brakujący stolik
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
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
                  {editor.combinationId ? "Edycja zestawienia" : "Nowe zestawienie"}
                </DialogTitle>
                <DialogDescription>
                  Wybierz co najmniej dwa stoliki i podaj, ile osób przy nich
                  usiądzie po zsunięciu.
                </DialogDescription>
              </DialogHeader>

              <PanelDialogBody>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="combination-name">Nazwa</Label>
                  <Input
                    id="combination-name"
                    value={editor.name}
                    onChange={(event) =>
                      setEditor({ ...editor, name: event.target.value })
                    }
                    placeholder="np. 9+10 (duża grupa)"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="combination-min">Pojemność od</Label>
                    <Input
                      id="combination-min"
                      type="number"
                      min={1}
                      className="font-mono"
                      value={editor.capacityMin}
                      onChange={(event) =>
                        setEditor({ ...editor, capacityMin: event.target.value })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="combination-max">Pojemność do</Label>
                    <Input
                      id="combination-max"
                      type="number"
                      min={1}
                      className="font-mono"
                      value={editor.capacityMax}
                      onChange={(event) =>
                        setEditor({ ...editor, capacityMax: event.target.value })
                      }
                    />
                  </div>
                </div>

                {editor.memberIds.length >= 2 && (
                  <button
                    type="button"
                    className="self-start rounded-lg border border-border bg-muted px-3 py-1.5 font-mono text-[11px] max-lg:min-h-11"
                    onClick={() =>
                      setEditor({
                        ...editor,
                        capacityMin: String(suggested.min),
                        capacityMax: String(suggested.max),
                      })
                    }
                  >
                    suma pojemności: {suggested.min}–{suggested.max} → wstaw
                  </button>
                )}

                <div className="flex flex-col gap-1.5">
                  <Label>Stoliki w zestawieniu</Label>
                  <div className="overflow-hidden rounded-xl border border-border bg-card">
                    {tables.length === 0 && (
                      <div className="px-3 py-3 text-xs text-muted-foreground">
                        Najpierw dodaj stoliki w zakładce Sale i plan.
                      </div>
                    )}
                    {rooms.map((roomName) => (
                      <div key={roomName}>
                        <div className="meta-label border-b border-muted bg-muted/50 px-3 py-1.5">
                          {roomName}
                        </div>
                        {tables
                          .filter((table) => table.roomName === roomName)
                          .map((table) => (
                            /* Stolik oznaczony jako niezestawialny jest
                               nieklikalny — serwer i tak odrzuci taki skład
                               (saveCombinationAction), a wcześniej checkbox
                               działał mimo dopisku „nie zestawia się". */
                            <label
                              key={table.id}
                              data-testid={`combo-table-${table.tableNumber}`}
                              className={
                                table.combinable
                                  ? "flex min-h-11 items-center gap-2.5 border-b border-muted px-3 py-2 last:border-b-0"
                                  : "flex min-h-11 items-center gap-2.5 border-b border-muted px-3 py-2 opacity-55 last:border-b-0"
                              }
                            >
                              <Checkbox
                                checked={editor.memberIds.includes(table.id)}
                                disabled={!table.combinable}
                                onCheckedChange={() => toggleMember(table.id)}
                              />
                              <span className="font-display text-[13px] font-extrabold">
                                {table.tableNumber}
                              </span>
                              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                                {table.capacityMin}–{table.capacityMax} os.
                                {table.combinable ? "" : " · nie zestawia się"}
                              </span>
                            </label>
                          ))}
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Wybrano {editor.memberIds.length} z {tables.length} stolików.
                  </p>
                </div>

                <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5">
                  <span className="text-[13px] font-semibold">
                    Zestawienie dostępne
                  </span>
                  <Switch
                    checked={editor.isActive}
                    onCheckedChange={(checked) =>
                      setEditor({ ...editor, isActive: checked === true })
                    }
                  />
                </label>
              </PanelDialogBody>

              <DialogFooter className="sm:justify-between">
                {editor.combinationId ? (
                  <Button
                    variant="destructive"
                    className="rounded-full max-lg:h-11"
                    onClick={() => remove(editor.combinationId!)}
                    disabled={isPending}
                  >
                    Usuń zestawienie
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
                    disabled={isPending || editor.name.trim().length === 0}
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
