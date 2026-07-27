import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getAvailabilityForRange,
  loadServiceContext,
  type ServiceContext,
} from "@/lib/availability-data";
import { addMinutes, utcToZonedWallClock } from "@/lib/time";

/**
 * Holdy (tymczasowe blokady slotu na czas checkoutu).
 *
 * Hold przykrywa DOKŁADNIE ten sam przedział co przyszły BookingItem —
 * czyli slot rozszerzony o bufory usługi (`blockedStartAt`/`blockedEndAt`).
 * Silnik dostępności traktuje holdy jak zajętość (`resource.holds`), więc
 * jednolity przedział gwarantuje, że blokada na czas checkoutu i realna
 * rezerwacja zabierają z grafiku identyczny kawałek.
 *
 * Holdy nie mają constraintu wykluczającego w bazie (w odróżnieniu od
 * BookingItem) — są miękką rezerwacją UX-ową, twardą gwarancją pozostaje
 * `booking_items_no_overlap`. Wygasłe wiersze sprzątamy leniwie: przy każdej
 * próbie założenia holda na danym zasobie.
 */

/** Czas życia holda w minutach — tyle klient ma na wypełnienie danych. */
export const HOLD_TTL_MINUTES = 10;

/** Slot rozwiązany do konkretnego zasobu, z cenami i przedziałem blokady. */
export type ResolvedSlot = {
  resourceId: string;
  resourceName: string;
  startAt: Date;
  endAt: Date;
  blockedStartAt: Date;
  blockedEndAt: Date;
  durationMin: number;
  priceCents: number;
};

export type SlotResolutionError = {
  ok: false;
  status: number;
  error: "NOT_FOUND" | "VALIDATION" | "SLOT_TAKEN" | "SLOT_HELD";
  message: string;
};

export type SlotResolution =
  | { ok: true; context: ServiceContext; slot: ResolvedSlot }
  | SlotResolutionError;

const fail = (
  status: number,
  error: SlotResolutionError["error"],
  message: string,
): SlotResolutionError => ({ ok: false, status, error, message });

export const SLOT_TAKEN_MESSAGE =
  "Ten termin właśnie został zajęty. Wybierz inną godzinę.";
export const SLOT_HELD_MESSAGE =
  "Ten termin jest właśnie rezerwowany przez inną osobę. Spróbuj za kilka minut albo wybierz inną godzinę.";

/**
 * Wspólna walidacja slotu dla holdów i rezerwacji: usługa istnieje, termin
 * jest w przyszłości i wychodzi z silnika dostępności, a „dowolny pracownik"
 * został rozwiązany do konkretnego zasobu (najmniej obłożonego).
 *
 * `ignoreHoldToken` pozwala pominąć własnego holda — inaczej klient, który
 * przed chwilą zablokował slot, sam by sobie ten slot zasłonił.
 */
