import { NextResponse, after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/webhooks";
import { refundPackageEntryForBooking } from "@/lib/packages";
import { settleBookingPaymentsOnCancellation } from "@/lib/payments";
import { sendBookingCancellationEmails } from "@/app/api/v1/bookings/emails";
import {
  apiError,
  crossTenantError,
  requireApiBusiness,
} from "@/app/api/public/v1/common";

/**
 * POST /api/public/v1/bookings/[id]/cancel — anulowanie przez integratora.
 *
 * Integrator działa w imieniu firmy → status CANCELLED_BY_BUSINESS, bez
 * klienckiego cutoffu (firma może odwołać wizytę w każdej chwili). Strażnik
 * statusu siedzi w samym UPDATE — równoległe anulowanie przez klienta nie
 * zostanie nadpisane. Rozliczenie zadatku, audyt i poczta jak przy odwołaniu
 * z panelu.
 */

const bodySchema = z.object({ reason: z.string().trim().max(200).optional() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiBusiness(request);
  if (!auth.ok) return auth.response;
  const { business, apiKeyId } = auth.ctx;
  const { id } = await params;

  // Body jest opcjonalne — pusty POST też anuluje.
  let reason: string | null = null;
  const raw = await request.text();
  if (raw.trim().length > 0) {
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(raw);
    } catch {
      return apiError(400, "BAD_REQUEST", "Nieprawidłowe body żądania (JSON).");
    }
    const parsed = bodySchema.safeParse(parsedBody);
    if (!parsed.success) {
      return apiError(422, "VALIDATION", "Pole reason: maks. 200 znaków.");
    }
    reason = parsed.data.reason || null;
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: { id: true, businessId: true, status: true },
  });
  if (!booking || booking.businessId !== business.id) {
    return crossTenantError(booking !== null, "bookingId");
  }

  if (booking.status !== "PENDING" && booking.status !== "CONFIRMED") {
    return apiError(
      422,
      "INVALID_STATE",
      "Tej rezerwacji nie można już anulować.",
    );
  }

  const cancelledAt = new Date();
  // Zwrot wejścia z karnetu w tej samej transakcji co zmiana statusu —
  // odwołana wizyta opłacona karnetem oddaje wejście klientowi.
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.booking.updateMany({
      where: {
        id: booking.id,
        businessId: business.id,
        status: { in: ["PENDING", "CONFIRMED"] },
      },
      data: {
        status: "CANCELLED_BY_BUSINESS",
        cancelledAt,
        cancellationReason: reason,
      },
    });
    if (result.count > 0) {
      await refundPackageEntryForBooking(tx, booking.id);
    }
    return result;
  });
  if (updated.count === 0) {
    return apiError(
      422,
      "INVALID_STATE",
      "Tej rezerwacji nie można już anulować.",
    );
  }

  const settledPayments = await settleBookingPaymentsOnCancellation(
    booking.id,
    { actorUserId: null, reason },
  );
  await logAudit({
    businessId: business.id,
    action: "BOOKING_CANCELLED",
    entityType: "Booking",
    entityId: booking.id,
    metadata: {
      cancelledBy: "business",
      via: "public_api",
      apiKeyId,
      reason,
      payments: settledPayments,
    },
  });

  after(() =>
    emitEvent(business.id, "booking.cancelled", {
      bookingId: booking.id,
      status: "CANCELLED_BY_BUSINESS",
      cancelledAt: cancelledAt.toISOString(),
      reason,
    }),
  );
  after(() => sendBookingCancellationEmails(booking.id));

  return NextResponse.json({
    booking: {
      id: booking.id,
      status: "CANCELLED_BY_BUSINESS",
      cancelledAt: cancelledAt.toISOString(),
    },
  });
}
