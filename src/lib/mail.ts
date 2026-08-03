/**
 * Warstwa e-maili: wysyłka przez Resend + szablony wiadomości.
 *
 * Każda próba wysyłki zostawia ślad w tabeli `notifications` — wiersz powstaje
 * PRZED wysyłką (PENDING) i jest aktualizowany wynikiem (SENT/FAILED/SKIPPED).
 * Dzięki temu przypomnienia mają naturalną deduplikację po (bookingId, type),
 * a brak klucza API nie wysadza flow rezerwacji — e-mail ląduje jako SKIPPED.
 *
 * `sendMail` nigdy nie rzuca: awaria poczty nie może zepsuć rezerwacji.
 */

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { utcToZonedWallClock } from "@/lib/time";
import type { NotificationStatus } from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Wysyłka
// ---------------------------------------------------------------------------

export type SendMailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Zawartość pliku .ics — trafia jako załącznik `wizyta.ics`. */
  icsContent?: string;
  /** np. BOOKING_CONFIRMED_CUSTOMER, REMINDER_24H — patrz model Notification. */
  type: string;
  bookingId?: string;
  /**
   * Istniejący wiersz `notifications` (status PENDING) do zaktualizowania
   * zamiast tworzenia nowego. Używa tego cron przypomnień, który rezerwuje
   * (claimuje) wysyłkę atomowo, zanim zacznie wołać Resend.
   */
  notificationId?: string;
};

export type SendMailResult = {
  ok: boolean;
  status: NotificationStatus;
};

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Twardy limit czasu na odpowiedź Resenda. Bez niego fetch w Node czeka
 * nawet 300 s (undici), co potrafi zjeść cały budżet czasu funkcji i zamienić
 * udaną rezerwację w 504 po stronie klienta.
 */
const RESEND_TIMEOUT_MS = 5000;

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  let notificationId: string | null = input.notificationId ?? null;

  try {
    if (!notificationId) {
      const notification = await prisma.notification.create({
        data: {
          channel: "EMAIL",
          type: input.type,
          recipient: input.to,
          subject: input.subject,
          bookingId: input.bookingId ?? null,
          status: "PENDING",
        },
        select: { id: true },
      });
      notificationId = notification.id;
    }

    if (!env.RESEND_API_KEY) {
      await prisma.notification.update({
        where: { id: notificationId },
        data: { status: "SKIPPED" },
      });
      return { ok: true, status: "SKIPPED" };
    }

    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(input.icsContent
          ? {
              attachments: [
                {
                  filename: "wizyta.ics",
                  content: Buffer.from(input.icsContent, "utf8").toString(
                    "base64",
                  ),
                },
              ],
            }
          : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      await prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: "FAILED",
          error: `Resend HTTP ${response.status}: ${body}`.slice(0, 1000),
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
      error instanceof Error ? error.message : "Nieznany błąd wysyłki";
    if (notificationId) {
      await prisma.notification
        .update({
          where: { id: notificationId },
          data: { status: "FAILED", error: message.slice(0, 1000) },
        })
        .catch(() => undefined);
    }
    console.error("sendMail: wysyłka nieudana:", error);
    return { ok: false, status: "FAILED" };
  }
}

// ---------------------------------------------------------------------------
// Formatowanie danych do szablonów (strefa lokalu, ceny w groszach)
// ---------------------------------------------------------------------------

const WEEKDAYS_SHORT = ["pon", "wt", "śr", "czw", "pt", "sob", "ndz"];

const pad = (value: number) => String(value).padStart(2, "0");

/** "pt 31.07.2026, 11:00–11:45" w strefie lokalu (przez src/lib/time.ts). */
function formatRangeInZone(startAt: Date, endAt: Date, timezone: string): string {
  const start = utcToZonedWallClock(startAt, timezone);
  const end = utcToZonedWallClock(endAt, timezone);
  const day = `${WEEKDAYS_SHORT[start.weekday]} ${pad(start.day)}.${pad(start.month)}.${start.year}`;
  return `${day}, ${pad(start.hour)}:${pad(start.minute)}–${pad(end.hour)}:${pad(end.minute)}`;
}

