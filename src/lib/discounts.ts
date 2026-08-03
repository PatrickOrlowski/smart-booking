import type { Prisma } from "@/generated/prisma/client";
import type { DiscountType } from "@/generated/prisma/enums";

/**
 * Kody rabatowe: czysta arytmetyka rabatu + warstwa utrwalenia w transakcji.
 *
 * Cały moduł liczy WYŁĄCZNIE na liczbach całkowitych (grosze). Rabat nigdy
 * nie może dać ceny ujemnej, a procent zaokrąglamy w dół (Math.floor) — na
 * korzyść firmy i deterministycznie, bez arytmetyki zmiennoprzecinkowej
 * przy kwotach.
 *
 * Import Prismy jest wyłącznie TYPOWY (`import type`), a funkcje bazodanowe
 * dostają klienta/transakcję parametrem — dzięki temu `calculateDiscount`
 * pozostaje czysta i testowalna bez bazy.
 */

// ---------------------------------------------------------------------------
// Normalizacja kodu
// ---------------------------------------------------------------------------

/**
 * Kod wpisany przez klienta → postać porównywalna: bez białych znaków
 * (także w środku — „LATO 20" = „LATO20") i wielkimi literami.
 * Klient wpisuje „ lato20 ", w bazie leży „LATO20" — to ten sam kod.
 */
export function normalizeDiscountCode(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** Czy wpisany kod odpowiada kodowi z bazy (bez względu na wielkość liter). */
export function discountCodeMatches(stored: string, entered: string): boolean {
  return normalizeDiscountCode(stored) === normalizeDiscountCode(entered);
}

// ---------------------------------------------------------------------------
// Czysta kalkulacja
// ---------------------------------------------------------------------------

/** Powód odmowy — kod maszynowy; komunikat dla klienta idzie w `message`. */
export type DiscountRejectionReason =
  | "NOT_FOUND"
  | "INACTIVE"
  | "NOT_YET_VALID"
  | "EXPIRED"
  | "NO_AMOUNT"
  | "MIN_AMOUNT"
  | "MAX_USES"
  | "MAX_USES_PER_CUSTOMER"
  | "NO_EFFECT";

/**
 * Kod rabatowy w postaci niezależnej od Prismy — dzięki temu kalkulacja
 * jest testowalna bez bazy i bez generowanego klienta.
 */
export type DiscountCodeSnapshot = {
  id?: string;
  code: string;
  type: DiscountType;
  /** PERCENT: procent 1–100. AMOUNT: kwota w groszach. */
  value: number;
  minAmountCents: number | null;
  maxUses: number | null;
  /** 0 = bez limitu na klienta. */
  maxUsesPerCustomer: number;
  validFrom: Date | null;
  validTo: Date | null;
  isActive: boolean;
  currency?: string;
};

export type CalculateDiscountInput = {
  /** Kod z bazy; null = nie znaleziono. */
  code: DiscountCodeSnapshot | null;
  /** Kwota rezerwacji przed rabatem, w groszach. */
  subtotalCents: number;
  now: Date;
  /** Profil klienta — null dla gościa bez dopasowania w CRM. */
  customerId?: string | null;
  /** Ile razy TEN klient użył już tego kodu. */
  redemptionsByCustomer?: number;
  /** Ile razy kod został użyty w sumie (źródło prawdy: wiersze redemptions). */
  totalRedemptions?: number;
  /** Kod wpisany przez klienta — sprawdzany bez względu na wielkość liter. */
  enteredCode?: string;
};

export type DiscountCalculation =
  | { valid: true; discountCents: number; reason?: undefined; message?: undefined }
  | {
      valid: false;
      discountCents: 0;
      reason: DiscountRejectionReason;
      message: string;
    };

const formatMoney = (cents: number, currency = "PLN"): string =>
  new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);

const reject = (
  reason: DiscountRejectionReason,
  message: string,
): DiscountCalculation => ({ valid: false, discountCents: 0, reason, message });

/**
 * Ile złotówek (groszy) schodzi z rezerwacji po użyciu kodu.
 *
 * Funkcja CZYSTA — wszystkie liczniki użyć i „teraz" przychodzą z zewnątrz.
 * Kolejność sprawdzeń jest istotna: najpierw istnienie i stan kodu, potem
 * warunki kwotowe, na końcu limity użyć.
 */
