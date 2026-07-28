import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import {
  ForbiddenError,
  UnauthorizedError,
  requireBusinessManager,
} from "@/lib/authz";
import { localDayMinutesToUtc, utcToZonedWallClock } from "@/lib/time";
import { getPanelBusiness } from "@/app/panel/data";
import { shiftDay } from "@/components/panel/format";
import type { BookingSource, BookingStatus } from "@/generated/prisma/enums";

/**
 * Eksport rezerwacji do CSV za ostatnie 7/30/90 dni (?okres=, domyślnie 30).
 *
 * Format pod Excel PL: BOM UTF-8, separator średnik, ceny z przecinkiem
 * dziesiętnym, daty i godziny w strefie czasowej lokalizacji.
 * Każdy eksport zostawia ślad w AuditLog (DATA_EXPORTED).
 */

const PERIOD_OPTIONS = [7, 30, 90] as const;

const STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: "Oczekująca",
  CONFIRMED: "Potwierdzona",
  COMPLETED: "Zakończona",
  CANCELLED_BY_CUSTOMER: "Odwołana przez klienta",
  CANCELLED_BY_BUSINESS: "Odwołana przez firmę",
  NO_SHOW: "Nieobecność",
};

const SOURCE_LABELS: Record<BookingSource, string> = {
  WEB_MARKETPLACE: "Marketplace",
  WEB_WIDGET: "Widget",
  MOBILE_APP: "Aplikacja mobilna",
  MANUAL_STAFF: "Ręczna (personel)",
};

/**
 * Znaki, od których Excel/LibreOffice zaczyna interpretować pole jako
 * formułę (także po TAB/CR, które arkusz zjada przed treścią).
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Pole CSV: cudzysłowy, gdy wartość zawiera separator/cudzysłów/nową linię.
 *
 * Wartość zaczynająca się od =, +, -, @, TAB lub CR dostaje dodatkowo
 * apostrof i cudzysłowy — nazwisko klienta pochodzi z publicznego
 * POST /api/v1/bookings (Zod ogranicza tylko długość), więc bez tego gość
 * wstawia do eksportu formułę w rodzaju =HYPERLINK(...), która wykonuje się
 * po otwarciu pliku przez właściciela firmy (CSV injection).
 */
function csvField(value: string): string {
  const escaped = value.replaceAll('"', '""');
  if (FORMULA_PREFIX.test(value)) return `"'${escaped}"`;
  return /[";\n\r]/.test(value) ? `"${escaped}"` : value;
}

const pad = (value: number) => String(value).padStart(2, "0");

export async function GET(request: Request): Promise<Response> {
  const panel = await getPanelBusiness();
  if (!panel) {
    return new Response("Wymagane zalogowanie", { status: 401 });
  }

  // Eksport zawiera imiona i nazwiska WSZYSTKICH klientów firmy oraz jej
  // przychód — to dane zarządcze, więc bramka managera, nie samego dostępu
  // do firmy (szeregowy EMPLOYEE widzi wyłącznie swój grafik).
  let actorUserId: string;
  try {
    const { user } = await requireBusinessManager(panel.business.id);
    actorUserId = user.id;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return new Response("Wymagane zalogowanie", { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return new Response("Brak uprawnień", { status: 403 });
    }
    throw error;
  }

  const url = new URL(request.url);
  const parsed = Number(url.searchParams.get("okres"));
  const days = PERIOD_OPTIONS.find((option) => option === parsed) ?? 30;

  const tz = panel.location?.timezone ?? "Europe/Warsaw";
  const todayWall = utcToZonedWallClock(new Date(), tz);
  const today = {
    year: todayWall.year,
    month: todayWall.month,
    day: todayWall.day,
  };
  const startDay = shiftDay(today, -(days - 1));
  const startUtc = localDayMinutesToUtc(startDay, 0, tz);
  const endUtc = localDayMinutesToUtc(shiftDay(today, 1), 0, tz);

  const bookings = await prisma.booking.findMany({
    where: {
      businessId: panel.business.id,
      startAt: { gte: startUtc, lt: endUtc },
    },
    orderBy: { startAt: "asc" },
    select: {
      startAt: true,
      status: true,
      source: true,
      totalPriceCents: true,
      guestName: true,
      customer: { select: { fullName: true } },
      user: { select: { name: true } },
      items: {
        orderBy: { sortOrder: "asc" },
        select: {
          service: { select: { name: true } },
          resource: { select: { name: true } },
        },
      },
    },
  });

  const header = [
    "Data",
    "Godzina",
    "Klient",
    "Usługa",
    "Pracownik",
    "Status",
    "Źródło",
    "Cena",
  ];

  const lines = [header.join(";")];
  for (const booking of bookings) {
    const wall = utcToZonedWallClock(booking.startAt, tz);
    const client =
      booking.customer?.fullName ??
      booking.user?.name ??
      booking.guestName ??
      "Gość";
    const services = booking.items
      .map((item) => item.service.name)
      .join(" + ");
    const staff = [
      ...new Set(booking.items.map((item) => item.resource.name)),
    ].join(" + ");
    const price = (booking.totalPriceCents / 100)
      .toFixed(2)
      .replace(".", ",");

    lines.push(
      [
        `${pad(wall.day)}.${pad(wall.month)}.${wall.year}`,
        `${pad(wall.hour)}:${pad(wall.minute)}`,
        client,
        services,
        staff,
        STATUS_LABELS[booking.status],
        SOURCE_LABELS[booking.source],
        price,
      ]
        .map(csvField)
        .join(";"),
    );
  }

  await logAudit({
    businessId: panel.business.id,
    actorUserId,
    action: "DATA_EXPORTED",
    entityType: "Business",
    entityId: panel.business.id,
    metadata: { zakres: "rezerwacje_csv", okresDni: days, wiersze: bookings.length },
  });

  const filename = `rezerwacje-${today.year}-${pad(today.month)}-${pad(today.day)}-${days}d.csv`;
  // BOM UTF-8 — bez niego Excel PL czyta polskie znaki jako krzaczki.
  const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
