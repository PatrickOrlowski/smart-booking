import { describe, expect, it } from "vitest";
import {
  computeAvailability,
  enumerateLocalDays,
  isoDateToLocalDate,
  localDateToIso,
  type AvailabilityConfig,
  type ComputeAvailabilityInput,
  type ResourceAvailabilityInput,
} from "./availability";
import { zonedTimeToUtc } from "./time";

const WARSAW = "Europe/Warsaw";

const baseConfig: AvailabilityConfig = {
  timezone: WARSAW,
  slotGranularityMin: 15,
  minLeadTimeMin: 60,
  maxAdvanceDays: 60,
};

/** Wtorek 14.07.2026 — zwykły letni dzień bez zmiany czasu. */
const DAY = { year: 2026, month: 7, day: 14 };
/** „Teraz": tydzień wcześniej — lead time nie przycina wyników. */
const NOW = zonedTimeToUtc(
  { year: 2026, month: 7, day: 7, hour: 12, minute: 0 },
  WARSAW,
);

const hhmm = (h: number, m = 0) => h * 60 + m;

const resource = (
  overrides: Partial<ResourceAvailabilityInput> = {},
): ResourceAvailabilityInput => ({
  id: "r1",
  workingHours: [{ weekday: 1, startMinute: hhmm(9), endMinute: hhmm(17) }],
  busy: [],
  timeOff: [],
  holds: [],
  ...overrides,
});

const compute = (overrides: Partial<ComputeAvailabilityInput> = {}) =>
  computeAvailability({
    resources: [resource()],
    openingHours: [],
    locationTimeOff: [],
    config: baseConfig,
    dateFrom: DAY,
    dateTo: DAY,
    serviceDurationMin: 30,
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    now: NOW,
    ...overrides,
  });