export function calculateDiscount(
  input: CalculateDiscountInput,
): DiscountCalculation {
  const {
    code,
    subtotalCents,
    now,
    customerId = null,
    redemptionsByCustomer = 0,
    totalRedemptions = 0,
    enteredCode,
  } = input;

  if (!code) {
    return reject("NOT_FOUND", "Nie znamy takiego kodu rabatowego.");
  }
  if (enteredCode !== undefined && !discountCodeMatches(code.code, enteredCode)) {
    return reject("NOT_FOUND", "Nie znamy takiego kodu rabatowego.");
  }
  // Granice dat: validFrom działa od podanego instantu włącznie,
  // validTo obowiązuje do niego wyłącznie (o 00:00 kod już nie działa).
  // Wygaśnięcie sprawdzamy PRZED flagą `isActive`: kod archiwalny bywa
  // wyłączony i przeterminowany naraz, a klienta interesuje ta druga
  // informacja („stracił ważność"), nie stan przełącznika w panelu.
  if (code.validTo && now.getTime() >= code.validTo.getTime()) {
    return reject("EXPIRED", "Ten kod stracił ważność.");
  }
  if (!code.isActive) {
    return reject("INACTIVE", "Ten kod jest nieaktywny.");
  }
  if (code.validFrom && now.getTime() < code.validFrom.getTime()) {
    return reject("NOT_YET_VALID", "Ten kod jeszcze nie obowiązuje.");
  }
  if (subtotalCents <= 0) {
    return reject("NO_AMOUNT", "Ta rezerwacja nie ma kwoty do obniżenia.");
  }
  if (code.minAmountCents !== null && subtotalCents < code.minAmountCents) {
    return reject(
      "MIN_AMOUNT",
      `Kod działa od rezerwacji za ${formatMoney(code.minAmountCents, code.currency)}.`,
    );
  }
  if (code.maxUses !== null && totalRedemptions >= code.maxUses) {
    return reject("MAX_USES", "Pula użyć tego kodu została wyczerpana.");
  }
  // Limit per klient egzekwujemy tylko wtedy, gdy wiemy, kim jest klient —
  // dla gościa bez profilu CRM nie ma czego zliczać.
  if (
    code.maxUsesPerCustomer > 0 &&
    customerId !== null &&
    redemptionsByCustomer >= code.maxUsesPerCustomer
  ) {
    return reject(
      "MAX_USES_PER_CUSTOMER",
      code.maxUsesPerCustomer === 1
        ? "Ten kod można wykorzystać tylko raz — już z niego korzystałeś."
        : `Ten kod można wykorzystać ${code.maxUsesPerCustomer} razy — limit wyczerpany.`,
    );
  }

  const raw =
    code.type === "PERCENT"
      ? Math.floor((subtotalCents * Math.max(0, code.value)) / 100)
      : Math.max(0, code.value);
  // Rabat nigdy nie przekracza kwoty rezerwacji — cena ujemna nie istnieje.
  const discountCents = Math.min(raw, subtotalCents);

  if (discountCents <= 0) {
    return reject("NO_EFFECT", "Ten kod nie obniża ceny tej rezerwacji.");
  }
  return { valid: true, discountCents };
}

/** Etykieta wartości kodu na listach panelu: „20%" albo „50 zł". */
export function discountValueLabel(
  type: DiscountType,
  value: number,
  currency = "PLN",
): string {
  return type === "PERCENT" ? `${value}%` : formatMoney(value, currency);
}

// ---------------------------------------------------------------------------
// Warstwa bazodanowa (klient/transakcja przychodzi parametrem)
// ---------------------------------------------------------------------------

type Db = Prisma.TransactionClient;

/** Wynik odmowy z warstwy utrwalenia — mapowany na HTTP 422. */
export class DiscountRejectedError extends Error {
  constructor(
    readonly reason: DiscountRejectionReason,
    readonly userMessage: string,
  ) {
    super(reason);
    this.name = "DiscountRejectedError";
  }
}

const SNAPSHOT_SELECT = {
  id: true,
  code: true,
  type: true,
  value: true,
  minAmountCents: true,
  maxUses: true,
  maxUsesPerCustomer: true,
  validFrom: true,
  validTo: true,
  isActive: true,
} as const;

/**
 * Kod firmy po wpisanej wartości — porównanie bez względu na wielkość liter
 * (`mode: "insensitive"`) i po normalizacji białych znaków.
 */
export async function findDiscountCodeByEntry(
  db: Db,
  businessId: string,
  entered: string,
): Promise<(DiscountCodeSnapshot & { id: string }) | null> {
  const normalized = normalizeDiscountCode(entered);
  if (normalized.length === 0) return null;
  const record = await db.discountCode.findFirst({
    where: {
      businessId,
      code: { equals: normalized, mode: "insensitive" },
    },
    select: SNAPSHOT_SELECT,
  });
  return record ?? null;
}

