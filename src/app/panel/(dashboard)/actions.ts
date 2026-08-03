"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sendBookingConfirmationEmails } from "@/app/api/v1/bookings/emails";
import { logAudit } from "@/lib/audit";
import { registerNoShow } from "@/lib/no-show";
import {
  ForbiddenError,
  UnauthorizedError,
  requireBusinessManager,
} from "@/lib/authz";
import { addMinutes, localDayMinutesToUtc } from "@/lib/time";
import { PackageRejectedError, consumePackageEntry } from "@/lib/packages";
import { findOrCreateCustomerForBooking } from "@/app/panel/(dashboard)/klienci/customer-match";

type ActionResult = { ok: true } | { ok: false; error: string };

const createBookingSchema = z.object({
  businessId: z.string().min(1),
  resourceId: z.string().min(1),
  serviceId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Nieprawidłowa data"),
  startMinute: z.number().int().min(0).max(1439),
  customerName: z.string().trim().min(2, "Podaj imię i nazwisko klienta").max(120),
  customerPhone: z.string().trim().max(30).optional(),
  customerEmail: z.email("Nieprawidłowy e-mail").optional().or(z.literal("")),
  note: z.string().trim().max(500).optional(),
  /** Wizyta rozliczana wejściem z karnetu klienta (cena 0). */
  customerPackageId: z.string().min(1).optional(),
});

/**
 * Baza rzuca 23P01 (exclusion constraint), gdy BookingItem nachodzi na inny
 * blokujący wpis tego samego zasobu. Prisma nie mapuje tego kodu na własny
 * błąd, więc szukamy go w łańcuchu przyczyn.
 */
function isOverlapError(error: unknown): boolean {
  const seen = new Set<object>();
  const stack: unknown[] = [error];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const record = current as Record<string, unknown> & {
      message?: unknown;
      cause?: unknown;
    };
    for (const value of [
      ...Object.values(record),
      record.message,
      record.cause,
    ]) {
      if (
        typeof value === "string" &&
        (value.includes("23P01") ||
          value.toLowerCase().includes("exclusion constraint"))
      ) {
        return true;
      }
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return false;
}

/**
 * Ręczne dodanie wizyty z kalendarza panelu.
 * Booking źródło MANUAL_STAFF, od razu CONFIRMED; czas końca liczony
 * z durationMin usługi z uwzględnieniem nadpisania ServiceResource,
 * blocked* poszerzone o bufory.
 */
export async function createManualBookingAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = createBookingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane wizyty",
    };
  }
  const data = parsed.data;

  try {
    await requireBusinessManager(data.businessId);

    const [resource, service] = await Promise.all([
      prisma.resource.findFirst({
        where: {
          id: data.resourceId,
          type: "STAFF",
          isActive: true,
          location: { businessId: data.businessId },
        },
        include: { location: { select: { id: true, timezone: true } } },
      }),
      prisma.service.findFirst({
        where: { id: data.serviceId, businessId: data.businessId },
        include: {
          resources: {
            where: { resourceId: data.resourceId },
            select: { durationMinOverride: true, priceCentsOverride: true },
          },
        },
      }),
    ]);

    if (!resource) return { ok: false, error: "Nie znaleziono pracownika" };
    if (!service) return { ok: false, error: "Nie znaleziono usługi" };

    const override = service.resources[0];
    const durationMin = override?.durationMinOverride ?? service.durationMin;
    const priceCents = override?.priceCentsOverride ?? service.priceCents;

    const [year, month, day] = data.date.split("-").map(Number);
    const startAt = localDayMinutesToUtc(
      { year, month, day },
      data.startMinute,
      resource.location.timezone,
    );
    const endAt = addMinutes(startAt, durationMin);
    const blockedStartAt = addMinutes(startAt, -service.bufferBeforeMin);
    const blockedEndAt = addMinutes(endAt, service.bufferAfterMin);

    // Wizyta i wykorzystanie karnetu w JEDNEJ transakcji: odrzucone wejście
    // (karnet wyczerpany, przeterminowany, cudzy) cofa całą rezerwację,
    // a zapisana wizyta zawsze ma pokrycie w wierszu PackageUsage.
    const booking = await prisma.$transaction(async (tx) => {
      // CRM: gość z telefonem/e-mailem jest dopasowywany do istniejącego
      // profilu klienta firmy (albo dostaje nowy) — dzięki temu ręczne wizyty
      // liczą się do historii, wydatków i polityki no-show.
      const customer = await findOrCreateCustomerForBooking(
        data.businessId,
        {
          name: data.customerName,
          phone: data.customerPhone || null,
          email: data.customerEmail || null,
        },
        tx,
      );

      const paidByPackage = data.customerPackageId !== undefined;
      const created = await tx.booking.create({
        select: { id: true },
        data: {
          businessId: data.businessId,
          locationId: resource.location.id,
          customerId: customer?.id ?? null,
          guestName: data.customerName,
          guestPhone: data.customerPhone || null,
          guestEmail: data.customerEmail || null,
          status: "CONFIRMED",
          source: "MANUAL_STAFF",
          startAt,
          endAt,
          // Wizyta z karnetu jest opłacona z góry — klient nie płaci nic
          // przy wizycie. Pozycja BookingItem zachowuje cenę katalogową,
          // żeby wiadomo było, ile warte było skasowane wejście.
          totalPriceCents: paidByPackage ? 0 : priceCents,
          customerPackageId: data.customerPackageId ?? null,
          currency: service.currency,
          internalNote: data.note || null,
          items: {
            create: {
              serviceId: service.id,
              resourceId: resource.id,
              startAt,
              endAt,
              blockedStartAt,
              blockedEndAt,
              durationMin,
              bufferBeforeMin: service.bufferBeforeMin,
              bufferAfterMin: service.bufferAfterMin,
              priceCents,
            },
          },
        },
      });

      if (data.customerPackageId) {
        await consumePackageEntry(tx, {
          businessId: data.businessId,
          customerPackageId: data.customerPackageId,
          bookingId: created.id,
          customerId: customer?.id ?? null,
          serviceId: service.id,
        });
      }

      return created;
    });

    if (data.customerPackageId) {
      await logAudit({
        businessId: data.businessId,
        action: "PACKAGE_ENTRY_USED",
        entityType: "CustomerPackage",
        entityId: data.customerPackageId,
        metadata: { bookingId: booking.id, serviceId: data.serviceId },
      });
    }

    // Znamy adres klienta → wysyłamy takie samo potwierdzenie jak przy
    // rezerwacji online (bez tego klient dostawał tylko przypomnienie 24 h
    // przed wizytą, o której nikt go nie poinformował).
    if (data.customerEmail) {
      after(() => sendBookingConfirmationEmails(booking.id));
    }
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return { ok: false, error: error.message };
    }
    // Karnet wyczerpany/przeterminowany to komunikat dla obsługi, nie awaria.
    if (error instanceof PackageRejectedError) {
      return { ok: false, error: error.userMessage };
    }
    if (isOverlapError(error)) {
      return { ok: false, error: "Termin koliduje z inną wizytą" };
    }
    console.error("createManualBookingAction", error);
    return { ok: false, error: "Nie udało się dodać wizyty. Spróbuj ponownie." };
  }

  revalidatePath("/panel");
  return { ok: true };
}

