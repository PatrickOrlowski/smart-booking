"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sendBookingConfirmationEmails } from "@/app/api/v1/bookings/emails";
import {
  ForbiddenError,
  UnauthorizedError,
  requireBusinessManager,
} from "@/lib/authz";
import { addMinutes, localDayMinutesToUtc } from "@/lib/time";

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

    const booking = await prisma.booking.create({
      select: { id: true },
      data: {
        businessId: data.businessId,
        locationId: resource.location.id,
        guestName: data.customerName,
        guestPhone: data.customerPhone || null,
        guestEmail: data.customerEmail || null,
        status: "CONFIRMED",
        source: "MANUAL_STAFF",
        startAt,
        endAt,
        totalPriceCents: priceCents,
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
    if (isOverlapError(error)) {
      return { ok: false, error: "Termin koliduje z inną wizytą" };
    }
    console.error("createManualBookingAction", error);
    return { ok: false, error: "Nie udało się dodać wizyty. Spróbuj ponownie." };
  }

  revalidatePath("/panel");
  return { ok: true };
}
