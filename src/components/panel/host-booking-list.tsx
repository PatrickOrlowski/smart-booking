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
} from "@/components/ui/dialog";
import {
  PanelDialogBody,
  PanelDialogContent,
} from "@/components/panel/panel-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMinutes } from "@/components/panel/format";
import { cn } from "@/lib/utils";
import type { BookingStatus, BookingSource } from "@/generated/prisma/enums";
import {
  cancelTableBookingAction,
  confirmTableBookingAction,
  markTableNoShowAction,
  seatTableBookingAction,
} from "@/app/panel/(dashboard)/dzis/actions";

/**
 * Lista rezerwacji dnia z akcjami hosta. Godziny w DM Mono (przepis
 * z DESIGN.md), wszystkie czasy przeliczone już na serwerze do strefy lokalu.
 */

export type HostBooking = {
  id: string;
  /** Minuty od północy czasu lokalu. */
  startMin: number;
  endMin: number;
  /** Koniec blokady = wyjście gości + bufor na sprzątanie. */
  blockedEndMin: number;
  tableIds: string[];
  tablesLabel: string;
  guestName: string;
  guestPhone: string | null;
  partySize: number | null;
  status: BookingStatus;
  source: BookingSource;
  customerNote: string | null;
  internalNote: string | null;
  /** Czy rezerwacja zajmuje stolik (statusy PENDING/CONFIRMED/COMPLETED). */
  blocking: boolean;
  /** Godzina posadzenia gości z wpisu audytu (BOOKING_SEATED). */
  seatedAtLabel: string | null;
};

const STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: "oczekuje",
  CONFIRMED: "potwierdzona",
  // Posadzenie gościa NIE zmienia statusu (zostaje CONFIRMED + wpis audytu
  // widoczny jako „posadzeni HH:MM") — COMPLETED to wizyta już rozliczona.
  COMPLETED: "zakończona",
  CANCELLED_BY_CUSTOMER: "odwołana",
  CANCELLED_BY_BUSINESS: "odwołana",
  NO_SHOW: "nie przyszli",
};