/** Grosze → "70 zł" / "70,50 zł" (Intl, pl-PL). */
function formatPriceCents(cents: number, currency: string): string {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

// ---------------------------------------------------------------------------
// Szablony
// ---------------------------------------------------------------------------

export type EmailTemplate = {
  subject: string;
  html: string;
  text: string;
};

/** Wspólne dane wizyty przekazywane do każdego szablonu. */
export type BookingEmailData = {
  businessName: string;
  /** Pełny adres lokalu, np. "Nowa 5, 00-001 Warszawa". */
  address: string;
  serviceName: string;
  /**
   * Etykieta pierwszego wiersza tabelki. Domyślnie „Usługa"; rezerwacja
   * stolika mówi „Stolik", bo gość nie wybierał żadnej usługi.
   */
  serviceLabel?: string;
  staffName?: string | null;
  /** Etykieta wiersza z zasobem: „Pracownik" w salonie, „Stolik" w restauracji. */
  staffLabel?: string;
  startAt: Date;
  endAt: Date;
  /** Strefa IANA lokalu — termin formatujemy w niej, nie w UTC. */
  timezone: string;
  priceCents: number;
  currency: string;
  /** Link do szczegółów (profil firmy / moje wizyty / kalendarz panelu). */
  url?: string;
  /** Imię i nazwisko klienta — używane w wiadomościach do firmy. */
  customerName?: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type DetailRow = { label: string; value: string };

function bookingRows(data: BookingEmailData): DetailRow[] {
  const rows: DetailRow[] = [
    { label: data.serviceLabel ?? "Usługa", value: data.serviceName },
    ...(data.staffName
      ? [{ label: data.staffLabel ?? "Pracownik", value: data.staffName }]
      : []),
    {
      label: "Termin",
      value: formatRangeInZone(data.startAt, data.endAt, data.timezone),
    },
    { label: "Miejsce", value: `${data.businessName}, ${data.address}` },
    {
      label: "Cena",
      value: formatPriceCents(data.priceCents, data.currency),
    },
  ];
  if (data.customerName) {
    rows.unshift({ label: "Klient", value: data.customerName });
  }
  return rows;
}

/**
 * Prosty markowy layout: nagłówek Planner, treść, stopka.
 * Style inline — klienci pocztowi ignorują <style>.
 */
function renderEmail(options: {
  heading: string;
  intro: string;
  rows: DetailRow[];
  ctaLabel?: string;
  ctaUrl?: string;
  outro?: string;
}): { html: string; text: string } {
  const rowsHtml = options.rows
    .map(
      (row) => `
        <tr>
          <td style="padding:6px 16px 6px 0;font-family:'DM Mono',Menlo,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6d6a63;vertical-align:top;white-space:nowrap;">${escapeHtml(row.label)}</td>
          <td style="padding:6px 0;font-size:14px;color:#131412;font-weight:600;">${escapeHtml(row.value)}</td>
        </tr>`,
    )
    .join("");

  const ctaHtml =
    options.ctaLabel && options.ctaUrl
      ? `
      <p style="margin:24px 0 0;">
        <a href="${escapeHtml(options.ctaUrl)}" style="display:inline-block;background:#143d31;color:#f7f4ef;text-decoration:none;font-size:13px;font-weight:600;padding:10px 22px;border-radius:999px;">${escapeHtml(options.ctaLabel)}</a>
      </p>`
      : "";

  const outroHtml = options.outro
    ? `<p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#6d6a63;">${escapeHtml(options.outro)}</p>`
    : "";

  const html = `
  <div style="background:#f2eee6;padding:32px 16px;font-family:'Instrument Sans',-apple-system,'Segoe UI',Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;">
      <div style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:#131412;padding:0 4px 14px;">Planner</div>
      <div style="background:#fffdf9;border:1.5px solid #131412;border-radius:18px;padding:28px 24px;">
        <h1 style="margin:0 0 10px;font-size:20px;line-height:1.2;letter-spacing:-0.01em;color:#131412;">${escapeHtml(options.heading)}</h1>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#131412;">${escapeHtml(options.intro)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;border-top:1px solid #ddd7ca;padding-top:8px;">
          ${rowsHtml}
        </table>
        ${ctaHtml}
        ${outroHtml}
      </div>
      <p style="margin:16px 4px 0;font-size:11px;line-height:1.5;color:#8f8b81;">Ta wiadomość została wysłana automatycznie przez Planner — marketplace rezerwacji. Prosimy na nią nie odpowiadać.</p>
    </div>
  </div>`;

  const textLines = [
    "PLANNER",
    "",
    options.heading,
    "",
    options.intro,
    "",
    ...options.rows.map((row) => `${row.label}: ${row.value}`),
    ...(options.ctaLabel && options.ctaUrl
      ? ["", `${options.ctaLabel}: ${options.ctaUrl}`]
      : []),
    ...(options.outro ? ["", options.outro] : []),
    "",
    "Wiadomość wysłana automatycznie przez Planner.",
  ];

  return { html, text: textLines.join("\n") };
}

/** Potwierdzenie wizyty — do klienta. */
export function bookingConfirmedCustomer(
  data: BookingEmailData,
): EmailTemplate {
  const term = formatRangeInZone(data.startAt, data.endAt, data.timezone);
  const subject = `Rezerwacja potwierdzona — ${data.businessName}, ${term}`;
  const { html, text } = renderEmail({
    heading: "Twoja wizyta jest potwierdzona",
    intro: `Dziękujemy za rezerwację w ${data.businessName}. Poniżej szczegóły wizyty — plik z zaproszeniem do kalendarza znajdziesz w załączniku.`,
    rows: bookingRows({ ...data, customerName: null }),
    ctaLabel: data.url ? "Zobacz szczegóły wizyty" : undefined,
    ctaUrl: data.url,
    outro:
      "Jeśli nie możesz przyjść, anuluj wizytę z wyprzedzeniem — zwolnisz termin innym klientom.",
  });
  return { subject, html, text };
}

/** Potwierdzenie wizyty — do firmy. */
export function bookingConfirmedBusiness(
  data: BookingEmailData,
): EmailTemplate {
  const term = formatRangeInZone(data.startAt, data.endAt, data.timezone);
  const subject = `Nowa rezerwacja: ${data.serviceName} — ${term}`;
  const { html, text } = renderEmail({
    heading: "Masz nową rezerwację",
    intro: `W ${data.businessName} pojawiła się nowa rezerwacja. Szczegóły poniżej.`,
    rows: bookingRows(data),
    ctaLabel: data.url ? "Otwórz kalendarz" : undefined,
    ctaUrl: data.url,
  });
  return { subject, html, text };
}

/** Anulowanie wizyty — do klienta. */
export function bookingCancelledCustomer(
  data: BookingEmailData,
): EmailTemplate {
  const subject = `Rezerwacja anulowana — ${data.businessName}`;
  const { html, text } = renderEmail({
    heading: "Twoja wizyta została anulowana",
    intro: `Rezerwacja w ${data.businessName} została anulowana. Poniżej szczegóły odwołanej wizyty.`,
    rows: bookingRows({ ...data, customerName: null }),
    ctaLabel: data.url ? "Zarezerwuj nowy termin" : undefined,
    ctaUrl: data.url,
    outro: "Zapraszamy do rezerwacji innego terminu.",
  });
  return { subject, html, text };
}

/** Anulowanie wizyty — do firmy. */
export function bookingCancelledBusiness(
  data: BookingEmailData,
): EmailTemplate {
  const term = formatRangeInZone(data.startAt, data.endAt, data.timezone);
  const subject = `Anulowana rezerwacja: ${data.serviceName} — ${term}`;
  const { html, text } = renderEmail({
    heading: "Rezerwacja została anulowana",
    intro: `Jedna z rezerwacji w ${data.businessName} została anulowana — termin wrócił do puli dostępnych.`,
    rows: bookingRows(data),
    ctaLabel: data.url ? "Otwórz kalendarz" : undefined,
    ctaUrl: data.url,
  });
  return { subject, html, text };
}

/** Przypomnienie ~24 h przed wizytą — do klienta. */
export function bookingReminder(data: BookingEmailData): EmailTemplate {
  const term = formatRangeInZone(data.startAt, data.endAt, data.timezone);
  const subject = `Przypomnienie o wizycie — ${data.businessName}, ${term}`;
  const { html, text } = renderEmail({
    heading: "Przypomnienie: jutro masz wizytę",
    intro: `Przypominamy o nadchodzącej wizycie w ${data.businessName}. Do zobaczenia!`,
    rows: bookingRows({ ...data, customerName: null }),
    ctaLabel: data.url ? "Zobacz szczegóły wizyty" : undefined,
    ctaUrl: data.url,
    outro:
      "Jeśli nie możesz przyjść, anuluj wizytę z wyprzedzeniem — zwolnisz termin innym klientom.",
  });
  return { subject, html, text };
}
