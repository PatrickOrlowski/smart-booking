"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import type { StaffRole, TimeOffType } from "@/generated/prisma/enums";
import {
  STAFF_ROLE_LABELS,
  TIME_OFF_LABELS,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT,
  formatMinutes,
  initials,
  timeOptions,
} from "@/components/panel/format";
import {
  addStaffAction,
  addTimeOffAction,
  deactivateStaffAction,
  deleteTimeOffAction,
  saveScheduleAction,
} from "@/app/panel/(dashboard)/zespol/actions";

export type TeamTimeOff = {
  id: string;
  type: TimeOffType;
  rangeLabel: string;
  reason: string | null;
};

export type TeamMember = {
  resourceId: string;
  name: string;
  title: string | null;
  role: StaffRole;
  invitedEmail: string | null;
  hasAccount: boolean;
  schedule: { weekday: number; startMinute: number; endMinute: number }[];
  timeOff: TeamTimeOff[];
};

type ScheduleDay = { startMinute: number; endMinute: number }[];

const TIME_OPTIONS = timeOptions(0, 24 * 60, 30);
const ADDABLE_TIME_OFF: TimeOffType[] = ["VACATION", "SICK_LEAVE", "BLOCKED"];

/** Zespół i grafiki: karty pracowników, tygodniowy grafik, urlopy. */
export function TeamView({
  businessId,
  members,
  isManager,
}: {
  businessId: string;
  members: TeamMember[];
  isManager: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const [scheduleFor, setScheduleFor] = useState<string | null>(null);
  const [scheduleDays, setScheduleDays] = useState<ScheduleDay[]>([]);

  const [timeOffFor, setTimeOffFor] = useState<string | null>(null);
  const [timeOffType, setTimeOffType] = useState<TimeOffType>("VACATION");
  const [timeOffStart, setTimeOffStart] = useState("");
  const [timeOffEnd, setTimeOffEnd] = useState("");
  const [timeOffReason, setTimeOffReason] = useState("");

  const scheduleMember =
    members.find((member) => member.resourceId === scheduleFor) ?? null;
  const timeOffMember =
    members.find((member) => member.resourceId === timeOffFor) ?? null;

  const openSchedule = (member: TeamMember) => {
    const days: ScheduleDay[] = WEEKDAY_LABELS.map((_, weekday) =>
      member.schedule
        .filter((block) => block.weekday === weekday)
        .sort((a, b) => a.startMinute - b.startMinute)
        .slice(0, 2)
        .map((block) => ({
          startMinute: block.startMinute,
          endMinute: block.endMinute,
        })),
    );
    setScheduleDays(days);
    setScheduleFor(member.resourceId);
  };

  const submitAddStaff = () => {
    startTransition(async () => {
      const result = await addStaffAction({
        businessId,
        name: newName.trim(),
        title: newTitle.trim() || undefined,
        invitedEmail: newEmail.trim() || undefined,
      });
      if (result.ok) {
        toast.success("Pracownik dodany do zespołu");
        setAddOpen(false);
        setNewName("");
        setNewTitle("");
        setNewEmail("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const submitSchedule = () => {
    if (!scheduleMember) return;
    const blocks = scheduleDays.flatMap((day, weekday) =>
      day.map((block) => ({ weekday, ...block })),
    );
    for (const block of blocks) {
      if (block.startMinute >= block.endMinute) {
        toast.error("Koniec bloku musi być po jego początku");
        return;
      }
    }
    startTransition(async () => {
      const result = await saveScheduleAction({
        businessId,
        resourceId: scheduleMember.resourceId,
        blocks,
      });
      if (result.ok) {
        toast.success(`Grafik zapisany · ${scheduleMember.name}`);
        setScheduleFor(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const submitTimeOff = () => {
    if (!timeOffMember) return;
    startTransition(async () => {
      const result = await addTimeOffAction({
        businessId,
        resourceId: timeOffMember.resourceId,
        type: timeOffType,
        startDate: timeOffStart,
        endDate: timeOffEnd,
        reason: timeOffReason.trim() || undefined,
      });
      if (result.ok) {
        toast.success("Urlop dodany");
        setTimeOffStart("");
        setTimeOffEnd("");
        setTimeOffReason("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  // Dezaktywacja pracownika — bez niej firma nad limitem niższego planu
  // nigdy nie mogła zrobić downgrade'u (komunikat „zmniejsz zespół" wskazywał
  // akcję, której w produkcie nie było).
  const deactivateMember = (member: TeamMember) => {
    if (
      !window.confirm(
        `Dezaktywować pracownika ${member.name}? Zniknie z kalendarza i dostępności; historia wizyt zostaje.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deactivateStaffAction({
        businessId,
        resourceId: member.resourceId,
      });
      if (result.ok) {
        toast.success(`${member.name} — pracownik dezaktywowany`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const removeTimeOff = (timeOffId: string) => {
    startTransition(async () => {
      const result = await deleteTimeOffAction({ businessId, timeOffId });
      if (result.ok) {
        toast.success("Wpis usunięty");
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
            Zespół i grafiki
          </h1>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
            {members.length}{" "}
            {members.length === 1 ? "osoba" : members.length < 5 ? "osoby" : "osób"}{" "}
            · szablon tygodniowy per pracownik
          </div>
        </div>
        {isManager && (
          <Button
            className="h-11 rounded-full px-5 font-semibold lg:h-8 lg:px-4"
            onClick={() => setAddOpen(true)}
          >
            + Dodaj pracownika
          </Button>
        )}
      </div>

      {members.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-20 text-center">
          <h2 className="font-display text-2xl font-extrabold tracking-tight">
            Zespół jest pusty
          </h2>
          <p className="max-w-sm text-[13px] text-muted-foreground">
            Dodaj pierwszą osobę — każdy pracownik dostaje kolumnę w kalendarzu
            i własny grafik tygodniowy.
          </p>
          {isManager && (
            <Button
              className="rounded-full px-5 font-semibold max-lg:h-11"
              onClick={() => setAddOpen(true)}
            >
              + Dodaj pracownika
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {members.map((member) => (
            <div
              key={member.resourceId}
              className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5"
            >
              <div className="flex items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-full bg-muted font-display text-sm font-bold">
                  {initials(member.name)}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-bold tracking-tight">
                    {member.name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {member.title ?? "—"}
                  </div>
                </div>
                <Badge variant="secondary" className="ml-auto shrink-0">
                  {STAFF_ROLE_LABELS[member.role]}
                </Badge>
              </div>

              {!member.hasAccount && (
                <div className="rounded-lg border border-dashed border-border bg-background px-3 py-2 text-[11.5px] text-muted-foreground">
                  {member.invitedEmail
                    ? `Zaproszenie: ${member.invitedEmail} · konto niepowiązane`
                    : "Bez konta — dodaj e-mail zaproszenia w kolejnej fazie"}
                </div>
              )}

              <div>
                <div className="meta-label mb-2">Grafik tygodniowy</div>
                <div className="flex flex-col gap-1">
                  {WEEKDAY_SHORT.map((label, weekday) => {
                    const blocks = member.schedule
                      .filter((block) => block.weekday === weekday)
                      .sort((a, b) => a.startMinute - b.startMinute);
                    return (
                      <div
                        key={label}
                        className="flex items-baseline gap-3 text-xs"
                      >
                        <span className="w-5 font-mono text-[10px] uppercase text-muted-foreground">
                          {label}
                        </span>
                        {blocks.length === 0 ? (
                          <span className="text-muted-foreground/70">wolne</span>
                        ) : (
                          <span className="font-mono text-[11.5px]">
                            {blocks
                              .map(
                                (block) =>
                                  `${formatMinutes(block.startMinute)}–${formatMinutes(block.endMinute)}`,
                              )
                              .join(" · ")}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {member.timeOff.length > 0 && (
                <div className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-[11.5px] text-warning-strong">
                  {TIME_OFF_LABELS[member.timeOff[0].type]} ·{" "}
                  <span className="font-mono">{member.timeOff[0].rangeLabel}</span>
                  {member.timeOff.length > 1 &&
                    ` (+${member.timeOff.length - 1})`}
                </div>
              )}

              {isManager && (
                <div className="mt-auto flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 rounded-full font-semibold max-lg:h-11"
                    onClick={() => openSchedule(member)}
                  >
                    Edytuj grafik
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 rounded-full font-semibold max-lg:h-11"
                    onClick={() => {
                      setTimeOffFor(member.resourceId);
                      setTimeOffType("VACATION");
                    }}
                  >
                    Urlopy
                    {member.timeOff.length > 0 && ` (${member.timeOff.length})`}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    aria-label={`Dezaktywuj pracownika ${member.name}`}
                    title="Dezaktywuj pracownika"
                    className="rounded-full font-semibold max-lg:h-11"
                    onClick={() => deactivateMember(member)}
                  >
                    Dezaktywuj
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Dialog: nowy pracownik */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <PanelDialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Nowy pracownik</DialogTitle>
            <DialogDescription>
              Powstanie zasób w kalendarzu i profil bez konta — pracownik
              dowiąże je po zaproszeniu.
            </DialogDescription>
          </DialogHeader>
          <PanelDialogBody>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="staff-name">Imię i nazwisko</Label>
              <Input
                id="staff-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="np. Ala Wiśniewska"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="staff-title">Stanowisko (opcjonalnie)</Label>
              <Input
                id="staff-title"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder="np. Barber"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="staff-email">E-mail zaproszenia (opcjonalnie)</Label>
              <Input
                id="staff-email"
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                placeholder="ala@przyklad.pl"
              />
            </div>
          </PanelDialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-full max-lg:h-11"
              onClick={() => setAddOpen(false)}
              disabled={isPending}
            >
              Anuluj
            </Button>
            <Button
              className="rounded-full font-semibold max-lg:h-11"
              onClick={submitAddStaff}
              disabled={isPending || newName.trim().length < 2}
            >
              {isPending ? "Dodawanie…" : "Dodaj pracownika"}
            </Button>
          </DialogFooter>
        </PanelDialogContent>
      </Dialog>

      {/* Dialog: grafik tygodniowy */}
      <Dialog
        open={scheduleMember !== null}
        onOpenChange={(open) => {
          if (!open) setScheduleFor(null);
        }}
      >
        <PanelDialogContent className="sm:max-h-[90vh] sm:max-w-lg sm:overflow-y-auto">
          {scheduleMember && (
            <>
              <DialogHeader>
                <DialogTitle>Grafik · {scheduleMember.name}</DialogTitle>
                <DialogDescription>
                  Szablon tygodniowy — maksymalnie 2 bloki na dzień, wybór co
                  30 minut.
                </DialogDescription>
              </DialogHeader>

              <PanelDialogBody className="gap-2.5">
                {WEEKDAY_LABELS.map((label, weekday) => {
                  const day = scheduleDays[weekday] ?? [];
                  return (
                    <div
                      key={label}
                      className="rounded-xl border border-border bg-card px-3.5 py-2.5"
                    >
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[12.5px] font-bold">{label}</span>
                        {day.length === 0 && (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            wolne
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {day.map((block, blockIndex) => (
                          <div
                            key={blockIndex}
                            className="flex items-center gap-2"
                          >
                            <TimeSelect
                              value={block.startMinute}
                              options={TIME_OPTIONS.filter(
                                (minute) => minute < 24 * 60,
                              )}
                              onChange={(minute) =>
                                setScheduleDays((previous) =>
                                  previous.map((entry, index) =>
                                    index === weekday
                                      ? entry.map((candidate, position) =>
                                          position === blockIndex
                                            ? {
                                                startMinute: minute,
                                                endMinute: Math.max(
                                                  candidate.endMinute,
                                                  minute + 30,
                                                ),
                                              }
                                            : candidate,
                                        )
                                      : entry,
                                  ),
                                )
                              }
                            />
                            <span className="text-xs text-muted-foreground">
                              –
                            </span>
                            <TimeSelect
                              value={block.endMinute}
                              options={TIME_OPTIONS.filter(
                                (minute) => minute > block.startMinute,
                              )}
                              onChange={(minute) =>
                                setScheduleDays((previous) =>
                                  previous.map((entry, index) =>
                                    index === weekday
                                      ? entry.map((candidate, position) =>
                                          position === blockIndex
                                            ? {
                                                ...candidate,
                                                endMinute: minute,
                                              }
                                            : candidate,
                                        )
                                      : entry,
                                  ),
                                )
                              }
                            />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="shrink-0 max-lg:size-11"
                              aria-label="Usuń blok"
                              onClick={() =>
                                setScheduleDays((previous) =>
                                  previous.map((entry, index) =>
                                    index === weekday
                                      ? entry.filter(
                                          (_, position) =>
                                            position !== blockIndex,
                                        )
                                      : entry,
                                  ),
                                )
                              }
                            >
                              ✕
                            </Button>
                          </div>
                        ))}
                        {day.length < 2 && (
                          <button
                            type="button"
                            className="rounded-lg border border-dashed border-border py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground max-lg:min-h-11"
                            onClick={() =>
                              setScheduleDays((previous) =>
                                previous.map((entry, index) =>
                                  index === weekday
                                    ? [
                                        ...entry,
                                        entry.length === 1
                                          ? {
                                              startMinute: Math.min(
                                                entry[0].endMinute + 60,
                                                23 * 60,
                                              ),
                                              endMinute: Math.min(
                                                entry[0].endMinute + 240,
                                                24 * 60,
                                              ),
                                            }
                                          : {
                                              startMinute: 9 * 60,
                                              endMinute: 17 * 60,
                                            },
                                      ]
                                    : entry,
                                ),
                              )
                            }
                          >
                            + blok
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </PanelDialogBody>

              <DialogFooter>
                <Button
                  variant="outline"
                  className="rounded-full max-lg:h-11"
                  onClick={() => setScheduleFor(null)}
                  disabled={isPending}
                >
                  Anuluj
                </Button>
                <Button
                  className="rounded-full font-semibold max-lg:h-11"
                  onClick={submitSchedule}
                  disabled={isPending}
                >
                  {isPending ? "Zapisywanie…" : "Zapisz grafik"}
                </Button>
              </DialogFooter>
            </>
          )}
        </PanelDialogContent>
      </Dialog>

      {/* Dialog: urlopy i blokady */}
      <Dialog
        open={timeOffMember !== null}
        onOpenChange={(open) => {
          if (!open) setTimeOffFor(null);
        }}
      >
        <PanelDialogContent className="sm:max-w-md">
          {timeOffMember && (
            <>
              <DialogHeader>
                <DialogTitle>Urlopy · {timeOffMember.name}</DialogTitle>
                <DialogDescription>
                  Wpisy blokują cały zakres dat w kalendarzu pracownika.
                </DialogDescription>
              </DialogHeader>

              <PanelDialogBody className="gap-4">
              <div className="flex flex-col gap-2">
                {timeOffMember.timeOff.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                    Brak nadchodzących urlopów i blokad
                  </div>
                )}
                {timeOffMember.timeOff.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold">
                        {TIME_OFF_LABELS[entry.type]}
                        {entry.reason ? ` · ${entry.reason}` : ""}
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {entry.rangeLabel}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 max-lg:size-11"
                      aria-label="Usuń wpis"
                      onClick={() => removeTimeOff(entry.id)}
                      disabled={isPending}
                    >
                      ✕
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3.5">
                <div className="meta-label">Nowy wpis</div>
                <Select
                  value={timeOffType}
                  onValueChange={(value) =>
                    setTimeOffType(value as TimeOffType)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ADDABLE_TIME_OFF.map((type) => (
                      <SelectItem key={type} value={type}>
                        {TIME_OFF_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="timeoff-start">Od</Label>
                    <Input
                      id="timeoff-start"
                      type="date"
                      value={timeOffStart}
                      onChange={(event) => setTimeOffStart(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="timeoff-end">Do (włącznie)</Label>
                    <Input
                      id="timeoff-end"
                      type="date"
                      value={timeOffEnd}
                      onChange={(event) => setTimeOffEnd(event.target.value)}
                    />
                  </div>
                </div>
                <Input
                  value={timeOffReason}
                  onChange={(event) => setTimeOffReason(event.target.value)}
                  placeholder="Powód (opcjonalnie)"
                />
                <Button
                  className="rounded-full font-semibold max-lg:h-11"
                  onClick={submitTimeOff}
                  disabled={isPending || !timeOffStart || !timeOffEnd}
                >
                  {isPending ? "Zapisywanie…" : "Dodaj wpis"}
                </Button>
              </div>
              </PanelDialogBody>
            </>
          )}
        </PanelDialogContent>
      </Dialog>
    </div>
  );
}

function TimeSelect({
  value,
  options,
  onChange,
}: {
  value: number;
  options: number[];
  onChange: (minute: number) => void;
}) {
  return (
    <Select
      value={String(value)}
      onValueChange={(next) => onChange(Number(next))}
    >
      <SelectTrigger className="w-[92px] font-mono text-xs max-lg:min-h-11 max-sm:w-auto max-sm:min-w-0 max-sm:flex-1">
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
