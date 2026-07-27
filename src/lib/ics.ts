/**
 * Generowanie plików .ics (iCalendar) dla rezerwacji.
 *
 * Minimalny, poprawny VCALENDAR z jednym VEVENT — załącznik do e-maili
 * potwierdzających wizytę. Wszystkie znaczniki czasu w UTC (sufiks Z),
 * linie rozdzielone CRLF zgodnie z RFC 5545.
 */

export type BookingIcsInput = {
  /** Stabilny identyfikator zdarzenia, np. `booking-<id>@planner`. */
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
};

/** Instant → "20260731T090000Z" (UTC, format iCalendar). */
export function formatIcsDate(instant: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${instant.getUTCFullYear()}` +
    `${pad(instant.getUTCMonth() + 1)}` +
    `${pad(instant.getUTCDate())}` +
    `T${pad(instant.getUTCHours())}` +
    `${pad(instant.getUTCMinutes())}` +
    `${pad(instant.getUTCSeconds())}Z`
  );
}

/**
 * Escaping wartości tekstowych wg RFC 5545 §3.3.11:
 * backslash, średnik i przecinek poprzedzone `\`, nowe linie jako literał `\n`.
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Buduje kompletny VCALENDAR (METHOD:PUBLISH) z jednym wydarzeniem. */
export function buildBookingIcs(input: BookingIcsInput): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Planner//Rezerwacje//PL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(input.uid)}`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(input.start)}`,
    `DTEND:${formatIcsDate(input.end)}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
  ];

  if (input.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(input.description)}`);
  }
  if (input.location) {
    lines.push(`LOCATION:${escapeIcsText(input.location)}`);
  }
  if (input.url) {
    lines.push(`URL:${escapeIcsText(input.url)}`);
  }

  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.join("\r\n") + "\r\n";
}
