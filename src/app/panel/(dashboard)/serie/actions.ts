"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { sendMail } from "@/lib/mail";
import { refundPackageEntryForBooking } from "@/lib/packages";
import { settleBookingPaymentsOnCancellation } from "@/lib/payments";
import { utcToZonedWallClock } from "@/lib/time";
import { emitEvent } from "@/lib/webhooks";
import { sendBookingCancellationEmails } from "@/app/api/v1/bookings/emails";
import {
  ForbiddenError,
  UnauthorizedError,
  requireBusinessManager,
} from "@/lib/authz";
import {
  MAX_SERIES_INTERVAL_WEEKS,
  MAX_SERIES_OCCURRENCES,
  SeriesPlanError,
} from "@/lib/booking-series";
import {
  checkPlannedVisits,
  dayLabelOf,
  formatVisitLabel,
  isOverlapError,
  loadSeriesContext,
  planSeriesVisits,
  type PlannedSlotPreview,
} from "./series-data";
import { findOrCreateCustomerForBooking } from "@/app/panel/(dashboard)/klienci/customer-match";

/**
 * Akcje rezerwacji cyklicznych: podgląd terminów, wygenerowanie serii,
 * odwołanie pojedynczej wizyty i zakończenie serii.
 *
 * Każda mutacja przechodzi przez `requireBusinessManager` — grafik cudzej
 * firmy nie może zostać zapisany przez podstawienie businessId w formularzu.
 */

type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ruleFields = z.object({
  businessId: z.string().min(1),
  resourceId: z.string().min(1),
  serviceId: z.string().min(1),
  startDate: z.string().regex(DATE_RE, "Nieprawidłowa data startu"),
  weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  intervalWeeks: z.number().int().min(1).max(MAX_SERIES_INTERVAL_WEEKS),
  occurrences: z
    .number()
    .int()
    .min(1)
    .max(MAX_SERIES_OCCURRENCES)
    .nullable()
    .optional(),
  endDate: z
    .string()
    .regex(DATE_RE, "Nieprawidłowa data końca")
    .nullable()
    .optional(),
});

/** Seria musi mieć koniec — albo liczba powtórzeń, albo data. */
const hasEnd = {
  check: (data: { occurrences?: number | null; endDate?: string | null }) =>
    data.occurrences != null || data.endDate != null,
  message: "Podaj liczbę powtórzeń albo datę końca serii",
};

const ruleSchema = ruleFields.refine(hasEnd.check, {
  message: hasEnd.message,
  path: ["occurrences"],
});

const createSchema = ruleFields
  .extend({
    customerName: z
      .string()
      .trim()
      .min(2, "Podaj imię i nazwisko klienta")
      .max(120),
    customerPhone: z.string().trim().max(30).optional(),
    customerEmail: z.email("Nieprawidłowy e-mail").optional().or(z.literal("")),
    note: z.string().trim().max(500).optional(),
  })
  .refine(hasEnd.check, { message: hasEnd.message, path: ["occurrences"] });

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
    return { ok: false, error: error.message };
  }
  if (error instanceof SeriesPlanError) {
    return { ok: false, error: error.message };
  }
  console.error(fallback, error);
  return { ok: false, error: fallback };
}

/** "2026-09-10" → północ UTC (kolumny @db.Date trzymają samą datę). */
const toDateColumn = (iso: string): Date => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
};

/**
 * Czy dzień startu reguły już minął — liczone w strefie lokalizacji.
 * Zod widzi tylko format daty; bez tego strażnika literówka w roku
 * tworzyła do 52 rezerwacji CONFIRMED w przeszłości, a horyzont
 * `maxAdvanceDays` (liczony od startDate) nie interweniował.
 */
function startDateInPast(startDate: string, timezone: string): boolean {
  const [year, month, day] = startDate.split("-").map(Number);
  const today = utcToZonedWallClock(new Date(), timezone);
  return (
    Date.UTC(year!, month! - 1, day!) <
    Date.UTC(today.year, today.month - 1, today.day)
  );
}

// ---------------------------------------------------------------------------
// Podgląd terminów
// ---------------------------------------------------------------------------

