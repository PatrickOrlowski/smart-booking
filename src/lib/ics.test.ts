import { describe, expect, it } from "vitest";
import { buildBookingIcs, escapeIcsText, formatIcsDate } from "@/lib/ics";

describe("formatIcsDate", () => {
  it("formatuje instant jako UTC z sufiksem Z", () => {
    expect(formatIcsDate(new Date("2026-07-31T09:00:00.000Z"))).toBe(
      "20260731T090000Z",
    );
  });

  it("zeruje milisekundy i dopełnia zerami", () => {
    expect(formatIcsDate(new Date("2026-01-05T03:07:09.999Z"))).toBe(
      "20260105T030709Z",
    );
  });

  it("nie przesuwa czasu do strefy lokalnej", () => {
    // 11:00 czasu warszawskiego (CEST, UTC+2) = 09:00 UTC.
    const instant = new Date("2026-07-31T11:00:00+02:00");
    expect(formatIcsDate(instant)).toBe("20260731T090000Z");
  });
});

describe("escapeIcsText", () => {
  it("escapuje przecinki i średniki", () => {
    expect(escapeIcsText("Nowa 5, Warszawa; I piętro")).toBe(
      "Nowa 5\\, Warszawa\\; I piętro",
    );
  });

  it("zamienia nowe linie na literał \\n", () => {
    expect(escapeIcsText("linia 1\nlinia 2\r\nlinia 3")).toBe(
      "linia 1\\nlinia 2\\nlinia 3",
    );
  });

  it("escapuje backslash przed pozostałymi znakami", () => {
    expect(escapeIcsText("a\\b;c")).toBe("a\\\\b\\;c");
  });
});

describe("buildBookingIcs", () => {
  const input = {
    uid: "booking-abc123@planner",
    start: new Date("2026-07-31T09:00:00.000Z"),
    end: new Date("2026-07-31T09:45:00.000Z"),
    summary: "Strzyżenie męskie — Barber Brothers",
    description: "Pracownik: Adam\nCena: 70 zł",
    location: "Nowa 5, 00-001 Warszawa",
    url: "https://planner.example/b/barber-brothers",
  };

  it("używa wyłącznie CRLF jako separatora linii", () => {
    const ics = buildBookingIcs(input);
    expect(ics.endsWith("\r\n")).toBe(true);
    // Żadnego samotnego \n bez poprzedzającego \r.
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
    expect(ics.replace(/\r\n/g, "")).not.toContain("\r");
  });

  it("zawiera wymagane pola kalendarza i wydarzenia", () => {
    const lines = buildBookingIcs(input).split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines).toContain("PRODID:-//Planner//Rezerwacje//PL");
    expect(lines).toContain("METHOD:PUBLISH");
    expect(lines).toContain("BEGIN:VEVENT");
    expect(lines).toContain("UID:booking-abc123@planner");
    expect(lines).toContain("DTSTART:20260731T090000Z");
    expect(lines).toContain("DTEND:20260731T094500Z");
    expect(lines).toContain("END:VEVENT");
    // Ostatnia niepusta linia zamyka kalendarz.
    expect(lines.at(-2)).toBe("END:VCALENDAR");
    expect(lines.at(-1)).toBe("");
  });

  it("DTSTAMP ma format UTC z sufiksem Z", () => {
    const ics = buildBookingIcs(input);
    expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z\r\n/);
  });

  it("escapuje wartości tekstowe w SUMMARY/DESCRIPTION/LOCATION", () => {
    const ics = buildBookingIcs({
      ...input,
      summary: "Wizyta; strzyżenie, broda",
      description: "Uwagi:\ndruga linia",
      location: "Nowa 5, Warszawa",
    });
    expect(ics).toContain("SUMMARY:Wizyta\\; strzyżenie\\, broda\r\n");
    expect(ics).toContain("DESCRIPTION:Uwagi:\\ndruga linia\r\n");
    expect(ics).toContain("LOCATION:Nowa 5\\, Warszawa\r\n");
  });

  it("pomija pola opcjonalne, gdy ich brak", () => {
    const ics = buildBookingIcs({
      uid: input.uid,
      start: input.start,
      end: input.end,
      summary: input.summary,
    });
    expect(ics).not.toContain("DESCRIPTION:");
    expect(ics).not.toContain("LOCATION:");
    expect(ics).not.toContain("URL:");
  });
});
