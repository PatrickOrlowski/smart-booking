import { describe, expect, it } from "vitest";
import {
  computeTableAvailability,
  findTableSlotAt,
  turnTimeForPartySize,
  type ComputeTableAvailabilityInput,
  type ExistingTableItem,
  type TableAvailabilityResult,
  type TableInput,
} from "./table-availability";
import { zonedTimeToUtc } from "./time";

const WARSAW = "Europe/Warsaw";

/** Wtorek 14.07.2026 (weekday 1) — zwykły letni dzień bez zmiany czasu. */
const DAY = { year: 2026, month: 7, day: 14 };
/** „Teraz": tydzień wcześniej — lead time nie przycina wyników. */
const NOW = zonedTimeToUtc(
  { year: 2026, month: 7, day: 7, hour: 12, minute: 0 },
  WARSAW,
);

const hhmm = (h: number, m = 0) => h * 60 + m;

/** Instant UTC dla godziny ściennej w dniu testowym. */
const at = (hour: number, minute = 0, day = DAY) =>
  zonedTimeToUtc({ ...day, hour, minute }, WARSAW);

const TABLES: TableInput[] = [
  {
    id: "t2a",
    tableNumber: "1",
    roomId: "sala",
    area: "INDOOR",
    capacityMin: 2,
    capacityMax: 2,
    sortOrder: 1,
    isActive: true,
  },
  {
    id: "t2b",
    tableNumber: "2",
    roomId: "sala",
    area: "INDOOR",
    capacityMin: 2,
    capacityMax: 2,
    sortOrder: 2,
    isActive: true,
  },
  {
    id: "t4",
    tableNumber: "4",
    roomId: "sala",
    area: "INDOOR",
    capacityMin: 4,
    capacityMax: 4,
    sortOrder: 3,
    isActive: true,
  },
  {
    id: "t6",
    tableNumber: "9",
    roomId: "sala",
    area: "INDOOR",
    capacityMin: 4,
    capacityMax: 6,
    sortOrder: 4,
    isActive: true,
  },
  {
    id: "tOut",
    tableNumber: "T5",
    roomId: "taras",
    area: "OUTDOOR",
    capacityMin: 2,
    capacityMax: 4,
    sortOrder: 5,
    isActive: true,
  },
];

const COMBINATIONS = [
  {
    id: "c12",
    name: "1+2",
    capacityMin: 3,
    capacityMax: 4,
    isActive: true,
    tableIds: ["t2a", "t2b"],
  },
];

const TURN_TIMES = [
  { partySizeMin: 1, partySizeMax: 2, durationMin: 90 },
  { partySizeMin: 3, partySizeMax: 4, durationMin: 105 },
  { partySizeMin: 5, partySizeMax: 6, durationMin: 120 },
  { partySizeMin: 7, partySizeMax: 14, durationMin: 150 },
];

