import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { bookingReminder, sendMail, type EmailTemplate } from "@/lib/mail";
import { sendSms, smsRecipient, smsReminderMessage } from "@/lib/sms";
import { sendPushToUser, type PushPayload } from "@/lib/push";
import { customerBookingUrl } from "@/lib/booking-link";
import { utcToZonedWallClock } from "@/lib/time";

/**
 * GET /api/cron/reminders — przypomnienia ~24 h przed wizytą
 * (e-mail + SMS + web push).
 *
 * Wywoływane co godzinę przez Vercel Cron (vercel.json). Okno 22–26 h w przód
 * zachodzi na siebie między uruchomieniami, więc awaria pojedynczego przebiegu
 * nie gubi przypomnień.
 *
 * Deduplikacja PER KANAŁ: każdy kanał ma własny typ wiersza Notification
 * (REMINDER_24H = e-mail, REMINDER_24H_SMS, REMINDER_24H_PUSH) i doręczeniem
 * jest wyłącznie wiersz danego typu ze statusem SENT — e-mail wysłany godzinę
 * temu nie blokuje SMS-a ani pusha, i odwrotnie. PENDING liczy się tylko przez
 * kilka minut (żeby dwa nakładające się przebiegi nie wysłały dubla) — starsze
 * wiersze pochodzą z przerwanego przebiegu i są ponawiane. SKIPPED (brak
 * klucza Resend / tokenu SMSAPI / subskrypcji) i FAILED też są ponawiane,
 * inaczej rezerwacje sprzed konfiguracji dostawcy nigdy nie dostałyby
 * przypomnienia.
 *
 * Wybór rezerwacji i zapis wierszy PENDING wszystkich kanałów dzieją się
 * w jednej transakcji pod transakcyjnym advisory lockiem — bez unikalnego
 * indeksu (bookingId, type) to jedyna atomowa bariera przed dwoma równoległymi
 * przebiegami (ręczne odpalenie z CRON_SECRET w trakcie przebiegu godzinowego).
 *
 * Autoryzacja: Authorization: Bearer <CRON_SECRET> — Vercel dokleja nagłówek
 * automatycznie, gdy zmienna CRON_SECRET jest ustawiona w projekcie.
 */

export const dynamic = "force-dynamic";
/** Sekwencyjna wysyłka partii — potrzebuje więcej niż domyślne 10 s. */
export const maxDuration = 60;

const REMINDER_EMAIL = "REMINDER_24H";
const REMINDER_SMS = "REMINDER_24H_SMS";
const REMINDER_PUSH = "REMINDER_24H_PUSH";
const REMINDER_TYPES = [REMINDER_EMAIL, REMINDER_SMS, REMINDER_PUSH];

const HOUR_MS = 60 * 60 * 1000;
/** Ile rezerwacji obsługuje jeden przebieg (reszta poczeka do następnego). */
const BATCH_SIZE = 50;
/** Po tym czasie PENDING uznajemy za ślad po przerwanym przebiegu. */
const PENDING_STALE_MS = 15 * 60 * 1000;
/**
 * Budżet czasu na wysyłki, z zapasem przed maxDuration: worst case to
 * 3 × BATCH_SIZE sekwencyjnych wywołań dostawców po 5 s timeoutu — bez
 * budżetu platforma ubiłaby przebieg w trakcie (np. po przyjęciu SMS-a przez
 * SMSAPI, a przed zapisem SENT → stale-FAILED → retry → zdublowany, płatny
 * SMS). Po przekroczeniu deadline'u nic już nie wysyłamy; niewysłane claimy
 * zostają PENDING i wrócą jako FAILED po PENDING_STALE_MS.
 */
const SEND_BUDGET_MS = 45_000;
/** Stały klucz advisory locka — tylko dla tego crona. */
const CRON_LOCK_KEY = 872_140_001;

type EmailClaim = {
  notificationId: string;
  bookingId: string;
  recipient: string;
  template: EmailTemplate;
};

type SmsClaim = {
  notificationId: string;
  bookingId: string;
  recipient: string;
  message: string;
};

type PushClaim = {
  notificationId: string;
  bookingId: string;
  userId: string;
  payload: PushPayload;
};

