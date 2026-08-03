import type {
  RestaurantArea,
  TableShape,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  addLocalDays,
  enumerateLocalDays,
  localDateToIso,
  type LocalDate,
} from "@/lib/availability";
import {
  computeTableAvailability,
  turnTimeForPartySize,
  type ExistingTableItem,
  type TableCombinationInput,
  type TableHoldInput,
  type TableInput,
  type TableSlot,
  type TableTimeOffInput,
} from "@/lib/table-availability";
import { localDayMinutesToUtc, utcToZonedWallClock } from "@/lib/time";

/**
 * Warstwa danych silnika stolików: pobiera z Prismy komplet wejścia dla
 * czystej funkcji `computeTableAvailability` i skleja wynik.
 *
 * Kształt zapytań jest podporządkowany jednemu celowi — braku N+1: cała
 * konfiguracja lokalu (sale, stoliki, zestawienia, turn time, pacing) idzie
 * jednym zapytaniem, a zajętość CAŁEGO zakresu dni trzema równoległymi.
 * Liczenie kolejnych dni nie dokłada już żadnego zapytania.
 */

export type RestaurantTable = TableInput & {
  name: string;
  shape: TableShape | null;
  posX: number | null;
  posY: number | null;
  spanX: number | null;
  spanY: number | null;
  combinable: boolean;
};

export type RestaurantRoom = {
  id: string;
  name: string;
  sortOrder: number;
  gridWidth: number;
  gridHeight: number;
  tables: RestaurantTable[];
};

export type RestaurantContext = {
  business: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
  };
  location: {
    id: string;
    name: string;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    postalCode: string;
    phone: string | null;
    latitude: number | null;
    longitude: number | null;
    timezone: string;
    slotGranularityMin: number;
    minLeadTimeMin: number;
    maxAdvanceDays: number;
    cancellationCutoffHours: number;
    maxPartySizeOnline: number | null;
    waitlistEnabled: boolean;
    defaultTurnTimeMin: number;
    tableBufferMin: number;
    openingHours: { weekday: number; startMinute: number; endMinute: number }[];
  };
  /** Syntetyczna usługa kind = TABLE_RESERVATION — nośnik rezerwacji stolika. */
  service: { id: string; name: string; currency: string };
  rooms: RestaurantRoom[];
  tables: RestaurantTable[];
  combinations: TableCombinationInput[];
  turnTimeRules: {
    partySizeMin: number;
    partySizeMax: number;
    durationMin: number;
  }[];
  pacingRules: {
    weekday: number | null;
    startMinute: number;
    endMinute: number;
    intervalMin: number;
    maxCovers: number | null;
    maxBookings: number | null;
  }[];
  /** Strefy, w których faktycznie stoją stoliki — filtr dla klienta. */
  areas: RestaurantArea[];
  /** Największa grupa, jaką lokal fizycznie posadzi (stolik lub zestawienie). */
  maxPartySizeSeatable: number;
  /**
   * Najmniejsza grupa, jaką lokal fizycznie posadzi (najniższe `capacityMin`).
   * Lokal z samymi stolikami „od 2 osób" nie sadza pojedynczych gości —
   * bez tego pola silnik zwracał zero slotów, a UI kłamał, że jest komplet.
   */
  minPartySizeSeatable: number;
};

const AREA_ORDER: RestaurantArea[] = ["INDOOR", "OUTDOOR", "BAR", "PRIVATE"];

/**
 * Konfiguracja restauracji po slugu firmy. Zwraca null, gdy firma nie jest
 * aktywną restauracją, nie ma czynnej lokalizacji albo brakuje jej usługi
 * technicznej „rezerwacja stolika".
 */
