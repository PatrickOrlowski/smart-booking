/**
 * Warstwa SMS: wysyłka przez SMSAPI.pl + treść przypomnienia.
 *
 * Wzorzec identyczny jak w `src/lib/mail.ts`: każda próba wysyłki zostawia
 * ślad w tabeli `notifications` (channel SMS) — wiersz powstaje PRZED wysyłką
 * (PENDING) i jest aktualizowany wynikiem (SENT/FAILED/SKIPPED). Brak tokenu
 * SMSAPI nie wysadza żadnego flow — SMS ląduje jako SKIPPED.
 *
 * `sendSms` nigdy nie rzuca: awaria bramki nie może zepsuć rezerwacji
 * ani przebiegu crona.
 */

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { utcToZonedWallClock } from "@/lib/time";
import type { NotificationStatus } from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Normalizacja numeru
// ---------------------------------------------------------------------------

/**
 * „+48 600-700 800", „0048600700800", „0600700800" → „48600700800".
 *
 * Ta sama kanonizacja co `normalizePhone` w panelu klientów (customer-match):
 * najpierw same cyfry, potem zdjęcie prefiksu kraju (48/0048) i zera
 * międzymiastowego z 9-cyfrowego numeru polskiego. SMSAPI oczekuje formatu
 * `48XXXXXXXXX` bez spacji i plusa, więc kierunkowy doklejamy z powrotem.
 * Numery spoza wzorca (zagraniczne) zostają jako same cyfry.
 */
export function smsRecipient(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const withoutCountry = digits
    .replace(/^(?:00)?48(?=\d{9}$)/, "")
    .replace(/^0(?=\d{9}$)/, "");
  return withoutCountry.length === 9 ? `48${withoutCountry}` : digits;
}

// ---------------------------------------------------------------------------
// Wysyłka
// ---------------------------------------------------------------------------

export type SendSmsInput = {
  to: string;
  message: string;
  /** np. REMINDER_24H_SMS — patrz model Notification. */
  type: string;
  bookingId?: string;
  /**
   * Istniejący wiersz `notifications` (status PENDING) do zaktualizowania
   * zamiast tworzenia nowego — używa tego cron przypomnień, który claimuje
   * wysyłkę atomowo w transakcji, zanim zacznie wołać SMSAPI.
   */
  notificationId?: string;
};

export type SendSmsResult = {
  ok: boolean;
  status: NotificationStatus;
};

const SMSAPI_ENDPOINT = "https://api.smsapi.pl/sms.do";

/** Twardy limit czasu na odpowiedź SMSAPI — jak RESEND_TIMEOUT_MS w mail.ts. */
const SMSAPI_TIMEOUT_MS = 5000;

export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  let notificationId: string | null = input.notificationId ?? null;
  const recipient = smsRecipient(input.to);

  try {
    if (!notificationId) {
      const notification = await prisma.notification.create({
        data: {
          channel: "SMS",
          type: input.type,
          recipient,
          // Notification nie ma kolumny na treść — SMS jest krótki (≤160
          // znaków), więc trzymamy go w `subject` dla audytu i debugowania.
          subject: input.message,
          bookingId: input.bookingId ?? null,
          status: "PENDING",
        },
        select: { id: true },
      });
      notificationId = notification.id;
    }

    if (!env.SMSAPI_TOKEN) {
      await prisma.notification.update({
        where: { id: notificationId },
        data: { status: "SKIPPED" },
      });
      return { ok: true, status: "SKIPPED" };
    }

    const response = await fetch(SMSAPI_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(SMSAPI_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${env.SMSAPI_TOKEN}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        to: recipient,
        message: input.message,
        from: env.SMS_FROM,
        format: "json",
        encoding: "utf-8",
      }),
    });

    const body = await response.text().catch(() => "");
    // SMSAPI zwraca 200 także dla błędów logicznych — sygnałem jest pole
    // `error` w JSON-ie (np. 101 zła autoryzacja, 13 zły numer).
    let apiError: string | null = null;
    try {
      const json = JSON.parse(body) as { error?: number; message?: string };
      if (json.error) {
        apiError = `SMSAPI error ${json.error}: ${json.message ?? ""}`;
      }
    } catch {
      apiError = response.ok ? `SMSAPI: nieczytelna odpowiedź: ${body}` : null;
    }

    if (!response.ok || apiError) {
      await prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: "FAILED",
          error: (apiError ?? `SMSAPI HTTP ${response.status}: ${body}`).slice(
            0,
            1000,
          ),
        },
      });
      return { ok: false, status: "FAILED" };
    }

    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: "SENT", sentAt: new Date() },
    });
    return { ok: true, status: "SENT" };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nieznany błąd wysyłki SMS";
    if (notificationId) {
      await prisma.notification
        .update({
          where: { id: notificationId },
          data: { status: "FAILED", error: message.slice(0, 1000) },
        })
        .catch(() => undefined);
    }
    console.error("sendSms: wysyłka nieudana:", error);
    return { ok: false, status: "FAILED" };
  }
}

