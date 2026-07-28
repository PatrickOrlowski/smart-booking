import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  findCustomerByContact,
  findOrCreateCustomerForUser,
  normalizePhone,
} from "@/app/panel/(dashboard)/klienci/customer-match";

/**
 * Dopasowanie klienta po kontakcie — jedyna bariera między „zablokowany
 * klient" a rezerwacją online z lekko zmienionym numerem/e-mailem.
 *
 * Test integracyjny, bo porównanie telefonu po samych cyfrach robi SQL
 * (regexp_replace), a e-maila — collation Postgresa (mode: insensitive).
 */

const TEST_OWNER_EMAIL = "test-match@example.com";
const TEST_SLUG = `test-match-${Date.now()}`;

let businessId: string;
let userId: string;

beforeAll(async () => {
  const owner = await prisma.user.upsert({
    where: { email: TEST_OWNER_EMAIL },
    update: {},
    create: { email: TEST_OWNER_EMAIL, role: "BUSINESS_OWNER" },
  });

  const client = await prisma.user.upsert({
    where: { email: "test-match-client@example.com" },
    update: {},
    create: { email: "test-match-client@example.com", role: "CUSTOMER" },
  });
  userId = client.id;

  const business = await prisma.business.create({
    data: {
      slug: TEST_SLUG,
      name: "Test Match",
      type: "BARBER",
      ownerId: owner.id,
    },
    select: { id: true },
  });
  businessId = business.id;
});

afterAll(async () => {
  const leftovers = await prisma.business.findMany({
    where: { slug: { startsWith: "test-match-" } },
    select: { id: true },
  });
  const ids = leftovers.map((business) => business.id);
  await prisma.customer.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.business.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({
    where: {
      email: { in: [TEST_OWNER_EMAIL, "test-match-client@example.com"] },
    },
  });
});

describe("normalizePhone", () => {
  it("sprowadza polskie zapisy numeru do 9 cyfr znaczących", () => {
    expect(normalizePhone("+48 600-700 800")).toBe("600700800");
    expect(normalizePhone("0048600700800")).toBe("600700800");
    expect(normalizePhone("0600700800")).toBe("600700800");
    expect(normalizePhone("600 700 800")).toBe("600700800");
  });

  it("numer spoza wzorca zostawia jako same cyfry", () => {
    expect(normalizePhone("+49 151 12345678")).toBe("4915112345678");
  });
});

describe("findCustomerByContact", () => {
  it("dopasowuje telefon niezależnie od formatu i e-mail bez wielkości liter", async () => {
    const created = await prisma.customer.create({
      data: {
        businessId,
        fullName: "Jan Kowalski",
        phone: "+48 600 700 800",
        email: "Jan.Kowalski@Example.COM",
        isBlocked: true,
      },
      select: { id: true },
    });

    const byPlainPhone = await findCustomerByContact(businessId, {
      phone: "48600700800",
    });
    expect(byPlainPhone?.id).toBe(created.id);
    expect(byPlainPhone?.isBlocked).toBe(true);

    const byDashedPhone = await findCustomerByContact(businessId, {
      phone: "+48-600-700-800",
    });
    expect(byDashedPhone?.id).toBe(created.id);

    const byEmailCase = await findCustomerByContact(businessId, {
      email: "jan.kowalski@example.com",
    });
    expect(byEmailCase?.id).toBe(created.id);

    const noMatch = await findCustomerByContact(businessId, {
      phone: "111222333",
      email: "ktos-inny@example.com",
    });
    expect(noMatch).toBeNull();
  });
});

describe("findOrCreateCustomerForUser", () => {
  it("dowiązuje istniejący profil z wizyt ręcznych zamiast tworzyć duplikat", async () => {
    const manual = await prisma.customer.create({
      data: {
        businessId,
        fullName: "Anna Nowak",
        phone: "600100200",
        isBlocked: true,
      },
      select: { id: true },
    });

    const resolvedId = await findOrCreateCustomerForUser(businessId, userId, {
      name: "Anna Nowak",
      phone: "+48 600 100 200",
      email: "anna@example.com",
    });

    expect(resolvedId).toBe(manual.id);

    const linked = await prisma.customer.findUnique({
      where: { id: manual.id },
      select: { userId: true, email: true, isBlocked: true },
    });
    // Konto dowiązane do istniejącego profilu — blokada zostaje w mocy,
    // a brakujący kanał kontaktu jest uzupełniony (nie nadpisany).
    expect(linked?.userId).toBe(userId);
    expect(linked?.email).toBe("anna@example.com");
    expect(linked?.isBlocked).toBe(true);

    const duplicates = await prisma.customer.count({
      where: { businessId, fullName: "Anna Nowak" },
    });
    expect(duplicates).toBe(1);

    // Kolejne wywołanie trafia już w profil po userId.
    expect(
      await findOrCreateCustomerForUser(businessId, userId, {
        name: "Anna Nowak",
        phone: "600100200",
      }),
    ).toBe(manual.id);
  });
});