export async function getRestaurantLocation(
  slug: string,
): Promise<RestaurantContext | null> {
  const business = await prisma.business.findFirst({
    where: { slug, status: "ACTIVE", type: "RESTAURANT" },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      services: {
        where: { kind: "TABLE_RESERVATION", isActive: true },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { id: true, name: true, currency: true },
      },
      locations: {
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          id: true,
          name: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          postalCode: true,
          phone: true,
          latitude: true,
          longitude: true,
          timezone: true,
          slotGranularityMin: true,
          minLeadTimeMin: true,
          maxAdvanceDays: true,
          cancellationCutoffHours: true,
          maxPartySizeOnline: true,
          waitlistEnabled: true,
          defaultTurnTimeMin: true,
          tableBufferMin: true,
          openingHours: {
            orderBy: { weekday: "asc" },
            select: { weekday: true, startMinute: true, endMinute: true },
          },
          rooms: {
            where: { isActive: true },
            orderBy: { sortOrder: "asc" },
            select: {
              id: true,
              name: true,
              sortOrder: true,
              gridWidth: true,
              gridHeight: true,
            },
          },
          resources: {
            where: { type: "TABLE", isActive: true },
            orderBy: { sortOrder: "asc" },
            select: {
              id: true,
              name: true,
              tableNumber: true,
              roomId: true,
              area: true,
              shape: true,
              capacityMin: true,
              capacityMax: true,
              posX: true,
              posY: true,
              spanX: true,
              spanY: true,
              combinable: true,
              sortOrder: true,
              isActive: true,
            },
          },
          combinations: {
            where: { isActive: true },
            orderBy: { capacityMin: "asc" },
            select: {
              id: true,
              name: true,
              capacityMin: true,
              capacityMax: true,
              isActive: true,
              members: { select: { resourceId: true } },
            },
          },
          turnTimeRules: {
            orderBy: { partySizeMin: "asc" },
            select: {
              partySizeMin: true,
              partySizeMax: true,
              durationMin: true,
            },
          },
          pacingRules: {
            orderBy: { startMinute: "asc" },
            select: {
              weekday: true,
              startMinute: true,
              endMinute: true,
              intervalMin: true,
              maxCovers: true,
              maxBookings: true,
            },
          },
        },
      },
    },
  });

  const location = business?.locations[0];
  const service = business?.services[0];
  if (!business || !location || !service) return null;

  const tables: RestaurantTable[] = location.resources.map((resource) => {
    // capacityMin/Max są w schemacie opcjonalne (pracownicy ich nie mają) —
    // dla stolika bez pojemności przyjmujemy „jedna osoba", żeby nie sadzać
    // przy nim przypadkiem całej grupy.
    const capacityMin = resource.capacityMin ?? 1;
    return {
      id: resource.id,
      name: resource.name,
      tableNumber: resource.tableNumber,
      roomId: resource.roomId,
      area: resource.area,
      shape: resource.shape,
      capacityMin,
      capacityMax: resource.capacityMax ?? capacityMin,
      posX: resource.posX,
      posY: resource.posY,
      spanX: resource.spanX,
      spanY: resource.spanY,
      combinable: resource.combinable,
      sortOrder: resource.sortOrder,
      isActive: resource.isActive,
    };
  });

  const tableIds = new Set(tables.map((table) => table.id));
  const combinations: TableCombinationInput[] = location.combinations
    .map((combination) => ({
      id: combination.id,
      name: combination.name,
      capacityMin: combination.capacityMin,
      capacityMax: combination.capacityMax,
      isActive: combination.isActive,
      tableIds: combination.members.map((member) => member.resourceId),
    }))
    // Zestawienie z nieaktywnym (albo skasowanym) stolikiem jest bezużyteczne.
    .filter(
      (combination) =>
        combination.tableIds.length > 0 &&
        combination.tableIds.every((id) => tableIds.has(id)),
    );

  const rooms: RestaurantRoom[] = location.rooms.map((room) => ({
    ...room,
    tables: tables.filter((table) => table.roomId === room.id),
  }));

  const areas = AREA_ORDER.filter((area) =>
    tables.some((table) => table.area === area),
  );

  const maxPartySizeSeatable = Math.max(
    0,
    ...tables.map((table) => table.capacityMax),
    ...combinations.map((combination) => combination.capacityMax),
  );
  // Lokal bez stolików nie ma dolnej granicy do pokazania — zostaje 1,
  // a i tak nie znajdzie żadnego slotu.
  const minPartySizeSeatable =
    tables.length === 0
      ? 1
      : Math.min(...tables.map((table) => table.capacityMin));

  return {
    business: {
      id: business.id,
      slug: business.slug,
      name: business.name,
      description: business.description,
    },
    location: {
      id: location.id,
      name: location.name,
      addressLine1: location.addressLine1,
      addressLine2: location.addressLine2,
      city: location.city,
      postalCode: location.postalCode,
      phone: location.phone,
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: location.timezone,
      slotGranularityMin: location.slotGranularityMin,
      minLeadTimeMin: location.minLeadTimeMin,
      maxAdvanceDays: location.maxAdvanceDays,
      cancellationCutoffHours: location.cancellationCutoffHours,
      maxPartySizeOnline: location.maxPartySizeOnline,
      waitlistEnabled: location.waitlistEnabled,
      defaultTurnTimeMin: location.defaultTurnTimeMin,
      tableBufferMin: location.tableBufferMin,
      openingHours: location.openingHours,
    },
    service,
    rooms,
    tables,
    combinations,
    turnTimeRules: location.turnTimeRules,
    pacingRules: location.pacingRules,
    areas,
    maxPartySizeSeatable,
    minPartySizeSeatable,
  };
}