export type DiscountEvaluation = {
  calculation: DiscountCalculation;
  code: (DiscountCodeSnapshot & { id: string }) | null;
};

/**
 * Pełna ocena kodu: znajdź go w firmie, policz liczniki użyć i przelicz.
 * Używana zarówno przez podgląd w checkoucie, jak i przez zapis rezerwacji
 * (tam pod advisory lockiem — patrz `redeemDiscountCode`).
 */
export async function evaluateDiscountCode(
  db: Db,
  input: {
    businessId: string;
    enteredCode: string;
    subtotalCents: number;
    customerId?: string | null;
    currency?: string;
    now?: Date;
  },
): Promise<DiscountEvaluation> {
  const now = input.now ?? new Date();
  const code = await findDiscountCodeByEntry(
    db,
    input.businessId,
    input.enteredCode,
  );
  if (!code) {
    return {
      code: null,
      calculation: calculateDiscount({
        code: null,
        subtotalCents: input.subtotalCents,
        now,
      }),
    };
  }

  const customerId = input.customerId ?? null;
  const [totalRedemptions, redemptionsByCustomer] = await Promise.all([
    db.discountRedemption.count({ where: { discountCodeId: code.id } }),
    customerId
      ? db.discountRedemption.count({
          where: { discountCodeId: code.id, customerId },
        })
      : Promise.resolve(0),
  ]);

  return {
    code,
    calculation: calculateDiscount({
      code: { ...code, currency: input.currency },
      subtotalCents: input.subtotalCents,
      now,
      customerId,
      redemptionsByCustomer,
      totalRedemptions,
      enteredCode: input.enteredCode,
    }),
  };
}

/**
 * Utrwalenie użycia kodu — MUSI lecieć w tej samej transakcji co tworzenie
 * rezerwacji.
 *
 * Trzy zabezpieczenia przed wyścigiem:
 *  1. advisory lock per kod — serializuje równoległe użycia tego samego kodu,
 *     dzięki czemu policzone liczniki są aktualne do końca transakcji,
 *  2. `updateMany` z warunkiem `usedCount < maxUses` — atomowy licznik;
 *     `count === 0` znaczy, że pula właśnie się wyczerpała,
 *  3. unikalny `bookingId` na DiscountRedemption — jedna rezerwacja nie
 *     zużyje kodu dwa razy.
 *
 * Zwraca kwotę rabatu do zapisania na rezerwacji; rzuca `DiscountRejectedError`
 * (→ 422), gdy kod nie przechodzi walidacji.
 */
export async function redeemDiscountCode(
  tx: Db,
  input: {
    businessId: string;
    enteredCode: string;
    subtotalCents: number;
    bookingId: string;
    customerId?: string | null;
    currency?: string;
    now?: Date;
  },
): Promise<{ discountCents: number; discountCodeId: string }> {
  const code = await findDiscountCodeByEntry(
    tx,
    input.businessId,
    input.enteredCode,
  );
  if (!code) {
    throw new DiscountRejectedError(
      "NOT_FOUND",
      "Nie znamy takiego kodu rabatowego.",
    );
  }

  // Serializacja użyć tego samego kodu do końca transakcji: bez tego dwa
  // równoległe żądania czytają ten sam licznik i oba przechodzą limit.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`discount:${code.id}`}))`;

  const { calculation } = await evaluateDiscountCode(tx, {
    businessId: input.businessId,
    enteredCode: input.enteredCode,
    subtotalCents: input.subtotalCents,
    customerId: input.customerId,
    currency: input.currency,
    now: input.now,
  });
  if (!calculation.valid) {
    throw new DiscountRejectedError(calculation.reason, calculation.message);
  }

  // Licznik utrwalony podnosimy warunkowo — nawet gdyby lock kiedyś zniknął,
  // limit globalny zostaje egzekwowany przez samą bazę.
  const bumped = await tx.discountCode.updateMany({
    where:
      code.maxUses === null
        ? { id: code.id }
        : { id: code.id, usedCount: { lt: code.maxUses } },
    data: { usedCount: { increment: 1 } },
  });
  if (bumped.count === 0) {
    throw new DiscountRejectedError(
      "MAX_USES",
      "Pula użyć tego kodu została wyczerpana.",
    );
  }

  await tx.discountRedemption.create({
    data: {
      discountCodeId: code.id,
      bookingId: input.bookingId,
      customerId: input.customerId ?? null,
      amountCents: calculation.discountCents,
    },
  });

  return { discountCents: calculation.discountCents, discountCodeId: code.id };
}