const setStatusSchema = z.object({
  businessId: z.string().min(1),
  bookingId: z.string().min(1),
  status: z.enum(["COMPLETED", "NO_SHOW"]),
});

/**
 * Zmiana statusu wizyty z panelu firmy: zakończona albo nieobecność.
 *
 * Te same reguły co w panelu pracownika — tylko wizyty rozpoczęte
 * (przeszłe/trwające) w statusie PENDING/CONFIRMED. Oznaczenie NO_SHOW
 * uruchamia politykę no-show: wpis BOOKING_NO_SHOW w audycie i licznik
 * nieobecności klienta z automatyczną blokadą po limicie firmy.
 */
export async function setBookingStatusAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = setStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Nieprawidłowe dane wizyty" };
  }
  const data = parsed.data;

  try {
    const { user } = await requireBusinessManager(data.businessId);

    const booking = await prisma.booking.findFirst({
      where: { id: data.bookingId, businessId: data.businessId },
      select: { id: true, status: true, startAt: true },
    });
    if (!booking) return { ok: false, error: "Nie znaleziono wizyty" };

    const isActionable =
      (booking.status === "PENDING" || booking.status === "CONFIRMED") &&
      booking.startAt.getTime() <= Date.now();
    if (!isActionable) {
      return {
        ok: false,
        error: "Można rozliczyć tylko rozpoczętą, niezakończoną wizytę",
      };
    }

    // Strażnik statusu w samym UPDATE: równoległe anulowanie przez klienta
    // (booking-cancel.ts — już z rozliczonym/zwróconym zadatkiem) nie może
    // zostać nadpisane na NO_SHOW/COMPLETED przez read-modify-write.
    const updated = await prisma.booking.updateMany({
      where: {
        id: booking.id,
        businessId: data.businessId,
        status: { in: ["PENDING", "CONFIRMED"] },
      },
      data: { status: data.status },
    });
    if (updated.count === 0) {
      return {
        ok: false,
        error: "Status wizyty zmienił się w międzyczasie. Odśwież widok.",
      };
    }

    if (data.status === "NO_SHOW") {
      const result = await registerNoShow(booking.id, {
        actorUserId: user.id,
      });
      await logAudit({
        businessId: data.businessId,
        actorUserId: user.id,
        action: "BOOKING_NO_SHOW",
        entityType: "Booking",
        entityId: booking.id,
        metadata: {
          noShowCount: result.count,
          limit: result.limit,
          customerBlocked: result.blocked,
        },
      });
    }
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return { ok: false, error: error.message };
    }
    console.error("setBookingStatusAction", error);
    return { ok: false, error: "Nie udało się zmienić statusu wizyty" };
  }

  revalidatePath("/panel");
  return { ok: true };
}