// ---------------------------------------------------------------------------
// Zajętość
// ---------------------------------------------------------------------------

type Occupancy = {
  existingItems: ExistingTableItem[];
  holds: TableHoldInput[];
  timeOffs: TableTimeOffInput[];
};

/**
 * Zajętość stolików w zakresie [rangeStart, rangeEnd): pozycje rezerwacji
 * (mają już bufor sprzątania w blockedStartAt/blockedEndAt), aktywne holdy
 * i urlopy — trzy zapytania niezależnie od liczby dni i stolików.
 */
async function loadOccupancy(options: {
  context: RestaurantContext;
  rangeStart: Date;
  rangeEnd: Date;
  now: Date;
  ignoreHoldToken?: string;
  ignoreBookingId?: string;
}): Promise<Occupancy> {
  const tableIds = options.context.tables.map((table) => table.id);
  if (tableIds.length === 0) {
    return { existingItems: [], holds: [], timeOffs: [] };
  }

  const [items, holds, timeOffs] = await Promise.all([
    prisma.bookingItem.findMany({
      where: {
        resourceId: { in: tableIds },
        isBlocking: true,
        blockedStartAt: { lt: options.rangeEnd },
        blockedEndAt: { gt: options.rangeStart },
        ...(options.ignoreBookingId
          ? { bookingId: { not: options.ignoreBookingId } }
          : {}),
      },
      select: {
        bookingId: true,
        resourceId: true,
        startAt: true,
        blockedStartAt: true,
        blockedEndAt: true,
        booking: { select: { partySize: true } },
      },
    }),
    prisma.hold.findMany({
      where: {
        resourceId: { in: tableIds },
        // Wygasłe holdy nie blokują sali, nawet zanim je posprzątamy.
        expiresAt: { gt: options.now },
        startAt: { lt: options.rangeEnd },
        endAt: { gt: options.rangeStart },
        ...(options.ignoreHoldToken
          ? { token: { not: options.ignoreHoldToken } }
          : {}),
      },
      select: { resourceId: true, startAt: true, endAt: true, expiresAt: true },
    }),
    prisma.timeOff.findMany({
      where: {
        OR: [
          { resourceId: { in: tableIds } },
          { locationId: options.context.location.id },
        ],
        startAt: { lt: options.rangeEnd },
        endAt: { gt: options.rangeStart },
      },
      select: { resourceId: true, startAt: true, endAt: true },
    }),
  ]);

  return {
    existingItems: items.map((item) => ({
      bookingId: item.bookingId,
      tableId: item.resourceId,
      startAt: item.startAt,
      blockedStartAt: item.blockedStartAt,
      blockedEndAt: item.blockedEndAt,
      partySize: item.booking.partySize,
    })),
    holds: holds.map((hold) => ({
      tableId: hold.resourceId,
      startAt: hold.startAt,
      endAt: hold.endAt,
      expiresAt: hold.expiresAt,
    })),
    timeOffs: timeOffs.map((off) => ({
      tableId: off.resourceId,
      startAt: off.startAt,
      endAt: off.endAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// Dostępność
// ---------------------------------------------------------------------------

export type TableAvailabilityDay = {
  /** Dzień lokalny lokalu (YYYY-MM-DD). */
  date: string;
  durationMin: number;
  slots: TableSlot[];
};

export type TableAvailabilityRange = {
  context: RestaurantContext;
  partySize: number;
  days: TableAvailabilityDay[];
};

export type TableAvailabilityQuery = {
  slug: string;
  partySize: number;
  area?: RestaurantArea | null;
  now?: Date;
  /** Pozwala uniknąć drugiego zapytania, gdy kontekst jest już załadowany. */
  context?: RestaurantContext;
  /** Hold pomijany przy liczeniu zajętości (własna blokada checkoutu). */
  ignoreHoldToken?: string;
  /** Rezerwacja pomijana przy liczeniu zajętości (zmiana terminu). */
  ignoreBookingId?: string;
  /** Zawężenie do wskazanego stolika/zestawienia (rewalidacja przy zapisie). */
  restrictTo?: { tableIds?: string[]; combinationId?: string } | null;
};

/** Dostępność stolików w zakresie dni lokalnych (obustronnie domkniętym). */
export async function getTableAvailabilityRange(
  options: TableAvailabilityQuery & { dateFrom: LocalDate; dateTo: LocalDate },
): Promise<TableAvailabilityRange | null> {
  const now = options.now ?? new Date();
  const context =
    options.context ?? (await getRestaurantLocation(options.slug));
  if (!context) return null;

  const timezone = context.location.timezone;
  const days = enumerateLocalDays(options.dateFrom, options.dateTo);
  if (days.length === 0) {
    return { context, partySize: options.partySize, days: [] };
  }

  // Zapas jednego dnia z każdej strony: rezerwacja z poprzedniego wieczoru
  // potrafi zachodzić na dobę następną (turn time + bufor).
  const occupancy = await loadOccupancy({
    context,
    rangeStart: localDayMinutesToUtc(
      addLocalDays(options.dateFrom, -1),
      0,
      timezone,
    ),
    rangeEnd: localDayMinutesToUtc(
      addLocalDays(options.dateTo, 2),
      0,
      timezone,
    ),
    now,
    ignoreHoldToken: options.ignoreHoldToken,
    ignoreBookingId: options.ignoreBookingId,
  });

  return {
    context,
    partySize: options.partySize,
    days: days.map((day) => {
      const result = computeTableAvailability({
        openingHours: context.location.openingHours,
        tables: context.tables,
        combinations: context.combinations,
        existingItems: occupancy.existingItems,
        holds: occupancy.holds,
        timeOffs: occupancy.timeOffs,
        pacingRules: context.pacingRules,
        turnTimeRules: context.turnTimeRules,
        defaultTurnTimeMin: context.location.defaultTurnTimeMin,
        tableBufferMin: context.location.tableBufferMin,
        slotGranularityMin: context.location.slotGranularityMin,
        minLeadTimeMin: context.location.minLeadTimeMin,
        maxAdvanceDays: context.location.maxAdvanceDays,
        day,
        timezone,
        partySize: options.partySize,
        areaPreference: options.area ?? null,
        restrictTo: options.restrictTo ?? null,
        now,
      });
      return {
        date: localDateToIso(day),
        durationMin: result.durationMin,
        slots: result.slots,
      };
    }),
  };
}

export type TableAvailabilityDayResult = {
  context: RestaurantContext;
  date: string;
  durationMin: number;
  slots: TableSlot[];
};

/** Dostępność stolików w jednym dniu lokalnym. */
export async function getTableAvailabilityForDay(
  options: TableAvailabilityQuery & { date: LocalDate },
): Promise<TableAvailabilityDayResult | null> {
  const range = await getTableAvailabilityRange({
    ...options,
    dateFrom: options.date,
    dateTo: options.date,
  });
  if (!range) return null;
  const day = range.days[0];
  return {
    context: range.context,
    date: day.date,
    durationMin: day.durationMin,
    slots: day.slots,
  };
}

/**
 * Rewalidacja pojedynczego terminu tuż przed zapisem rezerwacji: liczy dzień
 * lokalny, w którym wypada start, i szuka slotu o dokładnie tej godzinie.
 * `tableIds`/`combinationId` zawężają wynik do wskazanego stolika.
 */
export async function resolveTableSlot(options: {
  slug: string;
  startAt: Date;
  partySize: number;
  tableIds?: string[];
  combinationId?: string;
  area?: RestaurantArea | null;
  now?: Date;
  context?: RestaurantContext;
  ignoreHoldToken?: string;
  ignoreBookingId?: string;
}): Promise<{ context: RestaurantContext; slot: TableSlot } | null> {
  const now = options.now ?? new Date();
  const context =
    options.context ?? (await getRestaurantLocation(options.slug));
  if (!context) return null;

  const wall = utcToZonedWallClock(options.startAt, context.location.timezone);
  const day: LocalDate = { year: wall.year, month: wall.month, day: wall.day };

  // Wskazany stolik idzie do silnika jako zawężenie kandydatów — inaczej
  // dostalibyśmy tylko stolik dobrany automatycznie i odrzucili poprawny
  // wybór gościa (np. konkretny stolik na tarasie).
  const restrictTo =
    options.combinationId || (options.tableIds && options.tableIds.length > 0)
      ? {
          ...(options.combinationId
            ? { combinationId: options.combinationId }
            : {}),
          ...(options.tableIds ? { tableIds: options.tableIds } : {}),
        }
      : null;

  const range = await getTableAvailabilityRange({
    slug: options.slug,
    dateFrom: day,
    dateTo: day,
    partySize: options.partySize,
    area: options.area ?? null,
    now,
    context,
    ignoreHoldToken: options.ignoreHoldToken,
    ignoreBookingId: options.ignoreBookingId,
    restrictTo,
  });
  if (!range) return null;

  const target = options.startAt.getTime();
  const slot = range.days[0].slots.find(
    (candidate) => candidate.startAt.getTime() === target,
  );

  return slot ? { context, slot } : null;
}

/**
 * Komunikat dla grup ponad limit rezerwacji online — jeden tekst dla API
 * dostępności, zapisu rezerwacji i UI, z telefonem, jeśli lokal go podał.
 */
export function partyTooLargeMessage(context: RestaurantContext): string {
  const limit = context.location.maxPartySizeOnline ?? 0;
  const phone = context.location.phone;
  return `Dla grup powyżej ${limit} osób zadzwoń do lokalu${
    phone ? `: ${phone}` : ""
  }.`;
}

/**
 * Komunikat dla grup mniejszych niż najmniejszy stolik lokalu. Bez niego
 * gość widział „brak wolnych stolików" i listę oczekujących, choć problemem
 * nie jest obłożenie, tylko to, że lokal nie sadza tak małych grup.
 */
export function partyTooSmallMessage(context: RestaurantContext): string {
  const min = context.minPartySizeSeatable;
  const phone = context.location.phone;
  return `Najmniejszy stolik w tym lokalu jest dla ${min} osób — rezerwację dla mniejszej grupy ustal telefonicznie${
    phone ? `: ${phone}` : ""
  }.`;
}

/**
 * Czas zajęcia stolika dla danej liczby osób — do prezentacji („stolik na
 * 1 h 45 min") bez liczenia całej dostępności.
 */
export function turnTimeForContext(
  context: RestaurantContext,
  partySize: number,
): number {
  return turnTimeForPartySize(
    context.turnTimeRules,
    partySize,
    context.location.defaultTurnTimeMin,
  );
}