export async function resolveSlot(options: {
  businessSlug: string;
  serviceId: string;
  resourceId?: string;
  startAt: Date;
  now?: Date;
  ignoreHoldToken?: string;
  context?: ServiceContext;
  /** Leniwe sprzątanie: skasuj wygasłe holdy kandydujących zasobów. */
  cleanupExpired?: boolean;
}): Promise<SlotResolution> {
  const now = options.now ?? new Date();

  if (options.startAt.getTime() <= now.getTime()) {
    return fail(422, "VALIDATION", "Termin musi być w przyszłości");
  }

  const context =
    options.context ??
    (await loadServiceContext(options.businessSlug, options.serviceId));
  if (!context) {
    return fail(404, "NOT_FOUND", "Nie znaleziono usługi");
  }
  if (
    options.resourceId &&
    !context.resources.some((resource) => resource.id === options.resourceId)
  ) {
    return fail(404, "NOT_FOUND", "Ten pracownik nie wykonuje tej usługi");
  }
  if (context.service.priceType === "ON_REQUEST") {
    return fail(
      422,
      "VALIDATION",
      "Ta usługa jest dostępna wyłącznie na zapytanie",
    );
  }

  if (options.cleanupExpired) {
    await cleanupExpiredHolds(
      (options.resourceId
        ? context.resources.filter((r) => r.id === options.resourceId)
        : context.resources
      ).map((resource) => resource.id),
      now,
    );
  }

  // Dostępność liczona dla dnia lokalnego lokalu, w którym wypada start.
  const wall = utcToZonedWallClock(options.startAt, context.location.timezone);
  const localDay = { year: wall.year, month: wall.month, day: wall.day };
  const availability = await getAvailabilityForRange({
    businessSlug: options.businessSlug,
    serviceId: options.serviceId,
    dateFrom: localDay,
    dateTo: localDay,
    resourceId: options.resourceId,
    ignoreHoldToken: options.ignoreHoldToken,
    now,
    context,
  });
  if (!availability) return fail(409, "SLOT_TAKEN", SLOT_TAKEN_MESSAGE);

  const mergedSlot = availability.result.merged.find(
    (slot) => slot.startAt.getTime() === options.startAt.getTime(),
  );
  if (!mergedSlot) {
    // Rozróżniamy „zajęte" od „ktoś właśnie rezerwuje" — komunikat dla
    // klienta jest inny, bo hold sam z siebie wygaśnie.
    const heldByOther = await hasActiveHoldOnSlot({
      context,
      resourceId: options.resourceId,
      startAt: options.startAt,
      now,
      ignoreHoldToken: options.ignoreHoldToken,
    });
    return heldByOther
      ? fail(409, "SLOT_HELD", SLOT_HELD_MESSAGE)
      : fail(409, "SLOT_TAKEN", SLOT_TAKEN_MESSAGE);
  }

  // „Dowolny pracownik": wybieramy najmniej obłożony zasób spośród tych,
  // które mają wolny ten start (najwięcej pozostałych slotów w dniu).
  const resourceLoad = new Map(
    availability.result.perResource.map((entry) => [
      entry.resourceId,
      entry.slots.length,
    ]),
  );
  // Jeśli klient trzyma holda, to on wyznacza zasób — obłożenie mogło się
  // przesunąć w czasie wypełniania formularza, a wybór innego pracownika
  // sprawiłby, że consumeHold odrzuciłby ważną blokadę jako INVALID.
  const heldResourceId = options.ignoreHoldToken
    ? await resourceIdOfHold(options.ignoreHoldToken)
    : null;
  const chosenResourceId =
    heldResourceId !== null && mergedSlot.resourceIds.includes(heldResourceId)
      ? heldResourceId
      : [...mergedSlot.resourceIds].sort(
          (a, b) => (resourceLoad.get(b) ?? 0) - (resourceLoad.get(a) ?? 0),
        )[0];
  const chosenResource = context.resources.find(
    (resource) => resource.id === chosenResourceId,
  );
  if (!chosenResource) return fail(409, "SLOT_TAKEN", SLOT_TAKEN_MESSAGE);

  const durationMin =
    chosenResource.durationMinOverride ?? context.service.durationMin;
  const priceCents =
    chosenResource.priceCentsOverride ?? context.service.priceCents;
  const endAt = addMinutes(options.startAt, durationMin);

  return {
    ok: true,
    context,
    slot: {
      resourceId: chosenResource.id,
      resourceName: chosenResource.name,
      startAt: options.startAt,
      endAt,
      blockedStartAt: addMinutes(
        options.startAt,
        -context.service.bufferBeforeMin,
      ),
      blockedEndAt: addMinutes(endAt, context.service.bufferAfterMin),
      durationMin,
      priceCents,
    },
  };
}

/** Zasób, na którym stoi hold o danym tokenie (null, gdy tokenu nie ma). */
async function resourceIdOfHold(token: string): Promise<string | null> {
  const hold = await prisma.hold.findUnique({
    where: { token },
    select: { resourceId: true },
  });
  return hold?.resourceId ?? null;
}

/**
 * Czy na tym starcie wisi cudzy aktywny hold? Zasób bywa jeszcze nieznany
 * („dowolny pracownik"), więc sprawdzamy wszystkie kandydujące zasoby i
 * najdłuższy możliwy przedział — to tylko rozróżnienie komunikatu błędu.
 */
async function hasActiveHoldOnSlot(options: {
  context: ServiceContext;
  resourceId?: string;
  startAt: Date;
  now: Date;
  ignoreHoldToken?: string;
}): Promise<boolean> {
  const resources = options.resourceId
    ? options.context.resources.filter((r) => r.id === options.resourceId)
    : options.context.resources;
  if (resources.length === 0) return false;

  const maxDurationMin = Math.max(
    ...resources.map(
      (resource) =>
        resource.durationMinOverride ?? options.context.service.durationMin,
    ),
  );
  const from = addMinutes(
    options.startAt,
    -options.context.service.bufferBeforeMin,
  );
  const to = addMinutes(
    options.startAt,
    maxDurationMin + options.context.service.bufferAfterMin,
  );

  const conflicting = await prisma.hold.findFirst({
    where: {
      resourceId: { in: resources.map((resource) => resource.id) },
      expiresAt: { gt: options.now },
      startAt: { lt: to },
      endAt: { gt: from },
      ...(options.ignoreHoldToken
        ? { token: { not: options.ignoreHoldToken } }
        : {}),
    },
    select: { id: true },
  });
  return conflicting !== null;
}

