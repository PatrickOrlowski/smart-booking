import { describe, expect, it } from "vitest";
import {
  getTimeZoneOffsetMs,
  localDayMinutesToUtc,
  utcToZonedWallClock,
  zonedTimeToUtc,
} from "./time";

const WARSAW = "Europe/Warsaw";
const HOUR = 60 * 60 * 1000;

describe("zonedTimeToUtc", () => {
  it("przelicza czas letni (UTC+2)", () => {
    const utc = zonedTimeToUtc(
      { year: 2026, month: 7, day: 15, hour: 10, minute: 0 },
      WARSAW,
    );
    expect(utc.toISOString()).toBe("2026-07-15T08:00:00.000Z");
  });

  it("przelicza czas zimowy (UTC+1)", () => {
    const utc = zonedTimeToUtc(
      { year: 2026, month: 1, day: 15, hour: 10, minute: 0 },
      WARSAW,
    );
    expect(utc.toISOString()).toBe("2026-01-15T09:00:00.000Z");
  });

  // 29.03.2026: o 2:00 zegar przeskakuje na 3:00.
  it("obsługuje przejście na czas letni", () => {
    const before = zonedTimeToUtc(
      { year: 2026, month: 3, day: 29, hour: 1, minute: 30 },
      WARSAW,
    );
    const after = zonedTimeToUtc(
      { year: 2026, month: 3, day: 29, hour: 3, minute: 30 },
      WARSAW,
    );

    expect(before.toISOString()).toBe("2026-03-29T00:30:00.000Z");
    expect(after.toISOString()).toBe("2026-03-29T01:30:00.000Z");
    // Między 1:30 a 3:30 czasu lokalnego mija tylko godzina realnego czasu.
    expect(after.getTime() - before.getTime()).toBe(HOUR);
  });

  // 25.10.2026: o 3:00 zegar cofa się na 2:00 — 2:30 występuje dwa razy.
  it("dla czasu niejednoznacznego zwraca poprawny instant", () => {
    const ambiguous = zonedTimeToUtc(
      { year: 2026, month: 10, day: 25, hour: 2, minute: 30 },
      WARSAW,
    );
    const wall = utcToZonedWallClock(ambiguous, WARSAW);
    expect(wall.hour).toBe(2);
    expect(wall.minute).toBe(30);
  });

  it("doba zmiany czasu ma 23 godziny", () => {
    const dayStart = zonedTimeToUtc(
      { year: 2026, month: 3, day: 29, hour: 0, minute: 0 },
      WARSAW,
    );
    const nextDayStart = zonedTimeToUtc(
      { year: 2026, month: 3, day: 30, hour: 0, minute: 0 },
      WARSAW,
    );
    expect(nextDayStart.getTime() - dayStart.getTime()).toBe(23 * HOUR);
  });

  it("doba powrotu do czasu zimowego ma 25 godzin", () => {
    const dayStart = zonedTimeToUtc(
      { year: 2026, month: 10, day: 25, hour: 0, minute: 0 },
      WARSAW,
    );
    const nextDayStart = zonedTimeToUtc(
      { year: 2026, month: 10, day: 26, hour: 0, minute: 0 },
      WARSAW,
    );
    expect(nextDayStart.getTime() - dayStart.getTime()).toBe(25 * HOUR);
  });
});

describe("utcToZonedWallClock", () => {
  it("numeruje dni tygodnia od poniedziałku", () => {
    // 2026-07-13 to poniedziałek
    const monday = utcToZonedWallClock(
      new Date("2026-07-13T08:00:00.000Z"),
      WARSAW,
    );
    expect(monday.weekday).toBe(0);

    const sunday = utcToZonedWallClock(
      new Date("2026-07-19T08:00:00.000Z"),
      WARSAW,
    );
    expect(sunday.weekday).toBe(6);
  });

  it("jest odwrotnością zonedTimeToUtc", () => {
    const wall = { year: 2026, month: 11, day: 3, hour: 16, minute: 45 };
    const roundTrip = utcToZonedWallClock(zonedTimeToUtc(wall, WARSAW), WARSAW);
    expect(roundTrip).toMatchObject(wall);
  });
});

describe("localDayMinutesToUtc", () => {
  it("zamienia minuty od północy na instant", () => {
    const utc = localDayMinutesToUtc(
      { year: 2026, month: 7, day: 15 },
      9 * 60 + 30,
      WARSAW,
    );
    expect(utc.toISOString()).toBe("2026-07-15T07:30:00.000Z");
  });
});

describe("getTimeZoneOffsetMs", () => {
  it("zwraca +2h w czasie letnim i +1h w zimowym", () => {
    expect(
      getTimeZoneOffsetMs(new Date("2026-07-15T12:00:00.000Z"), WARSAW),
    ).toBe(2 * HOUR);
    expect(
      getTimeZoneOffsetMs(new Date("2026-01-15T12:00:00.000Z"), WARSAW),
    ).toBe(1 * HOUR);
  });
});