/** Etykiety ścienne HH:MM w strefie lokalu — czytelniejsze asercje. */
const wallLabels = (dates: Date[], timeZone = WARSAW) => {
  const formatter = new Intl.DateTimeFormat("pl-PL", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return dates.map((date) => formatter.format(date));
};

const mergedLabels = (result: ReturnType<typeof computeAvailability>) =>
  wallLabels(result.merged.map((slot) => slot.startAt));

describe("computeAvailability — podstawy", () => {
  it("generuje sloty na siatce granulacji wewnątrz grafiku", () => {
    const result = compute({
      config: { ...baseConfig, slotGranularityMin: 60 },
      serviceDurationMin: 60,
    });
    expect(mergedLabels(result)).toEqual([
      "09:00",
      "10:00",
      "11:00",
      "12:00",
      "13:00",
      "14:00",
      "15:00",
      "16:00",
    ]);
    // 16:00 + 60 min kończy się równo z grafikiem; 17:00 już nie wchodzi.
    expect(
      wallLabels(result.perResource[0].slots.map((slot) => slot.endAt)).at(-1),
    ).toBe("17:00");
  });

  it("granulacja 15 vs 30 min zmienia liczbę slotów", () => {
    const every15 = compute({
      config: { ...baseConfig, slotGranularityMin: 15 },
    });
    const every30 = compute({
      config: { ...baseConfig, slotGranularityMin: 30 },
    });
    // 8 h okna − 30 min usługi → ostatni start 16:30.
    expect(every15.merged).toHaveLength(31);
    expect(every30.merged).toHaveLength(16);
  });

  it("sloty są w UTC: 9:00 czasu letniego = 07:00Z", () => {
    const result = compute();
    expect(result.merged[0].startAt.toISOString()).toBe(
      "2026-07-14T07:00:00.000Z",
    );
  });

  it("dzień bez grafiku nie ma slotów", () => {
    // Niedziela 19.07.2026 — grafik tylko na wtorek (weekday 1).
    const result = compute({
      dateFrom: { year: 2026, month: 7, day: 19 },
      dateTo: { year: 2026, month: 7, day: 19 },
    });
    expect(result.merged).toHaveLength(0);
  });
});

describe("computeAvailability — bufory", () => {
  it("bufor po usłudze skraca końcówkę dnia", () => {
    const result = compute({
      config: { ...baseConfig, slotGranularityMin: 30 },
      serviceDurationMin: 30,
      bufferAfterMin: 15,
    });
    // 16:30 wymagałoby blokady do 17:15 — poza grafikiem.
    expect(mergedLabels(result).at(-1)).toBe("16:00");
  });

  it("bufor przed usługą odsuwa pierwszy slot dnia", () => {
    const result = compute({
      serviceDurationMin: 30,
      bufferBeforeMin: 10,
    });
    // Blokada 9:00 zaczynałaby się 8:50 — przed grafikiem. Pierwszy start
    // na siatce, którego blokada mieści się w grafiku, to 9:15.
    expect(mergedLabels(result)[0]).toBe("09:15");
  });

  it("bufory blokują sąsiedztwo zajętego przedziału", () => {
    const busyStart = zonedTimeToUtc(
      { ...DAY, hour: 12, minute: 0 },
      WARSAW,
    );
    const busyEnd = zonedTimeToUtc({ ...DAY, hour: 13, minute: 0 }, WARSAW);
    const result = compute({
      resources: [resource({ busy: [{ start: busyStart, end: busyEnd }] })],
      config: { ...baseConfig, slotGranularityMin: 30 },
      serviceDurationMin: 30,
      bufferAfterMin: 15,
    });
    const labels = mergedLabels(result);
    // 11:30 wymagałoby blokady do 12:15 — koliduje z zajętym 12:00-13:00.
    expect(labels).not.toContain("11:30");
    expect(labels).toContain("11:00");
    // Po zajętym przedziale pierwszy start to 13:00 (blokada 13:00-13:45).
    expect(labels).toContain("13:00");
  });
});

describe("computeAvailability — przerwa w środku dnia", () => {
  it("dwa bloki WorkingHours dają dwie serie slotów bez przerwy obiadowej", () => {
    const withBreak = resource({
      workingHours: [
        { weekday: 1, startMinute: hhmm(9), endMinute: hhmm(13) },
        { weekday: 1, startMinute: hhmm(14), endMinute: hhmm(18) },
      ],
    });
    const result = compute({
      resources: [withBreak],
      config: { ...baseConfig, slotGranularityMin: 60 },
      serviceDurationMin: 60,
    });
    expect(mergedLabels(result)).toEqual([
      "09:00",
      "10:00",
      "11:00",
      "12:00", // kończy się 13:00, równo z końcem bloku
      "14:00",
      "15:00",
      "16:00",
      "17:00",
    ]);
  });

  it("usługa nie może przeciąć przerwy między blokami", () => {
    const withBreak = resource({
      workingHours: [
        { weekday: 1, startMinute: hhmm(9), endMinute: hhmm(13) },
        { weekday: 1, startMinute: hhmm(14), endMinute: hhmm(18) },
      ],
    });
    const result = compute({
      resources: [withBreak],
      config: { ...baseConfig, slotGranularityMin: 30 },
      serviceDurationMin: 90,
    });
    const labels = mergedLabels(result);
    // 12:00 + 90 min = 13:30 — wpada w przerwę.
    expect(labels).not.toContain("12:00");
    expect(labels).not.toContain("13:00");
    expect(labels).toContain("11:30");
    expect(labels).toContain("14:00");
  });
});

describe("computeAvailability — urlop i blokady", () => {
  it("TimeOff zasobu wycina sloty", () => {
    const offStart = zonedTimeToUtc({ ...DAY, hour: 11, minute: 0 }, WARSAW);
    const offEnd = zonedTimeToUtc({ ...DAY, hour: 15, minute: 0 }, WARSAW);
    const result = compute({
      resources: [resource({ timeOff: [{ start: offStart, end: offEnd }] })],
      config: { ...baseConfig, slotGranularityMin: 60 },
      serviceDurationMin: 60,
    });
    expect(mergedLabels(result)).toEqual(["09:00", "10:00", "15:00", "16:00"]);
  });

  it("całodniowy urlop zeruje dzień, blokada lokalizacji tnie wszystkich", () => {
    const dayStart = zonedTimeToUtc({ ...DAY, hour: 0, minute: 0 }, WARSAW);
    const dayEnd = zonedTimeToUtc(
      { year: 2026, month: 7, day: 15, hour: 0, minute: 0 },
      WARSAW,
    );
    const onVacation = compute({
      resources: [resource({ timeOff: [{ start: dayStart, end: dayEnd }] })],
    });
    expect(onVacation.merged).toHaveLength(0);

    const locationClosed = compute({
      resources: [
        resource(),
        resource({ id: "r2" }),
      ],
      locationTimeOff: [{ start: dayStart, end: dayEnd }],
    });
    expect(locationClosed.merged).toHaveLength(0);
  });

  it("aktywny hold blokuje slot jak rezerwacja", () => {
    const holdStart = zonedTimeToUtc({ ...DAY, hour: 9, minute: 0 }, WARSAW);
    const holdEnd = zonedTimeToUtc({ ...DAY, hour: 9, minute: 30 }, WARSAW);
    const result = compute({
      resources: [resource({ holds: [{ start: holdStart, end: holdEnd }] })],
      config: { ...baseConfig, slotGranularityMin: 30 },
    });
    expect(mergedLabels(result)[0]).toBe("09:30");
  });
});

describe("computeAvailability — lead time i horyzont", () => {
  it("min. wyprzedzenie odcina najbliższe sloty", () => {
    // „Teraz" = 10:05 w dniu wizyty, lead time 120 min → najwcześniej 12:05,
    // czyli pierwszy slot na siatce to 12:15.
    const result = compute({
      now: zonedTimeToUtc({ ...DAY, hour: 10, minute: 5 }, WARSAW),
      config: { ...baseConfig, minLeadTimeMin: 120 },
    });
    expect(mergedLabels(result)[0]).toBe("12:15");
  });

  it("dzień poza horyzontem maxAdvanceDays nie ma slotów", () => {
    const result = compute({
      config: { ...baseConfig, maxAdvanceDays: 3 },
      // NOW = 7.07, horyzont 3 dni → 14.07 poza zakresem.
    });
    expect(result.merged).toHaveLength(0);

    const inRange = compute({
      config: { ...baseConfig, maxAdvanceDays: 7 },
    });
    expect(inRange.merged.length).toBeGreaterThan(0);
  });
});

describe("computeAvailability — godziny otwarcia lokalu", () => {
  it("grafik jest przycinany do godzin otwarcia", () => {
    const result = compute({
      resources: [
        resource({
          workingHours: [
            { weekday: 1, startMinute: hhmm(8), endMinute: hhmm(20) },
          ],
        }),
      ],
      openingHours: [{ weekday: 1, startMinute: hhmm(10), endMinute: hhmm(16) }],
      config: { ...baseConfig, slotGranularityMin: 60 },
      serviceDurationMin: 60,
    });
    expect(mergedLabels(result)).toEqual([
      "10:00",
      "11:00",
      "12:00",
      "13:00",
      "14:00",
      "15:00",
    ]);
  });

  it("lokal zamknięty w dany dzień tygodnia = brak slotów mimo grafiku", () => {
    const result = compute({
      openingHours: [{ weekday: 3, startMinute: hhmm(9), endMinute: hhmm(17) }],
    });
    expect(result.merged).toHaveLength(0);
  });
});

describe("computeAvailability — wersjonowanie grafiku", () => {
  it("respektuje validFrom/validTo", () => {
    const oldSchedule = {
      weekday: 1,
      startMinute: hhmm(9),
      endMinute: hhmm(12),
      validTo: new Date(Date.UTC(2026, 6, 13)), // do 13.07
    };
    const newSchedule = {
      weekday: 1,
      startMinute: hhmm(14),
      endMinute: hhmm(17),
      validFrom: new Date(Date.UTC(2026, 6, 14)), // od 14.07
    };
    const result = compute({
      resources: [resource({ workingHours: [oldSchedule, newSchedule] })],
      config: { ...baseConfig, slotGranularityMin: 60 },
      serviceDurationMin: 60,
    });
    expect(mergedLabels(result)).toEqual(["14:00", "15:00", "16:00"]);
  });
});

describe("computeAvailability — DST Europe/Warsaw", () => {
  it("29.03.2026 (skok 2:00→3:00): godziny 2:xx nie istnieją, doba ma 23 h", () => {
    // 29.03.2026 to niedziela (weekday 6). Grafik nocny 1:00-4:00.
    const night = resource({
      workingHours: [{ weekday: 6, startMinute: hhmm(1), endMinute: hhmm(4) }],
    });
    const springForward = { year: 2026, month: 3, day: 29 };
    const result = compute({
      resources: [night],
      dateFrom: springForward,
      dateTo: springForward,
      config: { ...baseConfig, slotGranularityMin: 30 },
      serviceDurationMin: 30,
      now: zonedTimeToUtc(
        { year: 2026, month: 3, day: 25, hour: 12, minute: 0 },
        WARSAW,
      ),
    });
    // Okno 1:00-4:00 lokalnie to realnie 2 h (00:00Z-02:00Z): 4 sloty po 30 min.
    expect(
      result.merged.map((slot) => slot.startAt.toISOString()),
    ).toEqual([
      "2026-03-29T00:00:00.000Z",
      "2026-03-29T00:30:00.000Z",
      "2026-03-29T01:00:00.000Z",
      "2026-03-29T01:30:00.000Z",
    ]);
    // Ścienne etykiety: 2:00 i 2:30 nie istnieją.
    expect(mergedLabels(result)).toEqual(["01:00", "01:30", "03:00", "03:30"]);
  });

  it("29.03.2026 rano: 9:00 lokalnie to już 07:00Z (UTC+2)", () => {
    const sunday = resource({
      workingHours: [{ weekday: 6, startMinute: hhmm(9), endMinute: hhmm(17) }],
    });
    const springForward = { year: 2026, month: 3, day: 29 };
    const result = compute({
      resources: [sunday],
      dateFrom: springForward,
      dateTo: springForward,
      now: zonedTimeToUtc(
        { year: 2026, month: 3, day: 25, hour: 12, minute: 0 },
        WARSAW,
      ),
    });
    expect(result.merged[0].startAt.toISOString()).toBe(
      "2026-03-29T07:00:00.000Z",
    );
  });

  it("25.10.2026 (powrót 3:00→2:00): 9:00 lokalnie to 08:00Z (UTC+1)", () => {
    const sunday = resource({
      workingHours: [{ weekday: 6, startMinute: hhmm(9), endMinute: hhmm(17) }],
    });
    const fallBack = { year: 2026, month: 10, day: 25 };
    const result = compute({
      resources: [sunday],
      dateFrom: fallBack,
      dateTo: fallBack,
      config: { ...baseConfig, slotGranularityMin: 60 },
      serviceDurationMin: 60,
      now: zonedTimeToUtc(
        { year: 2026, month: 10, day: 20, hour: 12, minute: 0 },
        WARSAW,
      ),
    });
    expect(result.merged[0].startAt.toISOString()).toBe(
      "2026-10-25T08:00:00.000Z",
    );
    // Zwykłe okno 9-17 daje tyle samo slotów co w każdy inny dzień —
    // dodatkowa godzina doby leży poza grafikiem.
    expect(result.merged).toHaveLength(8);
  });

  it("25.10.2026 nocą: siatka nie dubluje godziny ściennej 2:00", () => {
    const night = resource({
      workingHours: [{ weekday: 6, startMinute: hhmm(1), endMinute: hhmm(4) }],
    });
    const fallBack = { year: 2026, month: 10, day: 25 };
    const result = compute({
      resources: [night],
      dateFrom: fallBack,
      dateTo: fallBack,
      config: { ...baseConfig, slotGranularityMin: 60 },
      serviceDurationMin: 60,
      now: zonedTimeToUtc(
        { year: 2026, month: 10, day: 20, hour: 12, minute: 0 },
        WARSAW,
      ),
    });
    // Okno 1:00-4:00 lokalnie trwa realnie 4 h, ale etykieta „2:00" występuje
    // na siatce raz — klient widzi jednoznaczne godziny.
    const labels = mergedLabels(result);
    expect(labels.filter((label) => label === "02:00")).toHaveLength(1);
    expect(labels).toEqual(["01:00", "02:00", "03:00"]);
    // Wszystkie instanty są unikalne.
    const instants = result.merged.map((slot) => slot.startAt.getTime());
    expect(new Set(instants).size).toBe(instants.length);
  });
});

describe("computeAvailability — widok scalony i nadpisania", () => {
  it("dedupe po starcie: wspólna godzina dwóch zasobów pojawia się raz", () => {
    const r1 = resource({ id: "r1" });
    const r2 = resource({
      id: "r2",
      workingHours: [{ weekday: 1, startMinute: hhmm(13), endMinute: hhmm(17) }],
    });
    const result = compute({
      resources: [r1, r2],
      config: { ...baseConfig, slotGranularityMin: 60 },
      serviceDurationMin: 60,
    });
    const at13 = result.merged.find(
      (slot) =>
        slot.startAt.getTime() ===
        zonedTimeToUtc({ ...DAY, hour: 13, minute: 0 }, WARSAW).getTime(),
    );
    expect(at13?.resourceIds.sort()).toEqual(["r1", "r2"]);
    const at9 = result.merged.find(
      (slot) =>
        slot.startAt.getTime() ===
        zonedTimeToUtc({ ...DAY, hour: 9, minute: 0 }, WARSAW).getTime(),
    );
    expect(at9?.resourceIds).toEqual(["r1"]);
    // Scalony widok nie ma duplikatów startów.
    const starts = result.merged.map((slot) => slot.startAt.getTime());
    expect(new Set(starts).size).toBe(starts.length);
  });

  it("durationMinOverride wydłuża usługę tylko u danego zasobu", () => {
    const junior = resource({ id: "junior", durationMinOverride: 60 });
    const senior = resource({ id: "senior" });
    const result = compute({
      resources: [senior, junior],
      config: { ...baseConfig, slotGranularityMin: 30 },
      serviceDurationMin: 30,
    });
    const seniorSlots = result.perResource.find(
      (entry) => entry.resourceId === "senior",
    )!.slots;
    const juniorSlots = result.perResource.find(
      (entry) => entry.resourceId === "junior",
    )!.slots;
    // Senior może zacząć 16:30 (koniec 17:00), junior najpóźniej 16:00.
    expect(wallLabels(seniorSlots.map((slot) => slot.startAt)).at(-1)).toBe(
      "16:30",
    );
    expect(wallLabels(juniorSlots.map((slot) => slot.startAt)).at(-1)).toBe(
      "16:00",
    );
    // Sloty juniora trwają 60 minut.
    expect(
      juniorSlots[0].endAt.getTime() - juniorSlots[0].startAt.getTime(),
    ).toBe(60 * 60_000);
  });
});

describe("pomocnicze funkcje kalendarza", () => {
  it("enumerateLocalDays zwraca zakres obustronnie domknięty", () => {
    const days = enumerateLocalDays(
      { year: 2026, month: 2, day: 27 },
      { year: 2026, month: 3, day: 2 },
    );
    expect(days).toHaveLength(4);
    expect(days[0]).toEqual({ year: 2026, month: 2, day: 27 });
    expect(days.at(-1)).toEqual({ year: 2026, month: 3, day: 2 });
  });

  it("isoDateToLocalDate waliduje format i sensowność daty", () => {
    expect(isoDateToLocalDate("2026-07-14")).toEqual(DAY);
    expect(isoDateToLocalDate("2026-02-31")).toBeNull();
    expect(isoDateToLocalDate("nie-data")).toBeNull();
    expect(localDateToIso(DAY)).toBe("2026-07-14");
  });
});
