import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { bookingReminder, sendMail, type EmailTemplate } from "@/lib/mail";
import { customerBookingUrl } from "@/lib/booking-link";

/**
 * GET /api/cron/reminders — przypomnienia ~24 h przed wizytą.
 *
 * Wywoływane co godzinę przez Vercel Cron (vercel.json). Okno 22–26 h w przód
 * zachodzi na siebie między uruchomieniami, więc awaria pojedynczego przebiegu
 * nie gubi przypomnień.
 *
 * Deduplikacja: doręczeniem jest wyłącznie wiersz Notification REMINDER_24H
 * ze statusem SENT. PENDING liczy się tylko przez kilka minut (żeby dwa
 * nakładające się przebiegi nie wysłały dubla) — starsze wiersze pochodzą
 * z przerwanego przebiegu i są ponawiane. SKIPPED (brak klucza Resend)
 * i FAILED też są ponawiane, inaczej rezerwacje sprzed konfiguracji poczty
 * nigdy nie dostałyby przypomnienia.
 *
 * Wybór rezerwacji i zapis wierszy PENDING dzieją się w jednej transakcji
 * pod transakcyjnym advisory lockiem — bez unikalnego indeksu (bookingId,
 * type) to jedyna atomowa bariera przed dwoma równoległymi przebiegami
 * (ręczne odpalenie z CRON_SECRET w trakcie przebiegu godzinowego).
 *
 * Autoryzacja: Authorization: Bearer <CRON_SECRET> — Vercel dokleja nagłówek
 * automatycznie, gdy zmienna CRON_SECRET jest ustawiona w projekcie.
 */

export const dynamic = "force-dynamic";
/** Sekwencyjna wysyłka partii — potrzebuje więcej niż domyślne 10 s. */
export const maxDuration = 60;

const REMINDER_TYPE = "REMINDER_24H";
const HOUR_MS = 60 * 60 * 1000;
/** Ile rezerwacji obsługuje jeden przebieg (reszta poczeka do następnego). */
const BATCH_SIZE = 50;
/** Po tym czasie PENDING uznajemy za ślad po przerwanym przebiegu. */
const PENDING_STALE_MS = 15 * 60 * 1000;
/** Stały klucz advisory locka — tylko dla tego crona. */
const CRON_LOCK_KEY = 872_140_001;

type Claim = {
  notificationId: string;
  bookingId: string;
  recipient: string;
  template: EmailTemplate;
};