// ---------------------------------------------------------------------------
// Treść przypomnienia
// ---------------------------------------------------------------------------

const pad = (value: number) => String(value).padStart(2, "0");

/** Limit jednej wiadomości w alfabecie GSM-7 (7-bitowym). */
const SMS_MAX_GSM7 = 160;
/**
 * Limit jednej wiadomości w UCS-2: JEDEN znak spoza GSM-7 (np. „Łódź",
 * „Świętokrzyska") przełącza całą wiadomość na kodowanie 16-bitowe, gdzie
 * pojedynczy SMS mieści 70 znaków — dłuższa treść zostałaby po cichu
 * sklejona z 2–3 płatnych części.
 */
const SMS_MAX_UCS2 = 70;

/** Podstawowy alfabet GSM 03.38 — 1 septet na znak. */
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
/** Rozszerzenie GSM 03.38 — znak kosztuje 2 septety (ESC + znak). */
const GSM7_EXTENSION = "^{}\\[~]|€\f";

/** Długość tekstu w septetach GSM-7 albo null, gdy tekst wymaga UCS-2. */
function gsm7Septets(text: string): number | null {
  let septets = 0;
  for (const char of text) {
    if (GSM7_EXTENSION.includes(char)) septets += 2;
    else if (GSM7_BASIC.includes(char)) septets += 1;
    else return null;
  }
  return septets;
}

/** Czy tekst mieści się w JEDNEJ wiadomości (GSM-7: 160 septetów, UCS-2: 70). */
function fitsInOneSms(text: string): boolean {
  const septets = gsm7Septets(text);
  // UCS-2 liczy jednostki UTF-16 — stąd .length, nie liczba code pointów.
  return septets !== null ? septets <= SMS_MAX_GSM7 : text.length <= SMS_MAX_UCS2;
}

/** Twarde cięcie do jednej wiadomości, z miejscem na kropkę na końcu. */
function truncateToOneSms(text: string): string {
  if (gsm7Septets(text) !== null) {
    // Czysty GSM-7 — utnij tak, żeby septety (rozszerzenie ×2) ≤ limit − 1.
    let septets = 0;
    let cut = "";
    for (const char of text) {
      const cost = GSM7_EXTENSION.includes(char) ? 2 : 1;
      if (septets + cost > SMS_MAX_GSM7 - 1) break;
      septets += cost;
      cut += char;
    }
    return cut + ".";
  }
  return text.slice(0, SMS_MAX_UCS2 - 1) + ".";
}

/**
 * Krótkie przypomnienie o wizycie (jedna wiadomość, z diakrytykami):
 * „Planner: przypomnienie o wizycie w Cut & Shave, 05.08 godz. 10:00,
 * Nowa 5, Warszawa."
 *
 * Termin formatujemy w strefie lokalu (utcToZonedWallClock). Gdy nazwa firmy
 * i adres nie mieszczą się w limicie, najpierw poświęcamy adres, na końcu
 * twardo ucinamy — lepszy SMS bez ogona niż dwie sklejone wiadomości. Limit
 * zależy od kodowania (patrz SMS_MAX_UCS2) — polskie diakrytyki w nazwie
 * lub adresie zbijają go ze 160 do 70 znaków.
 */
export function smsReminderMessage(data: {
  businessName: string;
  startAt: Date;
  timezone: string;
  addressLine1: string;
  city: string;
}): string {
  const start = utcToZonedWallClock(data.startAt, data.timezone);
  const term = `${pad(start.day)}.${pad(start.month)} godz. ${pad(start.hour)}:${pad(start.minute)}`;

  const full = `Planner: przypomnienie o wizycie w ${data.businessName}, ${term}, ${data.addressLine1}, ${data.city}.`;
  if (fitsInOneSms(full)) return full;

  const short = `Planner: przypomnienie o wizycie w ${data.businessName}, ${term}.`;
  if (fitsInOneSms(short)) return short;

  return truncateToOneSms(short);
}
