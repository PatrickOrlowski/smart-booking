import { describe, expect, it } from "vitest";
import {
  MAX_SERIES_OCCURRENCES,
  SeriesPlanError,
  planSeriesDates,
} from "./booking-series";
import { utcToZonedWallClock } from "./time";

/**
 * Testy planowania serii cyklicznych.
 *
 * Sedno: seria „czwartek 17:00" ma trzymać godzinę ŚCIENNĄ po obu stronach
 * zmiany czasu (Warszawa 2026: 29.03 na letni, 25.10 na zimowy), więc
 * odstęp w realnym czasie bywa 167 albo 169 godzin, a nie zawsze 168.
 */

const WARSAW = "Europe/Warsaw";
const HOUR = 60 * 60 * 1000;
const AT_17 = 17 * 60;

/** Wspólne tło: horyzont daleki, żeby nie mieszał się do testowanej reguły. */
const base = {
  weekday: 3, // czwartek
  startMinute: AT_17,
  timezone: WARSAW,
  maxAdvanceDays: 3650,
};

const isoList = (
  occurrences: ReturnType<typeof planSeriesDates>,
): string[] => occurrences.map((entry) => entry.iso);

const utcList = (
  occurrences: ReturnType<typeof planSeriesDates>,
): string[] => occurrences.map((entry) => entry.startAt.toISOString());

describe("planSeriesDates — interwały", () => {
  it("co tydzień: cztery kolejne czwartki", () => {
    const planned = planSeriesDates({
      ...base,
      startDate: "2026-08-03", // poniedziałek
      intervalWeeks: 1,
      occurrences: 4,
    });

    expect(isoList(planned)).toEqual([
      "2026-08-06",
      "2026-08-13",
      "2026-08-20",
      "2026-08-27",
    ]);
    // Czas letni w Warszawie = UTC+2, więc 17:00 lokalnie to 15:00 UTC.
    expect(utcList(planned)).toEqual([
      "2026-08-06T15:00:00.000Z",
      "2026-08-13T15:00:00.000Z",
      "2026-08-20T15:00:00.000Z",
      "2026-08-27T15:00:00.000Z",
    ]);
    expect(planned.map((entry) => entry.index)).toEqual([1, 2, 3, 4]);
  });

  it("co 2 tygodnie", () => {
    const planned = planSeriesDates({
      ...base,
      startDate: "2026-08-06",
      intervalWeeks: 2,
      occurrences: 4,
    });

    expect(isoList(planned)).toEqual([
      "2026-08-06",
      "2026-08-20",
      "2026-09-03",
      "2026-09-17",
    ]);
  });

  it("co 4 tygodnie — także przez zmianę czasu na zimowy", () => {
    const planned = planSeriesDates({
      ...base,
      startDate: "2026-08-06",
      intervalWeeks: 4,
      occurrences: 4,
    });

    expect(isoList(planned)).toEqual([
      "2026-08-06",
      "2026-09-03",
      "2026-10-01",
      "2026-10-29",
    ]);
    // Ostatnia wizyta wypada już po 25.10 (UTC+1) — instant przesuwa się
    // o godzinę, ale godzina lokalna zostaje ta sama.
    expect(utcList(planned)).toEqual([
      "2026-08-06T15:00:00.000Z",
      "2026-09-03T15:00:00.000Z",
      "2026-10-01T15:00:00.000Z",
      "2026-10-29T16:00:00.000Z",
    ]);
  });

  it("start w dniu tygodnia serii daje pierwszą wizytę tego samego dnia", () => {
    const planned = planSeriesDates({
      ...base,
      startDate: "2026-08-06", // czwartek
      intervalWeeks: 1,
      occurrences: 1,
    });
    expect(isoList(planned)).toEqual(["2026-08-06"]);
  });

  it("niedziela to 6 (poniedziałek = 0)", () => {
    const planned = planSeriesDates({
      ...base,
      weekday: 6,
      startDate: "2026-08-03", // poniedziałek
      intervalWeeks: 1,
      occurrences: 2,
    });
    expect(isoList(planned)).toEqual(["2026-08-09", "2026-08-16"]);
  });
});