const STATUS_CLASSES: Record<BookingStatus, string> = {
  PENDING: "border-warning/60 bg-warning-soft text-warning-strong dark:text-warning",
  CONFIRMED: "border-border-strong bg-card text-foreground",
  COMPLETED: "border-transparent bg-primary text-primary-foreground",
  CANCELLED_BY_CUSTOMER: "border-border bg-muted text-muted-foreground",
  CANCELLED_BY_BUSINESS: "border-border bg-muted text-muted-foreground",
  NO_SHOW: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function HostBookingList({
  businessId,
  bookings,
  canManage,
  isToday,
  nowMin,
  viewMin,
}: {
  businessId: string;
  bookings: HostBooking[];
  canManage: boolean;
  isToday: boolean;
  nowMin: number | null;
  /** Godzina podglądu — wiersz trwający w tej chwili jest wyróżniony. */
  viewMin: number;
}) {
  if (bookings.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-10 text-center">
        <p className="font-display text-lg font-extrabold tracking-tight">
          Brak rezerwacji
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Tego dnia nikt jeszcze nie zarezerwował stolika.
        </p>
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-2">
      {bookings.map((booking) => (
        <BookingRow
          key={booking.id}
          businessId={businessId}
          booking={booking}
          canManage={canManage}
          isToday={isToday}
          nowMin={nowMin}
          active={
            booking.blocking &&
            booking.startMin <= viewMin &&
            viewMin < booking.endMin
          }
        />
      ))}
    </ol>
  );
}

function BookingRow({
  businessId,
  booking,
  canManage,
  isToday,
  nowMin,
  active,
}: {
  businessId: string;
  booking: HostBooking;
  canManage: boolean;
  isToday: boolean;
  nowMin: number | null;
  active: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [cancelOpen, setCancelOpen] = useState(false);

  const run = (
    action: (input: unknown) => Promise<
      { ok: true; message?: string } | { ok: false; error: string }
    >,
  ) => {
    startTransition(async () => {
      const result = await action({ businessId, bookingId: booking.id });
      if (result.ok) {
        toast.success(result.message ?? "Zapisano");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const started = isToday && nowMin !== null && booking.startMin <= nowMin;
  const open = booking.status === "PENDING" || booking.status === "CONFIRMED";

  return (
    <li
      className={cn(
        "rounded-2xl border bg-card px-3 py-3 transition-colors",
        active ? "border-[1.5px] border-border-strong" : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0">
          <div className="font-mono text-[15px] leading-none font-medium">
            {formatMinutes(booking.startMin)}
          </div>
          <div className="mt-1 font-mono text-[10px] leading-none text-muted-foreground">
            do {formatMinutes(booking.endMin)}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[14.5px] font-semibold">
              {booking.guestName}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.04em] uppercase",
                STATUS_CLASSES[booking.status],
              )}
            >
              {STATUS_LABELS[booking.status]}
            </span>
          </div>
          <div className="mt-1 font-mono text-[11.5px] text-muted-foreground">
            {booking.partySize !== null ? `${booking.partySize} os.` : "—"} ·{" "}
            {booking.tablesLabel || "bez stolika"}
            {booking.source === "MANUAL_STAFF" ? " · z ulicy" : ""}
            {booking.seatedAtLabel ? ` · posadzeni ${booking.seatedAtLabel}` : ""}
          </div>
          {booking.guestPhone ? (
            <div className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">
              {booking.guestPhone}
            </div>
          ) : null}
          {booking.customerNote ? (
            <p className="mt-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-[12px] leading-snug text-foreground/80">
              „{booking.customerNote}”
            </p>
          ) : null}
          {booking.internalNote ? (
            <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">
              Notatka: {booking.internalNote}
            </p>
          ) : null}
        </div>
      </div>

      {canManage && open ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {booking.status === "PENDING" ? (
            <Button
              size="sm"
              className="rounded-full px-3.5 font-semibold max-lg:h-11"
              disabled={isPending}
              onClick={() => run(confirmTableBookingAction)}
            >
              Potwierdź
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={booking.status === "CONFIRMED" ? "default" : "outline"}
            className="rounded-full px-3.5 font-semibold max-lg:h-11"
            disabled={isPending || !isToday}
            title={isToday ? undefined : "Sadzanie gości działa tylko dzisiaj"}
            onClick={() => run(seatTableBookingAction)}
          >
            Posadź
          </Button>
          {started ? (
            <Button
              size="sm"
              variant="outline"
              className="rounded-full px-3.5 max-lg:h-11"
              disabled={isPending}
              onClick={() => run(markTableNoShowAction)}
            >
              Nie przyszli
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="rounded-full px-3.5 text-destructive max-lg:h-11"
            disabled={isPending}
            onClick={() => setCancelOpen(true)}
          >
            Odwołaj
          </Button>
        </div>
      ) : null}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <CancelBookingDialog
          businessId={businessId}
          booking={booking}
          onClose={() => setCancelOpen(false)}
        />
      </Dialog>
    </li>
  );
}

function CancelBookingDialog({
  businessId,
  booking,
  onClose,
}: {
  businessId: string;
  booking: HostBooking;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await cancelTableBookingAction({
        businessId,
        bookingId: booking.id,
        reason: reason.trim() || undefined,
      });
      if (result.ok) {
        toast.success(result.message ?? "Rezerwacja odwołana");
        onClose();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <PanelDialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Odwołać rezerwację?</DialogTitle>
        <DialogDescription>
          {booking.guestName} · {formatMinutes(booking.startMin)} ·{" "}
          {booking.partySize ?? "?"} os. · {booking.tablesLabel || "bez stolika"}.
          Gość dostanie e-mail z informacją o odwołaniu.
        </DialogDescription>
      </DialogHeader>
      <PanelDialogBody>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cancel-reason">Powód (opcjonalnie)</Label>
          <Textarea
            id="cancel-reason"
            rows={2}
            value={reason}
            maxLength={200}
            onChange={(event) => setReason(event.target.value)}
            placeholder="np. awaria w kuchni"
          />
        </div>
      </PanelDialogBody>
      <DialogFooter>
        <Button
          variant="outline"
          className="rounded-full max-lg:h-11"
          onClick={onClose}
          disabled={isPending}
        >
          Zostaw
        </Button>
        <Button
          className="rounded-full font-semibold max-lg:h-11"
          onClick={submit}
          disabled={isPending}
        >
          {isPending ? "Odwoływanie…" : "Odwołaj rezerwację"}
        </Button>
      </DialogFooter>
    </PanelDialogContent>
  );
}
