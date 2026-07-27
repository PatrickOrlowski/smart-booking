import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Test integracyjny gwarancji z migracji `booking_no_overlap`.
 *
 * Sprawdza to, czego nie da się sprawdzić w kodzie aplikacji: że przy dwóch
 * równoczesnych żądaniach na ten sam slot baza przepuści dokładnie jedno.
 */

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: connectionString! }),
});

const TEST_OWNER_EMAIL = "test-overlap@example.com";
const TEST_SLUG = `test-overlap-${Date.now()}`;

let businessId: string;
let locationId: string;
let resourceId: string;
let serviceId: string;
let otherResourceId: string;

const SLOT_START = new Date("2030-05-06T08:00:00.000Z");
const SLOT_END = new Date("2030-05-06T08:45:00.000Z");

async function createBooking(
  start: Date,
  end: Date,
  resource = resourceId,
): Promise<string> {
  const booking = await prisma.booking.create({
    data: {
      businessId,
      locationId,
      guestName: "Test",
      guestEmail: "test@example.com",
      status: "CONFIRMED",
      startAt: start,
      endAt: end,
      totalPriceCents: 10000,
      items: {
        create: {
          serviceId,
          resourceId: resource,
          startAt: start,
          endAt: end,
          blockedStartAt: start,
          blockedEndAt: end,
          durationMin: Math.round((end.getTime() - start.getTime()) / 60000),
          priceCents: 10000,
        },
      },
    },
  });
  return booking.id;
}

beforeAll(async () => {
  const owner = await prisma.user.upsert({
    where: { email: TEST_OWNER_EMAIL },
    update: {},
    create: { email: TEST_OWNER_EMAIL, role: "BUSINESS_OWNER" },
  });

  const business = await prisma.business.create({
    data: {
      slug: TEST_SLUG,
      name: "Test Overlap",
      type: "BARBER",
      ownerId: owner.id,
      locations: {
        create: {
          name: "Test",
          addressLine1: "ul. Testowa 1",
          city: "Warszawa",
          postalCode: "00-001",
          resources: {
            create: [
              { name: "Zasób A", type: "STAFF" },
              { name: "Zasób B", type: "STAFF" },
            ],
          },
        },
      },
      services: {
        create: { name: "Usługa testowa", durationMin: 45, priceCents: 10000 },
      },
    },
    include: {
      locations: { include: { resources: { orderBy: { name: "asc" } } } },
      services: true,
    },
  });

  businessId = business.id;
  locationId = business.locations[0].id;
  resourceId = business.locations[0].resources[0].id;
  otherResourceId = business.locations[0].resources[1].id;
  serviceId = business.services[0].id;
});

afterAll(async () => {
  // Sprząta też pozostałości po przerwanych przebiegach — inaczej wiszą one
  // na koncie właściciela i blokują jego usunięcie.
  const leftovers = await prisma.business.findMany({
    where: { slug: { startsWith: "test-overlap-" } },
    select: { id: true },
  });
  const ids = leftovers.map((business) => business.id);

  // Rezerwacje nie kaskadują z firmą (RESTRICT) — historii nie kasuje się
  // przypadkiem razem z profilem firmy.
  await prisma.booking.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.business.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: TEST_OWNER_EMAIL } });
  await prisma.$disconnect();
});

describe("ograniczenie booking_items_no_overlap", () => {
  it("przepuszcza dokładnie jedną z dwóch równoczesnych rezerwacji tego samego slotu", async () => {
    const results = await Promise.allSettled([
      createBooking(SLOT_START, SLOT_END),
      createBooking(SLOT_START, SLOT_END),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // 23P01 = exclusion_violation
    expect(JSON.stringify(rejected[0])).toContain("23P01");
  });

  it("pozwala na wizytę stykającą się końcem z początkiem poprzedniej", async () => {
    const backToBack = await createBooking(
      SLOT_END,
      new Date(SLOT_END.getTime() + 45 * 60_000),
    );
    expect(backToBack).toBeTruthy();
  });

  it("blokuje częściowe nachodzenie na siebie", async () => {
    await expect(
      createBooking(
        new Date(SLOT_START.getTime() + 15 * 60_000),
        new Date(SLOT_END.getTime() + 15 * 60_000),
      ),
    ).rejects.toThrow();
  });

  it("nie blokuje tego samego czasu u innego pracownika", async () => {
    const parallel = await createBooking(SLOT_START, SLOT_END, otherResourceId);
    expect(parallel).toBeTruthy();
  });

  it("anulowanie rezerwacji zwalnia slot", async () => {
    const existing = await prisma.bookingItem.findFirst({
      where: { resourceId, blockedStartAt: SLOT_START },
      select: { bookingId: true },
    });
    expect(existing).not.toBeNull();

    await prisma.booking.update({
      where: { id: existing!.bookingId },
      data: { status: "CANCELLED_BY_CUSTOMER" },
    });

    // Trigger zdejmuje flagę is_blocking, więc slot znów jest wolny.
    const rebooked = await createBooking(SLOT_START, SLOT_END);
    expect(rebooked).toBeTruthy();
  });

  it("NO_SHOW nadal blokuje grafik", async () => {
    const existing = await prisma.bookingItem.findFirst({
      where: { resourceId, blockedStartAt: SLOT_START, isBlocking: true },
      select: { bookingId: true },
    });
    expect(existing).not.toBeNull();

    await prisma.booking.update({
      where: { id: existing!.bookingId },
      data: { status: "NO_SHOW" },
    });

    await expect(createBooking(SLOT_START, SLOT_END)).rejects.toThrow();
  });
});