describe("planSeriesDates — koniec serii", () => {
  it("limit liczby powtórzeń", () => {
    const planned = planSeriesDates({
      ...base,
      startDate: "2026-08-06",
      intervalWeeks: 1,
      occurrences: 6,
    });
    expect(planned).toHaveLength(6);
    expect(planned[5]!.iso).toBe("2026-09-10");
  });

  it("data końca jest włącznie", () => {
    const planned = planSeriesDates({
      ...base,
      startDate: "2026-08-06",
      intervalWeeks: 1,
      endDate: "2026-08-20",
    });
    expect(isoList(planned)).toEqual([
      "2026-08-06",
      "2026-08-13",
      "2026-08-20",
    ]);
  });

  it("gdy podano oba warunki, wygrywa ten, który wypadnie pierwszy", () => {
    const byOccurrences = planSeriesDates({
      ...base,
      startDate: "2026-08-06",
      intervalWeeks: 1,
      occurrences: 2,
      endDate: "2026-12-31",
    });
    expect(isoList(byOccurrences)).toEqual(["2026-08-06", "2026-08-13"]);

    const byEndDate = planSeriesDates({
      ...base,
      startDate: "2026-08-06",
      intervalWeeks: 1,
      occurrences: 20,
      endDate: "2026-08-27",
    });
    expect(isoList(byEndDate)).toEqual([
      "2026-08-06",
      "2026-08-13",
      "2026-08-20",
      "2026-08-27",
    ]);
  });

  it("sama data końca nie przebija twardego sufitu liczby wizyt", () => {
    const planned = planSeriesDates({
      ...base,
      startDate: "2026-08-06",
      intervalWeeks: 1,
      endDate: "2029-08-06",
    });
    expect(planned).toHaveLength(MAX_SERIES_OCCURRENCES);
  });
});

describe("planSeriesDates — horyzont rezerwacji", () => {
  it("obcina serię na maxAdvanceDays liczonym od startu", () => {
    const planned = planSeriesDates({
      ...base,
      startDate: "2026-08-03",
      intervalWeeks: 2,
      occurrences: 6,
      maxAdvanceDays: 60, // ostatni dopuszczalny dzień: 2026-10-02
    });

    expect(isoList(planned)).toEqual([
      "2026-08-06",
      "2026-08-20",
      "2026-09-03",
      "2026-09-17",
      "2026-10-01",
    ]);
  });

  it("horyzont krótszy niż pierwsze wystąpienie daje pustą listę", () => {
    const planned = planSeriesDates({
      ...base,
      startDate: "2026-08-03", // poniedziałek, pierwszy czwartek za 3 dni
      intervalWeeks: 1,
      occurrences: 4,
      maxAdvanceDays: 2,
    });
    expect(planned).toEqual([]);
  });

  it("horyzont dokładnie w dniu wizyty jeszcze ją mieści", () => {
    const planned = planSeriesDates({
      ...base,
      startDate: "2026-08-03",
      intervalWeeks: 1,
      occurrences: 4,
      maxAdvanceDays: 3,
    });
    expect(isoList(planned)).toEqual(["2026-08-06"]);
  });
});

