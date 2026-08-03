import { NextResponse, after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveSlot } from "@/lib/hold";
import { logAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/webhooks";
import { findOrCreateCustomerForBooking } from "@/app/panel/(dashboard)/klienci/customer-match";
import { sendBookingConfirmationEmails } from "@/app/api/v1/bookings/emails";
import {
  apiError,
  crossTenantError,
  isOverlapConflict,
  requireApiBusiness,
} from "@/app/api/public/v1/common";

/**
 * Publiczne API rezerwacji — zakres zawsze = firma właściciela klucza.
 *
 * GET  /api/public/v1/bookings?from=&to=  — lista rezerwacji w zakresie dat
 * POST /api/public/v1/bookings            — utworzenie rezerwacji
 *
 * Integrator działa w imieniu firmy, więc rezerwacja dostaje źródło
 * MANUAL_STAFF (jak wpis zza lady — enum BookingSource nie ma osobnego
 * źródła „API") i NIE przechodzi klienckich blokad no-show ani kodów
 * rabatowych — to kanał firmy, nie marketplace'u.
 */

const listSchema = z.object({
  from: z.iso.date().or(z.iso.datetime()),
  to: z.iso.date().or(z.iso.datetime()),
});

/** Maksymalny zakres listy — chroni bazę przed pełnym skanem historii. */
const MAX_RANGE_DAYS = 92;
const LIST_LIMIT = 500;

export async function GET(request: Request) {
  const auth = await requireApiBusiness(request);
  if (!auth.ok) return auth.response;
  const { business } = auth.ctx;

  const { searchParams } = new URL(request.url);
  const parsed = listSchema.safeParse({
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  });
  if (!parsed.success) {
    return apiError(
      400,
      "BAD_REQUEST",
      "Wymagane parametry: from oraz to (YYYY-MM-DD albo ISO 8601).",
    );
  }

  const from = new Date(parsed.data.from);
  // Sama data (bez godziny) jako `to` obejmuje CAŁY dzień końcowy.
  const to = /^\d{4}-\d{2}-\d{2}$/.test(parsed.data.to)
    ? new Date(new Date(parsed.data.to).getTime() + 24 * 60 * 60 * 1000)
    : new Date(parsed.data.to);

  if (to.getTime() <= from.getTime()) {
    return apiError(400, "BAD_REQUEST", "`to` musi wypadać po `from`.");
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    return apiError(
      400,
      "BAD_REQUEST",
      `Maksymalny zakres listy to ${MAX_RANGE_DAYS} dni.`,
    );
  }

  const bookings = await prisma.booking.findMany({
    where: { businessId: business.id, startAt: { gte: from, lt: to } },
    orderBy: { startAt: "asc" },
    take: LIST_LIMIT,
    select: {
      id: true,
      status: true,
      source: true,
      startAt: true,
      endAt: true,
      totalPriceCents: true,
      discountCents: true,
      currency: true,
      partySize: true,
      customerNote: true,
      cancelledAt: true,
      guestName: true,
      guestEmail: true,
      guestPhone: true,
      customer: {
        select: { fullName: true, email: true, phone: true },
      },
      items: {
        orderBy: { sortOrder: "asc" },
        select: {
          serviceId: true,
          resourceId: true,
          service: { select: { name: true } },
          resource: { select: { name: true } },
        },
      },
    },
  });

  return NextResponse.json({
    bookings: bookings.map((booking) => ({
      id: booking.id,
      status: booking.status,
      source: booking.source,
      startAt: booking.startAt.toISOString(),
      endAt: booking.endAt.toISOString(),
      priceCents: booking.totalPriceCents,
      discountCents: booking.discountCents,
      currency: booking.currency,
      partySize: booking.partySize,
      note: booking.customerNote,
      cancelledAt: booking.cancelledAt?.toISOString() ?? null,
      customer: {
        name: booking.guestName ?? booking.customer?.fullName ?? null,
        email: booking.guestEmail ?? booking.customer?.email ?? null,
        phone: booking.guestPhone ?? booking.customer?.phone ?? null,
      },
      items: booking.items.map((item) => ({
        serviceId: item.serviceId,
        serviceName: item.service.name,
        resourceId: item.resourceId,
        resourceName: item.resource.name,
      })),
    })),
  });
}

const createSchema = z.object({
  serviceId: z.string().min(1),
  /** Brak = „dowolny pracownik" — zasób wybiera silnik dostępności. */
  resourceId: z.string().min(1).optional(),
  startAt: z.iso.datetime(),
  customer: z.object({
    name: z.string().min(2).max(120),
    email: z.email().optional(),
    phone: z.string().min(7).max(20).optional(),
  }),
  note: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiBusiness(request);
  if (!auth.ok) return auth.response;
  const { business, apiKeyId } = auth.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Nieprawidłowe body żądania (JSON).");
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return apiError(
      422,
      "VALIDATION",
      `Nieprawidłowe dane rezerwacji: ${issue?.path.join(".")} — ${issue?.message}`,
    );
  }
  const input = parsed.data;

  // Zakres klucza: usługa cudzej firmy → 403 zanim silnik zdąży cokolwiek
  // policzyć (resolveSlot pracuje na slugu firmy klucza, więc dalej i tak
  // niczego cudzego nie zobaczy).
  const service = await prisma.service.findUnique({
    where: { id: input.serviceId },
    select: { businessId: true },
  });
  if (!service || service.businessId !== business.id) {
    return crossTenantError(service !== null, "serviceId");
  }

  const now = new Date();
  const resolution = await resolveSlot({
    businessSlug: business.slug,
    serviceId: input.serviceId,
    resourceId: input.resourceId,
    startAt: new Date(input.startAt),
    now,
  });
  if (!resolution.ok) {
    return apiError(resolution.status, resolution.error, resolution.message);
  }
  const { context, slot } = resolution;

  try {
    const booking = await prisma.$transaction(async (tx) => {
      // Profil CRM w tej samej transakcji — rezerwacje z API liczą się do
      // historii i limitu no-show tak samo jak wizyty wpisane ręcznie.
      const customerId =
        (
          await findOrCreateCustomerForBooking(
            business.id,
            {
              name: input.customer.name,
              email: input.customer.email ?? null,
              phone: input.customer.phone ?? null,
            },
            tx,
          )
        )?.id ?? null;

      return tx.booking.create({
        data: {
          businessId: business.id,
          locationId: context.location.id,
          customerId,
          // Dane kontaktowe na rezerwacji — z nich korzystają e-maile
          // potwierdzenia/anulowania i link zarządzania dla klienta.
          guestName: input.customer.name,
          guestEmail: input.customer.email ?? null,
          guestPhone: input.customer.phone ?? null,
          status: "CONFIRMED",
          source: "MANUAL_STAFF",
          startAt: slot.startAt,
          endAt: slot.endAt,
          totalPriceCents: slot.priceCents,
          currency: context.service.currency,
          customerNote: input.note,
          items: {
            create: {
              serviceId: context.service.id,
              resourceId: slot.resourceId,
              startAt: slot.startAt,
              endAt: slot.endAt,
              blockedStartAt: slot.blockedStartAt,
              blockedEndAt: slot.blockedEndAt,
              durationMin: slot.durationMin,
              bufferBeforeMin: context.service.bufferBeforeMin,
              bufferAfterMin: context.service.bufferAfterMin,
              priceCents: slot.priceCents,
            },
          },
        },
        select: { id: true, status: true, createdAt: true },
      });
    });

    // Audyt, webhooki i poczta PO odpowiedzi (after) — best-effort,
    // nie blokują 201 i nie mogą wywrócić zapisanej rezerwacji.
    after(() =>
      logAudit({
        businessId: business.id,
        action: "BOOKING_CREATED",
        entityType: "Booking",
        entityId: booking.id,
        metadata: { via: "public_api", apiKeyId },
      }),
    );
    after(() =>
      emitEvent(business.id, "booking.created", {
        bookingId: booking.id,
        status: booking.status,
        source: "MANUAL_STAFF",
        startAt: slot.startAt.toISOString(),
        endAt: slot.endAt.toISOString(),
        serviceId: context.service.id,
        serviceName: context.service.name,
        resourceId: slot.resourceId,
        priceCents: slot.priceCents,
        currency: context.service.currency,
      }),
    );
    after(() => sendBookingConfirmationEmails(booking.id));

    return NextResponse.json(
      {
        booking: {
          id: booking.id,
          status: booking.status,
          startAt: slot.startAt.toISOString(),
          endAt: slot.endAt.toISOString(),
          durationMin: slot.durationMin,
          priceCents: slot.priceCents,
          currency: context.service.currency,
          serviceId: context.service.id,
          serviceName: context.service.name,
          resourceId: slot.resourceId,
          resourceName: slot.resourceName,
          timezone: context.location.timezone,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (isOverlapConflict(error)) {
      return apiError(
        409,
        "SLOT_TAKEN",
        "Ten termin właśnie został zajęty. Wybierz inną godzinę.",
      );
    }
    console.error("public API: błąd tworzenia rezerwacji:", error);
    return apiError(500, "INTERNAL", "Nie udało się utworzyć rezerwacji.");
  }
}
