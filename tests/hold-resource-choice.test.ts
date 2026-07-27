import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createHold, resolveSlot } from "@/lib/hold";
import { localDayMinutesToUtc } from "@/lib/time";

/**
 * Regresja: przy „dowolnym pracowniku" rezerwacja musi trafić na ten zasób,
 * na którym stoi hold z checkoutu — nawet jeśli w międzyczasie obłożenie
 * przesunęło się tak, że heurystyka „najmniej obłożony" wskazuje kogoś
 * innego. Inaczej consumeHold odrzuca ważną blokadę jako INVALID i klient
 * dostaje 422 przy każdej próbie.
 */

const TEST_OWNER_EMAIL = "test-hold-choice@example.com";
const TEST_SLUG = `test-hold-choice-${Date.now()}`;
const TIMEZONE = "Europe/Warsaw";

let businessId: string;
let locationId: string;
let serviceId: string;
let resourceA: string;
let resourceB: string;
/** Dzień lokalny za tydzień — poza minLeadTime i w oknie maxAdvanceDays. */
let day: { year: number; month: number; day: number };

const weekdays = [0, 1, 2, 3, 4, 5, 6];

beforeAll(async () => {
  const owner = await prisma.user.upsert({
    where: { email: TEST_OWNER_EMAIL },
    update: {},
    create: { email: TEST_OWNER_EMAIL, role: "BUSINESS_OWNER" },
  });

  const business = await prisma.business.create({
    data: {
      slug: TEST_SLUG,
      name: "Test Hold Choice",
      type: "BARBER",
      ownerId: owner.id,
      status: "ACTIVE",
      locations: {
        create: {
          name: "Test",
          addressLine1: "ul. Testowa 1",
          city: "Warszawa",
          postalCode: "00-001",
          timezone: TIMEZONE,
          openingHours: {
            create: weekdays.map((weekday) => ({
              weekday,
              startMinute: 8 * 60,
              endMinute: 20 * 60,
            })),
          },
          resources: {
            create: [
              {
                name: "Zasób A",
                type: "STAFF",
                workingHours: {
                  create: weekdays.map((weekday) => ({
                    weekday,
                    startMinute: 8 * 60,
                    endMinute: 20 * 60,
                  })),
                },
              },
              {
                name: "Zasób B",
                type: "STAFF",
                workingHours: {
                  create: weekdays.map((weekday) => ({
                    weekday,
                    startMinute: 8 * 60,
                    endMinute: 20 * 60,
                  })),
                },
              },
            ],
          },
        },
      },
      services: {
        create: {
          name: "Usługa testowa",
          durationMin: 60,
          priceCents: 10000,
          onlineBookable: true,
        },
      },
    },
    include: {
      locations: { include: { resources: { orderBy: { name: "asc" } } } },
      services: true,
    },
  });

  businessId = business.id;
  locationId = business.locations[0].id;
  resourceA = business.locations[0].resources[0].id;
  resourceB = business.locations[0].resources[1].id;
  serviceId = business.services[0].id;

  await prisma.serviceResource.createMany({
    data: [
      { serviceId, resourceId: resourceA },
      { serviceId, resourceId: resourceB },
    ],
  });

  const inAWeek = new Date(Date.now() + 7 * 86_400_000);
  day = {
    year: inAWeek.getUTCFullYear(),
    month: inAWeek.getUTCMonth() + 1,
    day: inAWeek.getUTCDate(),
  };
});

afterAll(async () => {
  const leftovers = await prisma.business.findMany({
    where: { slug: { startsWith: "test-hold-choice-" } },
    select: { id: true },
  });
  const ids = leftovers.map((business) => business.id);
  await prisma.booking.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.business.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: TEST_OWNER_EMAIL } });
});

describe("resolveSlot przy holdzie z checkoutu", () => {
  it("trzyma się zasobu z holda, nawet gdy obłożenie wskazuje innego", async () => {
    const startAt = localDayMinutesToUtc(day, 10 * 60, TIMEZONE);

    // Klient wchodzi w krok „dane" — blokada ląduje na zasobie A.
    const held = await resolveSlot({
      businessSlug: TEST_SLUG,
      serviceId,
      resourceId: resourceA,
      startAt,
    });
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    const hold = await createHold(held.slot);
    expect(hold).not.toBeNull();

    // W czasie wypełniania formularza ktoś zajmuje inną godzinę u A —
    // teraz A ma mniej wolnych slotów niż B.
    const busyStart = localDayMinutesToUtc(day, 14 * 60, TIMEZONE);
    await prisma.booking.create({
      data: {
        businessId,
        locationId,
        guestName: "Inny klient",
        guestEmail: "inny@example.com",
        status: "CONFIRMED",
        startAt: busyStart,
        endAt: new Date(busyStart.getTime() + 3 * 3_600_000),
        totalPriceCents: 10000,
        items: {
          create: {
            serviceId,
            resourceId: resourceA,
            startAt: busyStart,
            endAt: new Date(busyStart.getTime() + 3 * 3_600_000),
            blockedStartAt: busyStart,
            blockedEndAt: new Date(busyStart.getTime() + 3 * 3_600_000),
            durationMin: 180,
            priceCents: 10000,
          },
        },
      },
    });

    // POST /bookings z „dowolnym pracownikiem" i tokenem holda.
    const resolved = await resolveSlot({
      businessSlug: TEST_SLUG,
      serviceId,
      startAt,
      ignoreHoldToken: hold!.token,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.slot.resourceId).toBe(resourceA);
  });

  it("dwa równoczesne holdy na ten sam slot dają dokładnie jedną blokadę", async () => {
    const startAt = localDayMinutesToUtc(day, 12 * 60, TIMEZONE);
    const resolved = await resolveSlot({
      businessSlug: TEST_SLUG,
      serviceId,
      resourceId: resourceB,
      startAt,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const results = await Promise.all([
      createHold(resolved.slot),
      createHold(resolved.slot),
    ]);
    expect(results.filter((hold) => hold !== null)).toHaveLength(1);

    const stored = await prisma.hold.count({
      where: {
        resourceId: resourceB,
        startAt: resolved.slot.blockedStartAt,
      },
    });
    expect(stored).toBe(1);
  });

  it("bez holda nadal wybiera najmniej obłożony zasób", async () => {
    const startAt = localDayMinutesToUtc(day, 11 * 60, TIMEZONE);
    const resolved = await resolveSlot({
      businessSlug: TEST_SLUG,
      serviceId,
      startAt,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.slot.resourceId).toBe(resourceB);
  });
});