const compute = (
  overrides: Partial<ComputeTableAvailabilityInput> = {},
): TableAvailabilityResult =>
  computeTableAvailability({
    openingHours: [{ weekday: 1, startMinute: hhmm(12), endMinute: hhmm(22) }],
    tables: TABLES,
    combinations: COMBINATIONS,
    existingItems: [],
    holds: [],
    timeOffs: [],
    pacingRules: [],
    turnTimeRules: TURN_TIMES,
    defaultTurnTimeMin: 90,
    tableBufferMin: 15,
    slotGranularityMin: 15,
    minLeadTimeMin: 60,
    maxAdvanceDays: 60,
    day: DAY,
    timezone: WARSAW,
    partySize: 2,
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

const startLabels = (result: TableAvailabilityResult) =>
  wallLabels(result.slots.map((slot) => slot.startAt));

/** Rezerwacja na jednym stoliku: blokada = czas trwania + bufor sprzątania. */
const booking = (
  overrides: Partial<ExistingTableItem> = {},
): ExistingTableItem => ({
  bookingId: "b1",
  tableId: "t4",
  startAt: at(18),
  blockedStartAt: at(18),
  blockedEndAt: at(19, 45),
  partySize: 3,
  ...overrides,
});

/** Stolik zajęty przez cały dzień — wygodne przy testach doboru. */
const wholeDay = (tableId: string, bookingId = `blk-${tableId}`) =>
  booking({
    bookingId,
    tableId,
    startAt: at(12),
    blockedStartAt: at(12),
    blockedEndAt: at(22),
  });

// ---------------------------------------------------------------------------
// Turn time
// ---------------------------------------------------------------------------

describe("turn time zależny od liczby osób", () => {
  it("para siedzi 90 minut", () => {
    const result = compute({ partySize: 2 });
    expect(result.durationMin).toBe(90);
    expect(wallLabels([result.slots[0].endAt])).toEqual(["13:30"]);
  });

  it("granice zakresu 3–4 osoby dają 105 minut", () => {
    expect(compute({ partySize: 3 }).durationMin).toBe(105);
    expect(compute({ partySize: 4 }).durationMin).toBe(105);
  });

  it("piąta osoba przeskakuje do kolejnego zakresu (120 minut)", () => {
    expect(compute({ partySize: 5 }).durationMin).toBe(120);
    expect(compute({ partySize: 6 }).durationMin).toBe(120);
  });

  it("brak pasującej reguły → domyślny czas lokalu", () => {
    // Reguły kończą się na 14 osobach.
    const result = compute({ partySize: 20, defaultTurnTimeMin: 75 });
    expect(result.durationMin).toBe(75);
  });

  it("turnTimeForPartySize: pierwsza pasująca reguła wygrywa", () => {
    const overlapping = [
      { partySizeMin: 1, partySizeMax: 4, durationMin: 60 },
      { partySizeMin: 3, partySizeMax: 4, durationMin: 105 },
    ];
    expect(turnTimeForPartySize(overlapping, 4, 90)).toBe(60);
    expect(turnTimeForPartySize(overlapping, 5, 90)).toBe(90);
  });

  it("dłuższy turn time skraca listę godzin", () => {
    // Zamknięcie 22:00: para (90 min) zaczyna najpóźniej 20:30,
    // szóstka (120 min) już tylko 20:00.
    expect(startLabels(compute({ partySize: 2 })).at(-1)).toBe("20:30");
    expect(startLabels(compute({ partySize: 6 })).at(-1)).toBe("20:00");
  });
});

// ---------------------------------------------------------------------------
// Dobór stolika
// ---------------------------------------------------------------------------

describe("dobór stolika", () => {
  it("para dostaje najmniejszy pasujący stolik, nie stół dla sześciu", () => {
    const result = compute({ partySize: 2 });
    expect(result.slots[0].tableIds).toEqual(["t2a"]);
    expect(result.slots[0].label).toBe("Stolik 1");
  });

  it("przy równej pojemności decyduje sortOrder", () => {
    const result = compute({ partySize: 2, existingItems: [wholeDay("t2a")] });
    expect(result.slots[0].tableIds).toEqual(["t2b"]);
  });

  it("czwórka nie zajmuje stołu dla sześciu, gdy jest stolik na cztery", () => {
    const result = compute({ partySize: 4 });
    expect(result.slots[0].tableIds).toEqual(["t4"]);
  });

  it("gdy mniejsze stoliki są zajęte, schodzimy na większy", () => {
    const result = compute({
      partySize: 4,
      existingItems: [wholeDay("t4"), wholeDay("tOut")],
    });
    expect(result.slots[0].tableIds).toEqual(["t6"]);
  });

  it("nieaktywny stolik nie jest kandydatem", () => {
    const result = compute({
      partySize: 2,
      tables: TABLES.map((table) =>
        table.id === "t2a" || table.id === "t2b"
          ? { ...table, isActive: false }
          : table,
      ),
    });
    expect(result.slots[0].tableIds).toEqual(["tOut"]);
  });

  it("brak stolika o wystarczającej pojemności → brak slotów", () => {
    const result = compute({ partySize: 10 });
    // Czas trwania i tak policzony (reguła 7–14 osób).
    expect(result.durationMin).toBe(150);
    expect(result.slots).toHaveLength(0);
  });

  it("partySize < 1 nie generuje slotów", () => {
    expect(compute({ partySize: 0 }).slots).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Zestawienia stolików
// ---------------------------------------------------------------------------

describe("zestawienia stolików", () => {
  it("pojedynczy stolik ma pierwszeństwo przed zestawieniem", () => {
    const result = compute({ partySize: 3 });
    // Taras 2–4 obsłuży trójkę bez zestawiania stolików.
    expect(result.slots[0].tableIds).toEqual(["tOut"]);
    expect(result.slots[0].combinationId).toBeUndefined();
  });

  it("gdy żaden pojedynczy stolik nie pasuje, wchodzi zestawienie", () => {
    const result = compute({
      partySize: 3,
      existingItems: [wholeDay("tOut")],
    });
    expect(result.slots[0].tableIds).toEqual(["t2a", "t2b"]);
    expect(result.slots[0].combinationId).toBe("c12");
    expect(result.slots[0].label).toBe("Stoliki 1+2");
  });

  it("zestawienie odpada, gdy zajęty jest choć jeden stolik członkowski", () => {
    const result = compute({
      partySize: 3,
      existingItems: [wholeDay("tOut"), wholeDay("t2b")],
    });
    expect(result.slots).toHaveLength(0);
  });

  it("nieaktywne zestawienie nie jest kandydatem", () => {
    const result = compute({
      partySize: 3,
      existingItems: [wholeDay("tOut")],
      combinations: COMBINATIONS.map((c) => ({ ...c, isActive: false })),
    });
    expect(result.slots).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Zajętość, bufor sprzątania, urlopy, holdy
// ---------------------------------------------------------------------------

describe("zajętość stolika", () => {
  const singleTable = TABLES.filter((table) => table.id === "t2a");

  it("stolik jest wolny dopiero po buforze sprzątania", () => {
    const labels = startLabels(
      compute({
        tables: singleTable,
        combinations: [],
        // 18:00–19:30 + 15 min na sprzątanie.
        existingItems: [booking({ tableId: "t2a" })],
      }),
    );
    expect(labels).not.toContain("18:00");
    expect(labels).not.toContain("19:30");
    // 19:45 = koniec rezerwacji + bufor.
    expect(labels).toContain("19:45");
    // Rezerwacja przed zajętym oknem musi zmieścić się z własnym buforem:
    // 16:15 + 90 min + 15 min = 18:00, ale 16:30 już wchodzi w cudzy stolik.
    expect(labels).toContain("16:15");
    expect(labels).not.toContain("16:30");
  });

  it("bufor 0 pozwala usiąść zaraz po poprzednich gościach", () => {
    const labels = startLabels(
      compute({
        tables: singleTable,
        combinations: [],
        tableBufferMin: 0,
        existingItems: [
          booking({ tableId: "t2a", blockedEndAt: at(19, 30) }),
        ],
      }),
    );
    expect(labels).toContain("19:30");
    expect(labels).toContain("16:30");
  });

  it("aktywny hold blokuje stolik, wygasły nie", () => {
    const holdInput = {
      tableId: "t2a",
      startAt: at(18),
      endAt: at(19, 45),
    };
    const blocked = compute({
      tables: singleTable,
      combinations: [],
      holds: [{ ...holdInput, expiresAt: new Date(NOW.getTime() + 60_000) }],
    });
    const free = compute({
      tables: singleTable,
      combinations: [],
      holds: [{ ...holdInput, expiresAt: new Date(NOW.getTime() - 1) }],
    });
    expect(startLabels(blocked)).not.toContain("18:00");
    expect(startLabels(free)).toContain("18:00");
  });

  it("urlop stolika blokuje tylko ten stolik", () => {
    const result = compute({
      partySize: 2,
      timeOffs: [{ tableId: "t2a", startAt: at(12), endAt: at(22) }],
    });
    expect(result.slots[0].tableIds).toEqual(["t2b"]);
  });

  it("blokada całej lokalizacji zdejmuje wszystkie sloty", () => {
    const result = compute({
      timeOffs: [{ tableId: null, startAt: at(12), endAt: at(22) }],
    });
    expect(result.slots).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Godziny otwarcia, lead time, horyzont
// ---------------------------------------------------------------------------

describe("godziny otwarcia i horyzont", () => {
  it("rezerwacja musi zmieścić się w całości do zamknięcia", () => {
    const result = compute({ partySize: 2 });
    const last = result.slots.at(-1);
    expect(wallLabels([last!.startAt, last!.endAt])).toEqual([
      "20:30",
      "22:00",
    ]);
    // Bufor sprzątania może wyjść poza zamknięcie — sprząta obsługa.
    expect(wallLabels([last!.blockedEndAt])).toEqual(["22:15"]);
  });

  it("dzień, w którym lokal jest zamknięty, nie ma slotów", () => {
    // Grafik tylko na wtorek — niedziela 19.07.2026 jest zamknięta.
    const result = compute({ day: { year: 2026, month: 7, day: 19 } });
    expect(result.slots).toHaveLength(0);
  });

  it("przerwa w godzinach otwarcia rozbija dzień na dwa okna", () => {
    const labels = startLabels(
      compute({
        openingHours: [
          { weekday: 1, startMinute: hhmm(12), endMinute: hhmm(15) },
          { weekday: 1, startMinute: hhmm(18), endMinute: hhmm(22) },
        ],
      }),
    );
    // 90 min musi zmieścić się w jednym oknie: przed przerwą do 13:30.
    expect(labels).toContain("13:30");
    expect(labels).not.toContain("13:45");
    expect(labels).toContain("18:00");
  });

  it("lead time obcina najbliższe godziny", () => {
    const labels = startLabels(
      compute({
        now: at(17),
        minLeadTimeMin: 60,
      }),
    );
    expect(labels[0]).toBe("18:00");
  });

  it("dzień poza horyzontem rezerwacji nie ma slotów", () => {
    const result = compute({ maxAdvanceDays: 3 });
    expect(result.slots).toHaveLength(0);
  });

  it("sloty są w UTC: 12:00 czasu letniego = 10:00Z", () => {
    expect(compute().slots[0].startAt.toISOString()).toBe(
      "2026-07-14T10:00:00.000Z",
    );
  });
});

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

describe("pacing", () => {
  const peak = {
    weekday: null,
    startMinute: hhmm(18),
    endMinute: hhmm(21),
    intervalMin: 15,
    maxCovers: 4,
    maxBookings: null,
  };

  it("odcina slot, gdy dołożenie gości przekracza maxCovers", () => {
    const labels = startLabels(
      compute({
        partySize: 2,
        pacingRules: [peak],
        // Trójka o 18:00 — z parą byłoby 5 osób przy limicie 4.
        existingItems: [booking({ startAt: at(18), partySize: 3 })],
      }),
    );
    expect(labels).not.toContain("18:00");
    // Kolejny kwadrans ma własny limit.
    expect(labels).toContain("18:15");
    // Poza oknem reguły pacing nie obowiązuje.
    expect(labels).toContain("17:45");
  });

  it("reguła z weekday = null obowiązuje codziennie", () => {
    const items = [booking({ startAt: at(18), partySize: 3 })];
    const daily = compute({ pacingRules: [peak], existingItems: items });
    // Ta sama reguła przypięta do soboty nie dotyczy wtorku.
    const saturdayOnly = compute({
      pacingRules: [{ ...peak, weekday: 5 }],
      existingItems: items,
    });
    expect(startLabels(daily)).not.toContain("18:00");
    expect(startLabels(saturdayOnly)).toContain("18:00");
  });

  it("gdy pasuje kilka reguł, obowiązuje najostrzejsza", () => {
    const items = [booking({ startAt: at(18), partySize: 3 })];
    const loose = compute({
      pacingRules: [{ ...peak, maxCovers: 10 }],
      existingItems: items,
    });
    const withStrict = compute({
      pacingRules: [
        { ...peak, maxCovers: 10 },
        { ...peak, weekday: 1, maxCovers: 4 },
      ],
      existingItems: items,
    });
    expect(startLabels(loose)).toContain("18:00");
    expect(startLabels(withStrict)).not.toContain("18:00");
  });

  it("maxBookings ogranicza liczbę rezerwacji niezależnie od miejsc", () => {
    const labels = startLabels(
      compute({
        pacingRules: [
          { ...peak, maxCovers: null, maxBookings: 1 },
        ],
        existingItems: [booking({ startAt: at(18), partySize: 1 })],
      }),
    );
    expect(labels).not.toContain("18:00");
    expect(labels).toContain("18:15");
  });

  it("rezerwacja na zestawieniu liczy się do pacingu raz", () => {
    const labels = startLabels(
      compute({
        partySize: 2,
        pacingRules: [{ ...peak, maxCovers: 5 }],
        existingItems: [
          booking({ bookingId: "combo", tableId: "t2a", partySize: 3 }),
          booking({ bookingId: "combo", tableId: "t2b", partySize: 3 }),
        ],
      }),
    );
    // 3 (jedna rezerwacja) + 2 = 5 ≤ 5. Przy podwójnym liczeniu byłoby 8.
    expect(labels).toContain("18:00");
  });

  it("przedziały pacingu są liczone od początku okna reguły", () => {
    const labels = startLabels(
      compute({
        partySize: 2,
        pacingRules: [
          { ...peak, intervalMin: 30, maxCovers: 4 },
        ],
        existingItems: [booking({ startAt: at(18), partySize: 3 })],
      }),
    );
    // Przedział 18:00–18:30 jest wspólny dla obu startów.
    expect(labels).not.toContain("18:00");
    expect(labels).not.toContain("18:15");
    expect(labels).toContain("18:30");
  });
});

// ---------------------------------------------------------------------------
// Strefy
// ---------------------------------------------------------------------------

describe("preferencja strefy", () => {
  it("OUTDOOR zwraca wyłącznie stoliki na tarasie", () => {
    const result = compute({ partySize: 2, areaPreference: "OUTDOOR" });
    expect(result.slots.every((slot) => slot.area === "OUTDOOR")).toBe(true);
    expect(result.slots[0].tableIds).toEqual(["tOut"]);
  });

  it("INDOOR nie proponuje tarasu", () => {
    const result = compute({ partySize: 2, areaPreference: "INDOOR" });
    expect(
      result.slots.every((slot) => !slot.tableIds.includes("tOut")),
    ).toBe(true);
  });

  it("strefa bez stolików dla tej liczby osób → brak slotów", () => {
    expect(compute({ partySize: 2, areaPreference: "BAR" }).slots).toHaveLength(
      0,
    );
  });

  it("zestawienie działa wewnątrz wybranej strefy", () => {
    // Trójka w sali: żaden pojedynczy stolik nie pasuje, zestawienie 1+2 tak.
    const result = compute({ partySize: 3, areaPreference: "INDOOR" });
    expect(result.slots[0].combinationId).toBe("c12");
    expect(result.slots[0].area).toBe("INDOOR");
  });

  it("zestawienie spoza strefy jest pomijane", () => {
    const result = compute({ partySize: 3, areaPreference: "OUTDOOR" });
    // Na tarasie trójkę obsłuży tylko pojedynczy T5.
    expect(result.slots[0].tableIds).toEqual(["tOut"]);
    const busyTerrace = compute({
      partySize: 3,
      areaPreference: "OUTDOOR",
      existingItems: [wholeDay("tOut")],
    });
    expect(busyTerrace.slots).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rewalidacja slotu (restrictTo / findTableSlotAt)
// ---------------------------------------------------------------------------

describe("rewalidacja konkretnego stolika", () => {
  it("restrictTo zawęża do wskazanego stolika", () => {
    const result = compute({
      partySize: 2,
      restrictTo: { tableIds: ["t2b"] },
    });
    expect(result.slots.every((slot) => slot.tableIds[0] === "t2b")).toBe(true);
  });

  it("restrictTo na zajęty stolik nie zwraca nic", () => {
    const result = compute({
      partySize: 2,
      restrictTo: { tableIds: ["t2b"] },
      existingItems: [wholeDay("t2b")],
    });
    expect(result.slots).toHaveLength(0);
  });

  it("restrictTo po zestawieniu zwraca komplet stolików", () => {
    const result = compute({
      partySize: 3,
      restrictTo: { combinationId: "c12" },
    });
    expect(result.slots[0].tableIds).toEqual(["t2a", "t2b"]);
  });

  it("findTableSlotAt trafia w konkretny start albo zwraca null", () => {
    const input: ComputeTableAvailabilityInput = {
      openingHours: [{ weekday: 1, startMinute: hhmm(12), endMinute: hhmm(22) }],
      tables: TABLES,
      combinations: COMBINATIONS,
      existingItems: [],
      holds: [],
      timeOffs: [],
      pacingRules: [],
      turnTimeRules: TURN_TIMES,
      defaultTurnTimeMin: 90,
      tableBufferMin: 15,
      slotGranularityMin: 15,
      minLeadTimeMin: 60,
      maxAdvanceDays: 60,
      day: DAY,
      timezone: WARSAW,
      partySize: 2,
      now: NOW,
    };
    expect(findTableSlotAt(input, at(19))?.tableIds).toEqual(["t2a"]);
    // 19:07 nie leży na siatce co 15 minut.
    expect(findTableSlotAt(input, at(19, 7))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Zmiana czasu (DST)
// ---------------------------------------------------------------------------

describe("zmiana czasu", () => {
  const dstTables: TableInput[] = [
    {
      id: "t",
      tableNumber: "1",
      roomId: null,
      area: "INDOOR",
      capacityMin: 1,
      capacityMax: 4,
      sortOrder: 1,
      isActive: true,
    },
  ];

  /** Lokal nocny: otwarte 0:00–6:00 w niedzielę (weekday 6), sloty co godzinę. */
  const dstCompute = (day: { year: number; month: number; day: number }, now: Date) =>
    computeTableAvailability({
      openingHours: [{ weekday: 6, startMinute: 0, endMinute: hhmm(6) }],
      tables: dstTables,
      combinations: [],
      existingItems: [],
      holds: [],
      timeOffs: [],
      pacingRules: [],
      turnTimeRules: [],
      defaultTurnTimeMin: 60,
      tableBufferMin: 0,
      slotGranularityMin: 60,
      minLeadTimeMin: 60,
      maxAdvanceDays: 60,
      day,
      timezone: WARSAW,
      partySize: 2,
      now,
    });

  it("29.03.2026 — doba 23-godzinna, godzina 2:00 nie istnieje", () => {
    const result = dstCompute(
      { year: 2026, month: 3, day: 29 },
      zonedTimeToUtc(
        { year: 2026, month: 3, day: 20, hour: 12, minute: 0 },
        WARSAW,
      ),
    );
    expect(wallLabels(result.slots.map((slot) => slot.startAt))).toEqual([
      "00:00",
      "01:00",
      "03:00",
      "04:00",
      "05:00",
    ]);
    // Północ czasu zimowego to 23:00Z dnia poprzedniego.
    expect(result.slots[0].startAt.toISOString()).toBe(
      "2026-03-28T23:00:00.000Z",
    );
    // Ostatnia rezerwacja kończy się równo z zamknięciem (6:00 = 04:00Z).
    expect(result.slots.at(-1)!.endAt.toISOString()).toBe(
      "2026-03-29T04:00:00.000Z",
    );
  });

  it("25.10.2026 — doba 25-godzinna mieści slot więcej", () => {
    const result = dstCompute(
      { year: 2026, month: 10, day: 25 },
      zonedTimeToUtc(
        { year: 2026, month: 10, day: 18, hour: 12, minute: 0 },
        WARSAW,
      ),
    );
    expect(wallLabels(result.slots.map((slot) => slot.startAt))).toEqual([
      "00:00",
      "01:00",
      "02:00",
      "03:00",
      "04:00",
      "05:00",
    ]);
    expect(result.slots[0].startAt.toISOString()).toBe(
      "2026-10-24T22:00:00.000Z",
    );
    // Godzina 2:00 wypada dwa razy; siatka czasu ściennego wskazuje tę drugą
    // (01:00Z), więc pierwsza (00:00Z) nie ma slotu.
    const instants = result.slots.map((slot) => slot.startAt.toISOString());
    expect(instants).toContain("2026-10-25T01:00:00.000Z");
    expect(instants).not.toContain("2026-10-25T00:00:00.000Z");
  });

  it("ten sam lokal ma zimą inny offset UTC niż latem", () => {
    const winter = computeTableAvailability({
      openingHours: [{ weekday: 1, startMinute: hhmm(12), endMinute: hhmm(22) }],
      tables: dstTables,
      combinations: [],
      existingItems: [],
      holds: [],
      timeOffs: [],
      pacingRules: [],
      turnTimeRules: TURN_TIMES,
      defaultTurnTimeMin: 90,
      tableBufferMin: 15,
      slotGranularityMin: 15,
      minLeadTimeMin: 60,
      maxAdvanceDays: 60,
      day: { year: 2027, month: 1, day: 12 },
      timezone: WARSAW,
      partySize: 2,
      now: zonedTimeToUtc(
        { year: 2027, month: 1, day: 5, hour: 12, minute: 0 },
        WARSAW,
      ),
    });
    // 12:00 czasu zimowego = 11:00Z (latem 10:00Z).
    expect(winter.slots[0].startAt.toISOString()).toBe(
      "2027-01-12T11:00:00.000Z",
    );
  });
});