/** Leniwe sprzątanie: kasuje wygasłe holdy wskazanych zasobów. */
export async function cleanupExpiredHolds(
  resourceIds: string[],
  now: Date = new Date(),
): Promise<number> {
  if (resourceIds.length === 0) return 0;
  const result = await prisma.hold.deleteMany({
    where: { resourceId: { in: resourceIds }, expiresAt: { lte: now } },
  });
  return result.count;
}

export type CreatedHold = {
  token: string;
  expiresAt: Date;
  resourceId: string;
  startAt: Date;
  endAt: Date;
};

/**
 * Zakłada holda na rozwiązanym slocie. Tuż przed zapisem powtarza kontrolę
 * kolizji (rezerwacje + cudze holdy).
 *
 * Tabela `holds` nie ma constraintu wykluczającego, więc sam SELECT+INSERT
 * w READ COMMITTED przepuściłby dwa równoczesne holdy na ten sam slot
 * (obaj klienci zobaczyliby „termin zablokowany dla Ciebie", a przegrany
 * dowiedziałby się o zajęciu dopiero przy 409 z exclusion constraint).
 * Dlatego na starcie transakcji blokujemy wiersz zasobu (SELECT ... FOR
 * UPDATE) — zapytania o ten sam zasób ustawiają się w kolejce, a różne
 * zasoby dalej idą równolegle.
 */
export async function createHold(
  slot: ResolvedSlot,
  now: Date = new Date(),
): Promise<CreatedHold | null> {
  const expiresAt = addMinutes(now, HOLD_TTL_MINUTES);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM resources WHERE id = ${slot.resourceId} FOR UPDATE`;

    const [busy, held] = await Promise.all([
      tx.bookingItem.findFirst({
        where: {
          resourceId: slot.resourceId,
          isBlocking: true,
          blockedStartAt: { lt: slot.blockedEndAt },
          blockedEndAt: { gt: slot.blockedStartAt },
        },
        select: { id: true },
      }),
      tx.hold.findFirst({
        where: {
          resourceId: slot.resourceId,
          expiresAt: { gt: now },
          startAt: { lt: slot.blockedEndAt },
          endAt: { gt: slot.blockedStartAt },
        },
        select: { id: true },
      }),
    ]);
    if (busy || held) return null;

    const hold = await tx.hold.create({
      data: {
        resourceId: slot.resourceId,
        startAt: slot.blockedStartAt,
        endAt: slot.blockedEndAt,
        token: randomUUID(),
        expiresAt,
      },
      select: { token: true, expiresAt: true, startAt: true, endAt: true },
    });

    return {
      token: hold.token,
      expiresAt: hold.expiresAt,
      resourceId: slot.resourceId,
      startAt: hold.startAt,
      endAt: hold.endAt,
    };
  });
}

/** Zwolnienie holda przez klienta (porzucony checkout). */
export async function releaseHold(token: string): Promise<boolean> {
  const result = await prisma.hold.deleteMany({ where: { token } });
  return result.count > 0;
}

export type HoldConsumeResult = "OK" | "INVALID" | "EXPIRED";

/**
 * Konsumpcja holda w transakcji tworzącej rezerwację: token musi pasować do
 * zasobu i przedziału oraz być jeszcze ważny. Hold znika razem z zapisem
 * rezerwacji — albo oba, albo żadne (rollback transakcji).
 */
export async function consumeHold(
  tx: Prisma.TransactionClient,
  input: {
    token: string;
    resourceId: string;
    blockedStartAt: Date;
    blockedEndAt: Date;
    now?: Date;
  },
): Promise<HoldConsumeResult> {
  const now = input.now ?? new Date();
  const hold = await tx.hold.findUnique({
    where: { token: input.token },
    select: {
      id: true,
      resourceId: true,
      startAt: true,
      endAt: true,
      expiresAt: true,
    },
  });
  if (!hold) return "INVALID";
  if (
    hold.resourceId !== input.resourceId ||
    hold.startAt.getTime() !== input.blockedStartAt.getTime() ||
    hold.endAt.getTime() !== input.blockedEndAt.getTime()
  ) {
    return "INVALID";
  }
  if (hold.expiresAt.getTime() <= now.getTime()) {
    await tx.hold.delete({ where: { id: hold.id } });
    return "EXPIRED";
  }

  await tx.hold.delete({ where: { id: hold.id } });
  return "OK";
}