export async function GET(request: Request) {
  if (!env.CRON_SECRET) {
    return NextResponse.json(
      {
        error: "CRON_DISABLED",
        message: "Brak skonfigurowanego CRON_SECRET — endpoint wyłączony",
      },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization");
  if (header !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Nieprawidłowy token" },
      { status: 401 },
    );
  }

  const now = Date.now();
  const windowStart = new Date(now + 22 * HOUR_MS);
  const windowEnd = new Date(now + 26 * HOUR_MS);
  const pendingSince = new Date(now - PENDING_STALE_MS);

  const { claims, checked, withoutEmail, locked } = await prisma.$transaction(
    async (tx) => {
      // Lock transakcyjny — zwalnia się sam przy commit/rollback, więc nie
      // ma ryzyka, że zawieszony przebieg zablokuje kolejne na stałe.
      // Wariant „try": drugi, nakładający się przebieg po prostu odpuszcza,
      // zamiast czekać i zjadać budżet czasu funkcji.
      const [lock] = await tx.$queryRaw<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(${CRON_LOCK_KEY}::bigint) AS locked`;
      if (!lock?.locked) {
        return {
          claims: [] as Claim[],
          checked: 0,
          withoutEmail: 0,
          locked: false,
        };
      }

      // Ślady po przerwanych przebiegach: PENDING starszy niż okno przestaje
      // udawać „w trakcie wysyłki" i nie blokuje ponowienia.
      await tx.notification.updateMany({
        where: {
          type: REMINDER_TYPE,
          status: "PENDING",
          createdAt: { lt: pendingSince },
        },
        data: {
          status: "FAILED",
          error: "Przerwany przebieg crona — przypomnienie ponowione",
        },
      });

      const bookings = await tx.booking.findMany({
        where: {
          status: "CONFIRMED",
          startAt: { gte: windowStart, lte: windowEnd },
          notifications: {
            none: {
              type: REMINDER_TYPE,
              OR: [
                { status: "SENT" },
                { status: "PENDING", createdAt: { gte: pendingSince } },
              ],
            },
          },
        },
        select: {
          id: true,
          startAt: true,
          endAt: true,
          totalPriceCents: true,
          currency: true,
          guestEmail: true,
          user: { select: { email: true } },
          business: { select: { name: true, slug: true } },
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
        orderBy: { startAt: "asc" },
        take: BATCH_SIZE,
      });

      const claimed: Claim[] = [];
      let noEmail = 0;

      for (const booking of bookings) {
        const recipient = booking.guestEmail ?? booking.user?.email ?? null;
        if (!recipient) {
          // Brak adresu (np. rezerwacja MANUAL_STAFF bez e-maila) — nie ma
          // do kogo wysłać; celowo bez wiersza Notification, żeby kolejne
          // przebiegi też ją po prostu pomijały.
          noEmail += 1;
          continue;
        }

        const serviceName =
          booking.items.map((item) => item.service.name).join(" + ") ||
          "Wizyta";
        const staffNames = [
          ...new Set(booking.items.map((item) => item.resource.name)),
        ];

        claimed.push({
          notificationId: randomUUID(),
          bookingId: booking.id,
          recipient,
          template: bookingReminder({
            businessName: booking.business.name,
            address: `${booking.location.addressLine1}, ${booking.location.postalCode} ${booking.location.city}`,
            serviceName,
            staffName: staffNames.join(", ") || null,
            startAt: booking.startAt,
            endAt: booking.endAt,
            timezone: booking.location.timezone,
            priceCents: booking.totalPriceCents,
            currency: booking.currency,
            // „Zobacz szczegóły wizyty" ma prowadzić tam, gdzie klient
            // faktycznie może wizytę odwołać: /konto albo podpisana strona.
            url: customerBookingUrl({
              bookingId: booking.id,
              hasAccount: booking.user !== null,
              email: recipient,
              businessSlug: booking.business.slug,
            }),
          }),
        });
      }

      if (claimed.length > 0) {
        await tx.notification.createMany({
          data: claimed.map((claim) => ({
            id: claim.notificationId,
            channel: "EMAIL" as const,
            type: REMINDER_TYPE,
            recipient: claim.recipient,
            subject: claim.template.subject,
            bookingId: claim.bookingId,
            status: "PENDING" as const,
          })),
        });
      }

      return {
        claims: claimed,
        checked: bookings.length,
        withoutEmail: noEmail,
        locked: true,
      };
    },
    { timeout: 20_000 },
  );

  if (!locked) {
    // Inny przebieg właśnie pracuje — jego partia obejmuje to samo okno.
    return NextResponse.json({ checked: 0, sent: 0, skipped: 0, busy: true });
  }

  let sent = 0;
  let skipped = withoutEmail;

  for (const claim of claims) {
    const result = await sendMail({
      to: claim.recipient,
      subject: claim.template.subject,
      html: claim.template.html,
      text: claim.template.text,
      type: REMINDER_TYPE,
      bookingId: claim.bookingId,
      notificationId: claim.notificationId,
    });

    if (result.status === "SENT") {
      sent += 1;
    } else {
      // SKIPPED (brak klucza Resend) i FAILED liczymy jako pominięte
      // w tym przebiegu; oba zostaną ponowione przy kolejnym.
      skipped += 1;
    }
  }

  return NextResponse.json({ checked, sent, skipped });
}