const pad = (value: number) => String(value).padStart(2, "0");

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

  /** Wiersz danego typu blokujący ponowny claim (doręczony lub świeżo w toku). */
  const claimedNotification = (type: string) => ({
    type,
    OR: [
      { status: "SENT" as const },
      { status: "PENDING" as const, createdAt: { gte: pendingSince } },
    ],
  });

  const { emailClaims, smsClaims, pushClaims, checked, withoutContact, locked } =
    await prisma.$transaction(
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
            emailClaims: [] as EmailClaim[],
            smsClaims: [] as SmsClaim[],
            pushClaims: [] as PushClaim[],
            checked: 0,
            withoutContact: 0,
            locked: false,
          };
        }

        // Ślady po przerwanych przebiegach: PENDING starszy niż okno przestaje
        // udawać „w trakcie wysyłki" i nie blokuje ponowienia — dla każdego
        // z trzech kanałów.
        await tx.notification.updateMany({
          where: {
            type: { in: REMINDER_TYPES },
            status: "PENDING",
            createdAt: { lt: pendingSince },
          },
          data: {
            status: "FAILED",
            error: "Przerwany przebieg crona — przypomnienie ponowione",
          },
        });

        // Rezerwacja wchodzi do partii, gdy KTÓRYKOLWIEK kanał jest jeszcze
        // niezaklepany I ISTNIEJE dla niego kontakt (adres/telefon/subskrypcja
        // — te same źródła co logika claimów niżej). Sam brak wiersza
        // Notification nie wystarczy: rezerwacja z wysłanym e-mailem, ale bez
        // telefonu i subskrypcji, wracałaby do partii w każdym przebiegu
        // i przy >BATCH_SIZE takich rezerwacji głodziłaby te, które naprawdę
        // czekają na przypomnienie. Które kanały dokładnie — rozstrzygamy
        // niżej po liście istniejących wierszy (select `notifications`).
        const bookings = await tx.booking.findMany({
          where: {
            status: "CONFIRMED",
            startAt: { gte: windowStart, lte: windowEnd },
            OR: [
              {
                notifications: { none: claimedNotification(REMINDER_EMAIL) },
                OR: [
                  { guestEmail: { not: null } },
                  { user: { is: { email: { not: null } } } },
                ],
              },
              {
                notifications: { none: claimedNotification(REMINDER_SMS) },
                OR: [
                  { guestPhone: { not: null } },
                  { user: { is: { phone: { not: null } } } },
                  { customer: { is: { phone: { not: null } } } },
                ],
              },
              {
                notifications: { none: claimedNotification(REMINDER_PUSH) },
                user: { is: { pushSubscriptions: { some: {} } } },
              },
            ],
          },
          select: {
            id: true,
            startAt: true,
            endAt: true,
            totalPriceCents: true,
            currency: true,
            guestEmail: true,
            guestPhone: true,
            user: {
              select: {
                id: true,
                email: true,
                phone: true,
                // Wystarczy wiedzieć, że jest co najmniej jedna subskrypcja.
                pushSubscriptions: { take: 1, select: { id: true } },
              },
            },
            customer: { select: { phone: true } },
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
            notifications: {
              where: { OR: REMINDER_TYPES.map(claimedNotification) },
              select: { type: true },
            },
          },
          orderBy: { startAt: "asc" },
          take: BATCH_SIZE,
        });

        const emails: EmailClaim[] = [];
        const smses: SmsClaim[] = [];
        const pushes: PushClaim[] = [];
        let noContact = 0;

        for (const booking of bookings) {
          const alreadyClaimed = new Set(
            booking.notifications.map((notification) => notification.type),
          );
          let claimedAny = false;

          // --- E-MAIL (jak dotychczas) -----------------------------------
          const email = booking.guestEmail ?? booking.user?.email ?? null;
          if (!alreadyClaimed.has(REMINDER_EMAIL) && email) {
            const serviceName =
              booking.items.map((item) => item.service.name).join(" + ") ||
              "Wizyta";
            const staffNames = [
              ...new Set(booking.items.map((item) => item.resource.name)),
            ];

            emails.push({
              notificationId: randomUUID(),
              bookingId: booking.id,
              recipient: email,
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
                  email,
                  businessSlug: booking.business.slug,
                }),
              }),
            });
            claimedAny = true;
          }

          // --- SMS -------------------------------------------------------
          const phone =
            booking.guestPhone ??
            booking.user?.phone ??
            booking.customer?.phone ??
            null;
          if (!alreadyClaimed.has(REMINDER_SMS) && phone) {
            smses.push({
              notificationId: randomUUID(),
              bookingId: booking.id,
              recipient: smsRecipient(phone),
              message: smsReminderMessage({
                businessName: booking.business.name,
                startAt: booking.startAt,
                timezone: booking.location.timezone,
                addressLine1: booking.location.addressLine1,
                city: booking.location.city,
              }),
            });
            claimedAny = true;
          }

          // --- WEB PUSH --------------------------------------------------
          const pushUser =
            booking.user && booking.user.pushSubscriptions.length > 0
              ? booking.user
              : null;
          if (!alreadyClaimed.has(REMINDER_PUSH) && pushUser) {
            const start = utcToZonedWallClock(
              booking.startAt,
              booking.location.timezone,
            );
            pushes.push({
              notificationId: randomUUID(),
              bookingId: booking.id,
              userId: pushUser.id,
              payload: {
                title: "Przypomnienie o wizycie",
                body: `${booking.business.name} — ${pad(start.day)}.${pad(start.month)}, ${pad(start.hour)}:${pad(start.minute)} · ${booking.location.addressLine1}, ${booking.location.city}`,
                // Push dostaje tylko zalogowany klient — szczegóły ma w /konto.
                url: customerBookingUrl({
                  bookingId: booking.id,
                  hasAccount: true,
                  email: null,
                  businessSlug: booking.business.slug,
                }),
              },
            });
            claimedAny = true;
          }

          if (!claimedAny) {
            // Zapytanie wyżej dobiera tylko rezerwacje z kontaktem dla
            // niezaklepanego kanału, więc to gałąź awaryjna (np. pusty string
            // w telefonie — SQL widzi wartość, `?? / if (phone)` już nie).
            // Celowo bez wierszy Notification.
            noContact += 1;
          }
        }

        const rows = [
          ...emails.map((claim) => ({
            id: claim.notificationId,
            channel: "EMAIL" as const,
            type: REMINDER_EMAIL,
            recipient: claim.recipient,
            subject: claim.template.subject,
            bookingId: claim.bookingId,
            status: "PENDING" as const,
          })),
          ...smses.map((claim) => ({
            id: claim.notificationId,
            channel: "SMS" as const,
            type: REMINDER_SMS,
            recipient: claim.recipient,
            // Notification nie ma kolumny na treść — SMS trzymamy w subject.
            subject: claim.message,
            bookingId: claim.bookingId,
            status: "PENDING" as const,
          })),
          ...pushes.map((claim) => ({
            id: claim.notificationId,
            channel: "PUSH" as const,
            type: REMINDER_PUSH,
            recipient: claim.userId,
            subject: claim.payload.title,
            bookingId: claim.bookingId,
            status: "PENDING" as const,
          })),
        ];

        if (rows.length > 0) {
          await tx.notification.createMany({ data: rows });
        }

        return {
          emailClaims: emails,
          smsClaims: smses,
          pushClaims: pushes,
          checked: bookings.length,
          withoutContact: noContact,
          locked: true,
        };
      },
      { timeout: 20_000 },
    );

  if (!locked) {
    // Inny przebieg właśnie pracuje — jego partia obejmuje to samo okno.
    return NextResponse.json({ checked: 0, sent: 0, skipped: 0, busy: true });
  }

  const counters = {
    email: { sent: 0, skipped: 0 },
    sms: { sent: 0, skipped: 0 },
    push: { sent: 0, skipped: 0 },
  };

  // Deadline liczony od startu żądania (`now`) — patrz SEND_BUDGET_MS.
  const sendDeadline = now + SEND_BUDGET_MS;
  const outOfBudget = () => Date.now() >= sendDeadline;

  for (const claim of emailClaims) {
    if (outOfBudget()) {
      counters.email.skipped += 1;
      continue;
    }
    const result = await sendMail({
      to: claim.recipient,
      subject: claim.template.subject,
      html: claim.template.html,
      text: claim.template.text,
      type: REMINDER_EMAIL,
      bookingId: claim.bookingId,
      notificationId: claim.notificationId,
    });
    // SKIPPED (brak klucza dostawcy) i FAILED liczymy jako pominięte w tym
    // przebiegu; oba zostaną ponowione przy kolejnym — dotyczy każdego kanału.
    if (result.status === "SENT") counters.email.sent += 1;
    else counters.email.skipped += 1;
  }

  for (const claim of smsClaims) {
    if (outOfBudget()) {
      counters.sms.skipped += 1;
      continue;
    }
    const result = await sendSms({
      to: claim.recipient,
      message: claim.message,
      type: REMINDER_SMS,
      bookingId: claim.bookingId,
      notificationId: claim.notificationId,
    });
    if (result.status === "SENT") counters.sms.sent += 1;
    else counters.sms.skipped += 1;
  }

  for (const claim of pushClaims) {
    if (outOfBudget()) {
      counters.push.skipped += 1;
      continue;
    }
    const result = await sendPushToUser({
      userId: claim.userId,
      payload: claim.payload,
      type: REMINDER_PUSH,
      bookingId: claim.bookingId,
      notificationId: claim.notificationId,
    });
    if (result.status === "SENT") counters.push.sent += 1;
    else counters.push.skipped += 1;
  }

  const sent =
    counters.email.sent + counters.sms.sent + counters.push.sent;
  const skipped =
    withoutContact +
    counters.email.skipped +
    counters.sms.skipped +
    counters.push.skipped;

  return NextResponse.json({ checked, sent, skipped, channels: counters });
}
