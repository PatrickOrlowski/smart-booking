import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { buildBookingIcs } from "@/lib/ics";
import { customerBookingUrl } from "@/lib/booking-link";
import {
  bookingCancelledBusiness,
  bookingCancelledCustomer,
  bookingConfirmedBusiness,
  bookingConfirmedCustomer,
  sendMail,
  type BookingEmailData,
} from "@/lib/mail";

/**
 * Wysyłka e-maili transakcyjnych wokół rezerwacji (potwierdzenie i anulowanie).
 *
 * Reguła nadrzędna: poczta nigdy nie psuje API. Cała funkcja jest opakowana
 * w try/catch, a `sendMail` i tak nie rzuca — bez klucza Resend wiadomość
 * ląduje w tabeli `notifications` ze statusem SKIPPED.
 *
 * Dane wizyty czytamy tu jeszcze raz z bazy (jednym zapytaniem), żeby route
 * tworzący/anulujący rezerwację nie musiał przenosić kompletu relacji.
 */

type BookingForEmail = {
  id: string;
  startAt: Date;
  endAt: Date;
  totalPriceCents: number;
  currency: string;
  /** Rezerwacja stolika — liczba osób zamiast wybranej usługi. */
  partySize: number | null;
  guestName: string | null;
  guestEmail: string | null;
  user: { name: string | null; email: string | null } | null;
  business: {
    name: string;
    slug: string;
    owner: { email: string | null } | null;
  };
  location: {
    addressLine1: string;
    postalCode: string;
    city: string;
    timezone: string;
  };
  items: {
    service: { name: string };
    resource: { name: string };
  }[];
};

async function loadBooking(bookingId: string): Promise<BookingForEmail | null> {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      startAt: true,
      endAt: true,
      totalPriceCents: true,
      currency: true,
      partySize: true,
      guestName: true,
      guestEmail: true,
      user: { select: { name: true, email: true } },
      business: {
        select: {
          name: true,
          slug: true,
          owner: { select: { email: true } },
        },
      },
      location: {
        select: {
          addressLine1: true,
          postalCode: true,
          city: true,
          timezone: true,
        },
      },
      items: {
        orderBy: { sortOrder: "asc" },
        select: {
          service: { select: { name: true } },
          resource: { select: { name: true } },
        },
      },
    },
  });
}

type Prepared = {
  data: BookingEmailData;
  customerEmail: string | null;
  businessEmail: string | null;
  profileUrl: string;
  /** Link „moja wizyta": /konto dla zalogowanych, podpisany dla gości. */
  customerUrl: string;
  address: string;
  serviceName: string;
};

/** „1 osoby", „2 osób" — dopełniacz po „dla". */
const partySizeGenitive = (partySize: number): string =>
  partySize === 1 ? "1 osoby" : `${partySize} osób`;

function prepare(booking: BookingForEmail): Prepared {
  const address = `${booking.location.addressLine1}, ${booking.location.postalCode} ${booking.location.city}`;

  // Rezerwacja stolika ma pozycję na KAŻDYM zajmowanym stoliku, wszystkie
  // z tą samą usługą techniczną — bez deduplikacji zestawienie dwóch stolików
  // dawało „Usługa: Rezerwacja stolika + Rezerwacja stolika".
  const isTableBooking = booking.partySize !== null;
  const serviceNames = [
    ...new Set(booking.items.map((item) => item.service.name)),
  ];
  const serviceName = isTableBooking
    ? `Stolik dla ${partySizeGenitive(booking.partySize!)}`
    : serviceNames.join(" + ") || "Wizyta";
  const staffNames = [
    ...new Set(booking.items.map((item) => item.resource.name)),
  ];
  const profileUrl = `${env.NEXT_PUBLIC_APP_URL}/b/${booking.business.slug}`;
  const customerEmail = booking.guestEmail ?? booking.user?.email ?? null;
  // Klient musi mieć gdzie kliknąć „zobacz / odwołaj wizytę": zalogowany
  // idzie do /konto, gość na podpisaną stronę wizyty. Wcześniej oba
  // przypadki lądowały na profilu firmy, gdzie nie da się nic zrobić.
  const customerUrl = customerBookingUrl({
    bookingId: booking.id,
    hasAccount: booking.user !== null,
    email: customerEmail,
    businessSlug: booking.business.slug,
  });

  return {
    data: {
      businessName: booking.business.name,
      address,
      serviceName,
      ...(isTableBooking ? { serviceLabel: "Stolik", staffLabel: "Stolik" } : {}),
      staffName: staffNames.join(", ") || null,
      startAt: booking.startAt,
      endAt: booking.endAt,
      timezone: booking.location.timezone,
      priceCents: booking.totalPriceCents,
      currency: booking.currency,
      url: profileUrl,
      customerName:
        booking.guestName ?? booking.user?.name ?? booking.guestEmail ?? null,
    },
    customerEmail,
    businessEmail: booking.business.owner?.email ?? null,
    profileUrl,
    customerUrl,
    address,
    serviceName,
  };
}

/** Potwierdzenie rezerwacji: klient (z .ics) + firma. */
export async function sendBookingConfirmationEmails(
  bookingId: string,
): Promise<void> {
  try {
    const booking = await loadBooking(bookingId);
    if (!booking) return;
    const prepared = prepare(booking);

    if (prepared.customerEmail) {
      const template = bookingConfirmedCustomer({
        ...prepared.data,
        url: prepared.customerUrl,
      });
      const ics = buildBookingIcs({
        uid: `booking-${booking.id}@planner`,
        start: booking.startAt,
        end: booking.endAt,
        summary: `${prepared.serviceName} — ${booking.business.name}`,
        description: `Rezerwacja w ${booking.business.name}. Numer wizyty: ${booking.id
          .slice(-8)
          .toUpperCase()}.`,
        location: prepared.address,
        url: prepared.customerUrl,
      });
      await sendMail({
        to: prepared.customerEmail,
        subject: template.subject,
        html: template.html,
        text: template.text,
        icsContent: ics,
        type: "BOOKING_CONFIRMED_CUSTOMER",
        bookingId: booking.id,
      });
    }

    if (prepared.businessEmail) {
      const template = bookingConfirmedBusiness(prepared.data);
      await sendMail({
        to: prepared.businessEmail,
        subject: template.subject,
        html: template.html,
        text: template.text,
        type: "BOOKING_CONFIRMED_BUSINESS",
        bookingId: booking.id,
      });
    }
  } catch (error) {
    // Błąd poczty nie może wywalić 201 — logujemy i idziemy dalej.
    console.error("E-maile potwierdzenia rezerwacji nieudane:", error);
  }
}

/** Anulowanie rezerwacji: klient + firma. */
export async function sendBookingCancellationEmails(
  bookingId: string,
): Promise<void> {
  try {
    const booking = await loadBooking(bookingId);
    if (!booking) return;
    const prepared = prepare(booking);

    if (prepared.customerEmail) {
      const template = bookingCancelledCustomer(prepared.data);
      await sendMail({
        to: prepared.customerEmail,
        subject: template.subject,
        html: template.html,
        text: template.text,
        type: "BOOKING_CANCELLED_CUSTOMER",
        bookingId: booking.id,
      });
    }

    if (prepared.businessEmail) {
      const template = bookingCancelledBusiness(prepared.data);
      await sendMail({
        to: prepared.businessEmail,
        subject: template.subject,
        html: template.html,
        text: template.text,
        type: "BOOKING_CANCELLED_BUSINESS",
        bookingId: booking.id,
      });
    }
  } catch (error) {
    console.error("E-maile anulowania rezerwacji nieudane:", error);
  }
}