describe("planSeriesDates — zmiana czasu", () => {
  // 29.03.2026 Warszawa przechodzi na czas letni (UTC+1 → UTC+2).
  it("wiosną utrzymuje 17:00 czasu lokalnego", () => {
    const planned = planSeriesDates({
      ...base,
      startDate: "2026-03-26", // czwartek przed zmianą
      intervalWeeks: 1,
      occurrences: 3,
    });

    expect(utcList(planned)).toEqual([
      "2026-03-26T16:00:00.000Z", // UTC+1
      "2026-04-02T15:00:00.000Z", // UTC+2
      "2026-04-09T15:00:00.000Z",
    ]);
    for (const entry of planned) {
      const wall = utcToZonedWallClock(entry.startAt, WARSAW);
      expect([wall.hour, wall.minute]).toEqual([17, 0]);
      expect(wall.weekday).toBe(3);
    }
    // Tydzień przez zmianę czasu ma 167 godzin realnego czasu — dodawanie
    // 7 × 24 h w milisekundach przesunęłoby wizytę na 18:00.
    expect(
      planned[1]!.startAt.getTime() - planned[0]!.startAt.getTime(),
    ).toBe(167 * HOUR);
  });

  // 25.10.2026 Warszawa wraca na czas zimowy (UTC+2 → UTC+1).
  it("jesienią utrzymuje 17:00 czasu lokalnego", () => {
    const planned = planSeriesDates({
      ...base,
      startDate: "2026-10-22", // czwartek przed zmianą
      intervalWeeks: 1,
      occurrences: 3,
    });

    expect(utcList(planned)).toEqual([
      "2026-10-22T15:00:00.000Z", // UTC+2
      "2026-10-29T16:00:00.000Z", // UTC+1
      "2026-11-05T16:00:00.000Z",
    ]);
    for (const entry of planned) {
      const wall = utcToZonedWallClock(entry.startAt, WARSAW);
      expect([wall.hour, wall.minute]).toEqual([17, 0]);
    }
    expect(
      planned[1]!.startAt.getTime() - planned[0]!.startAt.getTime(),
    ).toBe(169 * HOUR);
  });

  it("roczna seria co 4 tygodnie ma wszędzie tę samą godzinę lokalną", () => {
    const planned = planSeriesDates({
      ...base,
      startDate: "2026-01-08",
      intervalWeeks: 4,
      occurrences: 13,
    });

    expect(planned).toHaveLength(13);
    const offsets = new Set<number>();
    for (const entry of planned) {
      const wall = utcToZonedWallClock(entry.startAt, WARSAW);
      expect([wall.hour, wall.minute]).toEqual([17, 0]);
      expect(wall.weekday).toBe(3);
      offsets.add(entry.startAt.getUTCHours());
    }
    // Po drodze wypadają obie zmiany czasu, więc instanty muszą mieć
    // dwie różne godziny UTC (16:00 zimą, 15:00 latem).
    expect([...offsets].sort()).toEqual([15, 16]);
  });

  it("działa też w innej strefie (Europe/London)", () => {
    const planned = planSeriesDates({
      ...base,
      timezone: "Europe/London",
      startDate: "2026-03-26",
      intervalWeeks: 1,
      occurrences: 2,
    });
    expect(utcList(planned)).toEqual([
      "2026-03-26T17:00:00.000Z", // UTC+0
      "2026-04-02T16:00:00.000Z", // UTC+1 (BST od 29.03)
    ]);
  });
});

describe("planSeriesDates — walidacja", () => {
  it("wymaga liczby powtórzeń albo daty końca", () => {
    expect(() =>
      planSeriesDates({ ...base, startDate: "2026-08-06", intervalWeeks: 1 }),
    ).toThrow(SeriesPlanError);
  });

  it("odrzuca dzień tygodnia spoza 0–6", () => {
    expect(() =>
      planSeriesDates({
        ...base,
        weekday: 7,
        startDate: "2026-08-06",
        intervalWeeks: 1,
        occurrences: 2,
      }),
    ).toThrow(SeriesPlanError);
  });

  it("odrzuca interwał zerowy i ujemny", () => {
    for (const intervalWeeks of [0, -4, 1.5]) {
      expect(() =>
        planSeriesDates({
          ...base,
          startDate: "2026-08-06",
          intervalWeeks,
          occurrences: 2,
        }),
      ).toThrow(SeriesPlanError);
    }
  });

  it("odrzuca datę końca przed startem i niepoprawny format daty", () => {
    expect(() =>
      planSeriesDates({
        ...base,
        startDate: "2026-08-06",
        intervalWeeks: 1,
        endDate: "2026-08-01",
      }),
    ).toThrow(SeriesPlanError);

    expect(() =>
      planSeriesDates({
        ...base,
        startDate: "2026-02-31",
        intervalWeeks: 1,
        occurrences: 2,
      }),
    ).toThrow(SeriesPlanError);
  });

  it("odrzuca godzinę spoza doby", () => {
    expect(() =>
      planSeriesDates({
        ...base,
        startMinute: 1440,
        startDate: "2026-08-06",
        intervalWeeks: 1,
        occurrences: 2,
      }),
    ).toThrow(SeriesPlanError);
  });
});