export type PreviewSeriesResult =
  | {
      ok: true;
      slots: PlannedSlotPreview[];
      /** Ile wizyt poprosił użytkownik, a ile zmieściło się w horyzoncie. */
      requested: number | null;
      horizonDays: number;
      truncated: boolean;
      serviceLabel: string;
    }
  | { ok: false; error: string };

/**
 * Terminy wynikające z reguły wraz z oznaczeniem kolizji — pokazywane
 * w dialogu PRZED zapisem. Tylko odczyt; prawdziwym arbitrem kolizji
 * pozostaje ograniczenie wykluczające w bazie przy zapisie.
 */
export async function previewSeriesAction(
  input: unknown,
): Promise<PreviewSeriesResult> {
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowa reguła serii",
    };
  }
  const data = parsed.data;

  try {
    await requireBusinessManager(data.businessId);

    const context = await loadSeriesContext(
      data.businessId,
      data.resourceId,
      data.serviceId,
    );
    if (!context) {
      return { ok: false, error: "Nie znaleziono pracownika albo usługi" };
    }
    if (startDateInPast(data.startDate, context.location.timezone)) {
      return {
        ok: false,
        error: "Data startu serii nie może być w przeszłości",
      };
    }

    const visits = planSeriesVisits(data, context);
    const slots = await checkPlannedVisits(visits, context);

    return {
      ok: true,
      slots,
      requested: data.occurrences ?? null,
      horizonDays: context.location.maxAdvanceDays,
      truncated:
        data.occurrences != null && visits.length < data.occurrences,
      serviceLabel: `${context.service.name} · ${context.service.durationMin} min`,
    };
  } catch (error) {
    return failure(error, "Nie udało się policzyć terminów serii");
  }
}

// ---------------------------------------------------------------------------
// Utworzenie serii
// ---------------------------------------------------------------------------

export type CreateSeriesResult =
  | {
      ok: true;
      seriesId: string;
      planned: number;
      created: number;
      skipped: { label: string; dayLabel: string; reason: string }[];
      message: string;
    }
  | { ok: false; error: string };

/**
 * Generuje serię: wiersz BookingSeries + po jednej rezerwacji na termin.
 *
 * Każda wizyta powstaje w OSOBNEJ transakcji. Jedna wielka transakcja
 * byłaby tu wadą, nie zaletą: pojedyncza kolizja (23P01 z ograniczenia
 * `booking_items_no_overlap`) wywróciłaby całą serię, a klient ma dostać
 * te terminy, które są wolne — z raportem, co zostało pominięte.
 */
