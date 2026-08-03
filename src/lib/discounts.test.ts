import { describe, expect, it } from "vitest";
import {
  calculateDiscount,
  discountCodeMatches,
  discountValueLabel,
  normalizeDiscountCode,
  type DiscountCodeSnapshot,
} from "./discounts";

/**
 * Testy czystej kalkulacji rabatu. Zero bazy, zero zegara systemowego —
 * „teraz" i liczniki użyć wchodzą parametrem.
 */

const NOW = new Date("2026-08-01T10:00:00.000Z");

const code = (
  overrides: Partial<DiscountCodeSnapshot> = {},
): DiscountCodeSnapshot => ({
  code: "LATO20",
  type: "PERCENT",
  value: 20,
  minAmountCents: null,
  maxUses: null,
  maxUsesPerCustomer: 1,
  validFrom: null,
  validTo: null,
  isActive: true,
  ...overrides,
});

describe("normalizeDiscountCode", () => {
  it("ignoruje wielkość liter i białe znaki (także w środku)", () => {
    expect(normalizeDiscountCode("  lato20 ")).toBe("LATO20");
    expect(normalizeDiscountCode("La To 20")).toBe("LATO20");
    expect(normalizeDiscountCode("\tlato\n20")).toBe("LATO20");
  });

  it("discountCodeMatches porównuje po normalizacji", () => {
    expect(discountCodeMatches("LATO20", " lato20 ")).toBe(true);
    expect(discountCodeMatches("LATO20", "LATO21")).toBe(false);
  });
});

describe("calculateDiscount — rozpoznanie kodu", () => {
  it("brak kodu w bazie → NOT_FOUND", () => {
    const result = calculateDiscount({
      code: null,
      subtotalCents: 10_000,
      now: NOW,
    });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toBe("NOT_FOUND");
    expect(result.discountCents).toBe(0);
  });

  it("wpisany kod inną wielkością liter i ze spacjami nadal działa", () => {
    const result = calculateDiscount({
      code: code(),
      enteredCode: "  lato 20 ",
      subtotalCents: 10_000,
      now: NOW,
    });
    expect(result).toEqual({ valid: true, discountCents: 2000 });
  });

  it("wpisany kod niepasujący do rekordu → NOT_FOUND", () => {
    const result = calculateDiscount({
      code: code(),
      enteredCode: "LATO21",
      subtotalCents: 10_000,
      now: NOW,
    });
    expect(result.valid === false && result.reason).toBe("NOT_FOUND");
  });
});

describe("calculateDiscount — stan i granice dat", () => {
  it("kod nieaktywny → INACTIVE", () => {
    const result = calculateDiscount({
      code: code({ isActive: false }),
      subtotalCents: 10_000,
      now: NOW,
    });
    expect(result.valid === false && result.reason).toBe("INACTIVE");
  });

  it("kod przed początkiem ważności → NOT_YET_VALID", () => {
    const result = calculateDiscount({
      code: code({ validFrom: new Date("2026-08-01T10:00:00.001Z") }),
      subtotalCents: 10_000,
      now: NOW,
    });
    expect(result.valid === false && result.reason).toBe("NOT_YET_VALID");
  });

  it("validFrom dokładnie równy chwili obecnej jest już ważny (granica domknięta)", () => {
    const result = calculateDiscount({
      code: code({ validFrom: NOW }),
      subtotalCents: 10_000,
      now: NOW,
    });
    expect(result).toEqual({ valid: true, discountCents: 2000 });
  });

  it("validTo dokładnie równy chwili obecnej już nie działa (granica otwarta)", () => {
    const result = calculateDiscount({
      code: code({ validTo: NOW }),
      subtotalCents: 10_000,
      now: NOW,
    });
    expect(result.valid === false && result.reason).toBe("EXPIRED");
  });

  it("milisekunda przed validTo kod jeszcze działa", () => {
    const result = calculateDiscount({
      code: code({ validTo: new Date("2026-08-01T10:00:00.001Z") }),
      subtotalCents: 10_000,
      now: NOW,
    });
    expect(result.valid).toBe(true);
  });

  it("kod wygasły (validTo w przeszłości) → EXPIRED", () => {
    const result = calculateDiscount({
      code: code({ validTo: new Date("2026-07-01T00:00:00.000Z") }),
      subtotalCents: 10_000,
      now: NOW,
    });
    expect(result.valid === false && result.reason).toBe("EXPIRED");
  });

  it("kod archiwalny (wyłączony ORAZ wygasły) mówi o wygaśnięciu", () => {
    const result = calculateDiscount({
      code: code({
        isActive: false,
        validTo: new Date("2026-07-18T00:00:00.000Z"),
      }),
      subtotalCents: 10_000,
      now: NOW,
    });
    expect(result.valid === false && result.reason).toBe("EXPIRED");
  });
});