export async function createSeriesAction(
  input: unknown,
): Promise<CreateSeriesResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane serii",
    };
  }
  const data = parsed.data;

  let result: CreateSeriesResult;
  try {
    const { user } = await requireBusinessManager(data.businessId);

    const context = await loadSeriesContext(
      data.businessId,
      data.resourceId,
      data.serviceId,
    );
    if (!context) {
      return { ok: false, error: "Nie znaleziono pracownika albo usługi" };
    }
    if (startDateInPast(data.startDate, context.location.timezone)) {
      return {
        ok: false,
        error: "Data startu serii nie może być w przeszłości",
      };
    }

    // Terminy liczone jeszcze raz na serwerze — podgląd z przeglądarki
    // jest tylko podpowiedzią, nie źródłem prawdy.
    const visits = planSeriesVisits(data, context);
    if (visits.length === 0) {
      return {
        ok: false,
        error: `Reguła nie daje żadnego terminu w horyzoncie ${context.location.maxAdvanceDays} dni.`,
      };
    }

    const tz = context.location.timezone;
    const customer = await findOrCreateCustomerForBooking(data.businessId, {
      name: data.customerName,
      phone: data.customerPhone || null,
      email: data.customerEmail || null,
    });

    const series = await prisma.bookingSeries.create({
      select: { id: true },
      data: {
        businessId: data.businessId,
        locationId: context.location.id,
        serviceId: context.service.id,
        resourceId: context.resource.id,
        customerId: customer?.id ?? null,
        guestName: data.customerName,
        guestPhone: data.customerPhone || null,
        guestEmail: data.customerEmail || null,
        intervalWeeks: data.intervalWeeks,
        weekday: data.weekday,
        startMinute: data.startMinute,
        startDate: toDateColumn(data.startDate),
        endDate: data.endDate ? toDateColumn(data.endDate) : null,
        // Zapisujemy faktyczną liczbę zaplanowanych terminów, a nie życzenie
        // z formularza: dzięki temu szczegóły serii odtwarzają dokładnie tę
        // samą listę dat, nawet gdy firma zmieni potem horyzont rezerwacji.
        occurrences: visits.length,
        note: data.note || null,
      },
    });

    const skipped: { label: string; dayLabel: string; reason: string }[] = [];
    const createdLabels: string[] = [];
    let created = 0;

    for (const visit of visits) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.booking.create({
            select: { id: true },
            data: {
              businessId: data.businessId,
              locationId: context.location.id,
              customerId: customer?.id ?? null,
              guestName: data.customerName,
              guestPhone: data.customerPhone || null,
              guestEmail: data.customerEmail || null,
              status: "CONFIRMED",
              source: "MANUAL_STAFF",
              seriesId: series.id,
              startAt: visit.startAt,
              endAt: visit.endAt,
              totalPriceCents: context.service.priceCents,
              currency: context.service.currency,
              internalNote: data.note || null,
              items: {
                create: {
                  serviceId: context.service.id,
                  resourceId: context.resource.id,
                  startAt: visit.startAt,
                  endAt: visit.endAt,
                  blockedStartAt: visit.blockedStartAt,
                  blockedEndAt: visit.blockedEndAt,
                  durationMin: context.service.durationMin,
                  bufferBeforeMin: context.service.bufferBeforeMin,
                  bufferAfterMin: context.service.bufferAfterMin,
                  priceCents: context.service.priceCents,
                },
              },
            },
          });
        });
        created += 1;
        createdLabels.push(formatVisitLabel(visit.startAt, tz));
      } catch (error) {
        const reason = isOverlapError(error)
          ? "pracownik zajęty"
          : "błąd zapisu";
        if (reason === "błąd zapisu") {
          console.error("createSeriesAction: nie udało się zapisać wizyty", error);
        }
        skipped.push({
          label: formatVisitLabel(visit.startAt, tz),
          dayLabel: dayLabelOf(visit.startAt, tz),
          reason,
        });
      }
    }

    if (created === 0) {
      // Pusta seria to śmieć w panelu — zostaje komunikat, nie wiersz.
      await prisma.bookingSeries.delete({ where: { id: series.id } });
      return {
        ok: false,
        error: `Żaden z ${visits.length} terminów nie był wolny — seria nie została utworzona.`,
      };
    }

    await logAudit({
      businessId: data.businessId,
      actorUserId: user.id,
      action: "BOOKING_SERIES_CREATED",
      entityType: "BookingSeries",
      entityId: series.id,
      metadata: {
        planned: visits.length,
        created,
        skipped,
        rule: {
          weekday: data.weekday,
          startMinute: data.startMinute,
          intervalWeeks: data.intervalWeeks,
        },
      },
    });

    // Klient z e-mailem dostaje JEDNO zbiorcze potwierdzenie serii (a nie
    // 52 osobne maile) — ten sam obowiązek informacyjny co przy pojedynczej
    // wizycie ręcznej (createManualBookingAction); bez tego pierwszą
    // wiadomością byłoby przypomnienie 24 h przed wizytą.
    if (data.customerEmail) {
      const business = await prisma.business.findUnique({
        where: { id: data.businessId },
        select: { name: true },
      });
      const businessName = business?.name ?? "lokalu";
      const lines = [
        `${data.customerName ? `${data.customerName}, t` : "T"}woja seria wizyt w ${businessName} została zaplanowana.`,
        `${context.service.name} · ${context.resource.name}.`,
        `Terminy (${createdLabels.length}): ${createdLabels.join("; ")}.`,
        `Do zobaczenia!`,
      ];
      const email = data.customerEmail;
      after(() =>
        sendMail({
          to: email,
          type: "BOOKING_SERIES_CONFIRMED",
          subject: `Potwierdzenie serii wizyt — ${businessName}`,
          html: `<div style="font-family:'Instrument Sans',Arial,sans-serif;font-size:14px;line-height:1.6;color:#131412;">${lines
            .map((line) => `<p>${escapeHtml(line)}</p>`)
            .join("")}</div>`,
          text: lines.join("\n"),
        }),
      );
    }

    result = {
      ok: true,
      seriesId: series.id,
      planned: visits.length,
      created,
      skipped,
      message: buildCreateMessage(visits.length, created, skipped),
    };
  } catch (error) {
    return failure(error, "Nie udało się utworzyć serii. Spróbuj ponownie.");
  }

  revalidatePath("/panel/serie");
  revalidatePath("/panel");
  return result;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildCreateMessage(
  planned: number,
  created: number,
  skipped: { dayLabel: string; reason: string }[],
): string {
  const parts = [`Utworzono ${created} z ${planned} wizyt.`];
  if (skipped.length === 1) {
    parts.push(
      `Termin ${skipped[0]!.dayLabel} pominięty — ${skipped[0]!.reason}.`,
    );
  } else if (skipped.length > 1) {
    const reasons = [...new Set(skipped.map((entry) => entry.reason))].join(", ");
    parts.push(
      `Pominięte terminy: ${skipped.map((entry) => entry.dayLabel).join(", ")} — ${reasons}.`,
    );
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Odwołania
// ---------------------------------------------------------------------------

/**
 * Odwołanie wizyty przez firmę: PENDING/CONFIRMED → CANCELLED_BY_BUSINESS,
 * rozliczenie zadatku, wpis audytu i poczta — tak samo jak przy odwołaniu
 * z widoku hosta. Strażnik statusu siedzi w samym UPDATE, więc równoległe
 * anulowanie przez klienta nie zostanie nadpisane.
 */
async function cancelBookingByBusiness(options: {
  bookingId: string;
  businessId: string;
  actorUserId: string;
  reason: string | null;
}): Promise<boolean> {
  const cancelledAt = new Date();
  // Zwrot wejścia z karnetu w tej samej transakcji co zmiana statusu —
  // odwołana wizyta opłacona karnetem oddaje wejście klientowi.
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.booking.updateMany({
      where: {
        id: options.bookingId,
        businessId: options.businessId,
        status: { in: ["PENDING", "CONFIRMED"] },
      },
      data: {
        status: "CANCELLED_BY_BUSINESS",
        cancelledAt,
        cancellationReason: options.reason,
      },
    });
    if (result.count > 0) {
      await refundPackageEntryForBooking(tx, options.bookingId);
    }
    return result;
  });
  if (updated.count === 0) return false;

  const settledPayments = await settleBookingPaymentsOnCancellation(
    options.bookingId,
    { actorUserId: options.actorUserId, reason: options.reason },
  );
  await logAudit({
    businessId: options.businessId,
    actorUserId: options.actorUserId,
    action: "BOOKING_CANCELLED",
    entityType: "Booking",
    entityId: options.bookingId,
    metadata: {
      cancelledBy: "business",
      reason: options.reason,
      source: "series",
      payments: settledPayments,
    },
  });
  after(() => sendBookingCancellationEmails(options.bookingId));
  // Webhooki integratorów: dokumentacja obiecuje booking.cancelled przy
  // KAŻDYM odwołaniu — także zainicjowanym przez firmę z panelu.
  after(() =>
    emitEvent(options.businessId, "booking.cancelled", {
      bookingId: options.bookingId,
      status: "CANCELLED_BY_BUSINESS",
      cancelledAt: cancelledAt.toISOString(),
      reason: options.reason,
    }),
  );
  return true;
}