describe("calculateDiscount — kwoty", () => {
  it("procent zaokrągla w dół (Math.floor), bez arytmetyki zmiennoprzecinkowej", () => {
    // 10% z 7,77 zł = 77,7 gr → 77 gr
    const result = calculateDiscount({
      code: code({ type: "PERCENT", value: 10 }),
      subtotalCents: 777,
      now: NOW,
    });
    expect(result.discountCents).toBe(77);
  });

  it("procent nigdy nie przekracza kwoty rezerwacji", () => {
    const result = calculateDiscount({
      code: code({ type: "PERCENT", value: 150 }),
      subtotalCents: 8000,
      now: NOW,
    });
    expect(result).toEqual({ valid: true, discountCents: 8000 });
  });

  it("rabat kwotowy większy niż cena → obcięty do kwoty rezerwacji (cena 0, nie ujemna)", () => {
    const result = calculateDiscount({
      code: code({ type: "AMOUNT", value: 5000 }),
      subtotalCents: 3000,
      now: NOW,
    });
    expect(result).toEqual({ valid: true, discountCents: 3000 });
    expect(3000 - result.discountCents).toBe(0);
  });

  it("rabat kwotowy mniejszy niż cena schodzi w całości", () => {
    const result = calculateDiscount({
      code: code({ type: "AMOUNT", value: 5000 }),
      subtotalCents: 12_000,
      now: NOW,
    });
    expect(result.discountCents).toBe(5000);
  });

  it("procent liczony z groszy nie gubi się na zaokrągleniu binarnym", () => {
    // 20% z 12 000 gr = 2400 gr — 0.2 * 12000 w float daje 2400.0000000000005
    const result = calculateDiscount({
      code: code({ type: "PERCENT", value: 20 }),
      subtotalCents: 12_000,
      now: NOW,
    });
    expect(result.discountCents).toBe(2400);
    expect(Number.isInteger(result.discountCents)).toBe(true);
  });

  it("rabat, który po zaokrągleniu wynosi 0 gr → NO_EFFECT", () => {
    const result = calculateDiscount({
      code: code({ type: "PERCENT", value: 1 }),
      subtotalCents: 50,
      now: NOW,
    });
    expect(result.valid === false && result.reason).toBe("NO_EFFECT");
  });

  it("rezerwacja bez kwoty (usługa bezpłatna) → NO_AMOUNT", () => {
    const result = calculateDiscount({
      code: code(),
      subtotalCents: 0,
      now: NOW,
    });
    expect(result.valid === false && result.reason).toBe("NO_AMOUNT");
  });
});

describe("calculateDiscount — kwota minimalna", () => {
  it("poniżej minimum → MIN_AMOUNT z kwotą w komunikacie", () => {
    const result = calculateDiscount({
      code: code({ type: "AMOUNT", value: 5000, minAmountCents: 10_000 }),
      subtotalCents: 7000,
      now: NOW,
    });
    expect(result.valid === false && result.reason).toBe("MIN_AMOUNT");
    expect(result.valid === false && result.message).toContain("100");
  });

  it("dokładnie na minimum → kod działa", () => {
    const result = calculateDiscount({
      code: code({ type: "AMOUNT", value: 5000, minAmountCents: 10_000 }),
      subtotalCents: 10_000,
      now: NOW,
    });
    expect(result).toEqual({ valid: true, discountCents: 5000 });
  });
});

describe("calculateDiscount — limity użyć", () => {
  it("limit globalny wyczerpany → MAX_USES", () => {
    const result = calculateDiscount({
      code: code({ maxUses: 100 }),
      subtotalCents: 10_000,
      now: NOW,
      totalRedemptions: 100,
    });
    expect(result.valid === false && result.reason).toBe("MAX_USES");
  });

  it("ostatnie wolne użycie z puli przechodzi", () => {
    const result = calculateDiscount({
      code: code({ maxUses: 100 }),
      subtotalCents: 10_000,
      now: NOW,
      totalRedemptions: 99,
    });
    expect(result.valid).toBe(true);
  });

  it("limit per klient wyczerpany → MAX_USES_PER_CUSTOMER", () => {
    const result = calculateDiscount({
      code: code({ maxUsesPerCustomer: 1 }),
      subtotalCents: 10_000,
      now: NOW,
      customerId: "cus_1",
      redemptionsByCustomer: 1,
    });
    expect(result.valid === false && result.reason).toBe(
      "MAX_USES_PER_CUSTOMER",
    );
  });

  it("ten sam kod u innego klienta nadal działa", () => {
    const result = calculateDiscount({
      code: code({ maxUsesPerCustomer: 1 }),
      subtotalCents: 10_000,
      now: NOW,
      customerId: "cus_2",
      redemptionsByCustomer: 0,
      totalRedemptions: 12,
    });
    expect(result.valid).toBe(true);
  });

  it("maxUsesPerCustomer = 0 znaczy bez limitu na klienta", () => {
    const result = calculateDiscount({
      code: code({ maxUsesPerCustomer: 0 }),
      subtotalCents: 10_000,
      now: NOW,
      customerId: "cus_1",
      redemptionsByCustomer: 7,
    });
    expect(result.valid).toBe(true);
  });

  it("gość bez profilu CRM nie jest blokowany limitem per klient", () => {
    const result = calculateDiscount({
      code: code({ maxUsesPerCustomer: 1 }),
      subtotalCents: 10_000,
      now: NOW,
      customerId: null,
      redemptionsByCustomer: 5,
    });
    expect(result.valid).toBe(true);
  });

  it("limit globalny sprawdzany przed limitem per klient", () => {
    const result = calculateDiscount({
      code: code({ maxUses: 10, maxUsesPerCustomer: 1 }),
      subtotalCents: 10_000,
      now: NOW,
      customerId: "cus_1",
      redemptionsByCustomer: 1,
      totalRedemptions: 10,
    });
    expect(result.valid === false && result.reason).toBe("MAX_USES");
  });
});

describe("discountValueLabel", () => {
  it("formatuje procent i kwotę", () => {
    expect(discountValueLabel("PERCENT", 20)).toBe("20%");
    expect(discountValueLabel("AMOUNT", 5000)).toContain("50");
  });
});