const cancelVisitSchema = z.object({
  businessId: z.string().min(1),
  seriesId: z.string().min(1),
  bookingId: z.string().min(1),
  reason: z.string().trim().max(200).optional(),
});

/** Odwołanie jednej wizyty z serii — reszta terminów zostaje. */
export async function cancelSeriesBookingAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = cancelVisitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane wizyty" };
  const data = parsed.data;

  try {
    const { user } = await requireBusinessManager(data.businessId);

    const booking = await prisma.booking.findFirst({
      where: {
        id: data.bookingId,
        businessId: data.businessId,
        seriesId: data.seriesId,
      },
      select: { id: true },
    });
    if (!booking) return { ok: false, error: "Nie znaleziono wizyty w tej serii" };

    const cancelled = await cancelBookingByBusiness({
      bookingId: booking.id,
      businessId: data.businessId,
      actorUserId: user.id,
      reason: data.reason || null,
    });
    if (!cancelled) {
      return {
        ok: false,
        error: "Tej wizyty nie można już odwołać. Odśwież widok.",
      };
    }
  } catch (error) {
    return failure(error, "Nie udało się odwołać wizyty");
  }

  revalidatePath(`/panel/serie/${data.seriesId}`);
  revalidatePath("/panel/serie");
  revalidatePath("/panel");
  return { ok: true, message: "Wizyta odwołana" };
}

const endSeriesSchema = z.object({
  businessId: z.string().min(1),
  seriesId: z.string().min(1),
  /** Czy odwołać wszystkie przyszłe wizyty tej serii. */
  cancelFuture: z.boolean(),
  reason: z.string().trim().max(200).optional(),
});

/**
 * Zakończenie serii: status CANCELLED (nowe wizyty już z niej nie powstaną)
 * i — opcjonalnie — odwołanie wszystkich PRZYSZŁYCH wizyt. Wizyty przeszłe
 * zostają nietknięte: to historia klienta, nie plan.
 */
export async function endSeriesAction(input: unknown): Promise<ActionResult> {
  const parsed = endSeriesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane serii" };
  const data = parsed.data;

  let message = "Seria zakończona";
  try {
    const { user } = await requireBusinessManager(data.businessId);

    const series = await prisma.bookingSeries.findFirst({
      where: { id: data.seriesId, businessId: data.businessId },
      select: { id: true, status: true },
    });
    if (!series) return { ok: false, error: "Nie znaleziono serii" };

    const closed = await prisma.bookingSeries.updateMany({
      where: { id: series.id, businessId: data.businessId, status: "ACTIVE" },
      data: { status: "CANCELLED" },
    });

    let cancelledCount = 0;
    if (data.cancelFuture) {
      const future = await prisma.booking.findMany({
        where: {
          seriesId: series.id,
          businessId: data.businessId,
          status: { in: ["PENDING", "CONFIRMED"] },
          startAt: { gt: new Date() },
        },
        select: { id: true },
        orderBy: { startAt: "asc" },
      });
      for (const booking of future) {
        const cancelled = await cancelBookingByBusiness({
          bookingId: booking.id,
          businessId: data.businessId,
          actorUserId: user.id,
          reason: data.reason || "Zakończenie serii cyklicznej",
        });
        if (cancelled) cancelledCount += 1;
      }
    }

    if (closed.count === 0 && cancelledCount === 0) {
      return { ok: false, error: "Ta seria jest już zamknięta" };
    }

    await logAudit({
      businessId: data.businessId,
      actorUserId: user.id,
      action: "BOOKING_SERIES_CANCELLED",
      entityType: "BookingSeries",
      entityId: series.id,
      metadata: {
        cancelledFutureBookings: cancelledCount,
        reason: data.reason ?? null,
      },
    });

    message = data.cancelFuture
      ? `Seria zakończona. Odwołano ${cancelledCount} ${visitsWord(cancelledCount)}.`
      : "Seria zakończona. Umówione wizyty zostają w kalendarzu.";
  } catch (error) {
    return failure(error, "Nie udało się zakończyć serii");
  }

  revalidatePath(`/panel/serie/${data.seriesId}`);
  revalidatePath("/panel/serie");
  revalidatePath("/panel");
  return { ok: true, message };
}

/** Odmiana rzeczownika „wizyta" przy liczebniku. */
function visitsWord(count: number): string {
  if (count === 1) return "wizytę";
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "wizyty";
  return "wizyt";
}
