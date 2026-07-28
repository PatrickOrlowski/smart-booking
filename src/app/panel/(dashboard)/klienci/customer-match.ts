import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

/**
 * Dopasowywanie gościa rezerwacji ręcznej do profilu CRM firmy.
 *
 * Recepcja wpisuje klienta „z ręki" — ten moduł pilnuje, żeby ta sama osoba
 * nie rozmnażała się w bazie: najpierw szukamy istniejącego wiersza Customer
 * po telefonie (porównanie po samych cyfrach) lub e-mailu (bez rozróżniania
 * wielkości liter), a dopiero gdy nic nie pasuje, zakładamy nowy profil.
 * Bez profilu nie działa historia wizyt ani polityka no-show.
 */

export type CustomerMatch = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  isBlocked: boolean;
  /** Konto powiązane z profilem — null dla profili z wizyt ręcznych. */
  userId: string | null;
};

/**
 * Klient Prisma albo transakcja: rezerwacja online zakłada profil w tej samej
 * transakcji co wizytę, więc nieudany zapis (zajęty slot) nie zostawia
 * osieroconego wiersza Customer.
 */
type Db = Prisma.TransactionClient;

const matchSelect = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  isBlocked: true,
  userId: true,
} as const;

/**
 * „+48 600-700 800", „0048600700800", „0600700800" → „600700800".
 *
 * Numer polski ma 9 cyfr znaczących, ale ten sam człowiek zapisuje się raz
 * z kierunkowym kraju, raz bez — recepcja wpisuje „+48 …", a formularz online
 * samo „600700800". Bez sprowadzenia do jednej postaci blokada nałożona
 * z panelu nie łapie rezerwacji podanej w innym formacie.
 * Numery spoza tego wzorca zostają jako same cyfry.
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const withoutCountry = digits.replace(/^(?:00)?48(?=\d{9}$)/, "");
  return withoutCountry.replace(/^0(?=\d{9}$)/, "");
}

/**
 * Zapisy tego samego numeru, jakich szukamy w bazie — kolumna `phone` trzyma
 * to, co ktoś wpisał, więc porównujemy jej cyfry z każdą wersją kanonicznej
 * postaci (bez kierunkowego, z 48, z 0048, z zerem międzymiastowym).
 */
function phoneDigitVariants(digits: string): string[] {
  if (digits.length !== 9) return [digits];
  return [digits, `48${digits}`, `0048${digits}`, `0${digits}`];
}

/**
 * Szuka klienta firmy po kontakcie. Telefon ma pierwszeństwo (najpewniejszy
 * identyfikator przy recepcji), e-mail jest zapasowy. Formaty numerów bywają
 * różne („600 700 800" vs „+48600700800"), więc telefon porównujemy po
 * cyfrach sprowadzonych do postaci kanonicznej, bezpośrednio w SQL
 * (regexp_replace) — działa deterministycznie niezależnie od liczby klientów
 * firmy, bez ładowania całego CRM do pamięci przy każdym wywołaniu.
 */
export async function findCustomerByContact(
  businessId: string,
  contact: { phone?: string | null; email?: string | null },
  db: Db = prisma,
): Promise<CustomerMatch | null> {
  const phoneDigits = contact.phone ? normalizePhone(contact.phone) : "";
  const email = contact.email?.trim() ?? "";

  if (phoneDigits.length >= 7) {
    const byPhone = await db.$queryRaw<CustomerMatch[]>`
      SELECT id,
             full_name  AS "fullName",
             email,
             phone,
             is_blocked AS "isBlocked",
             user_id    AS "userId"
      FROM customers
      WHERE business_id = ${businessId}
        AND phone IS NOT NULL
        AND regexp_replace(phone, '\\D', '', 'g') IN (${Prisma.join(
          phoneDigitVariants(phoneDigits),
        )})
      ORDER BY created_at ASC
      LIMIT 1
    `;
    if (byPhone[0]) return byPhone[0];
  }

  if (email.length >= 3) {
    const byEmail = await db.customer.findFirst({
      where: { businessId, email: { equals: email, mode: "insensitive" } },
      select: matchSelect,
      orderBy: { createdAt: "asc" },
    });
    if (byEmail) return byEmail;
  }

  return null;
}

/**
 * Znajduje albo zakłada profil klienta dla rezerwacji ręcznej.
 *
 * Zwraca null, gdy gość nie zostawił żadnego kontaktu — samo „Jan Kowalski"
 * nie daje się deduplikować i tworzyłoby martwy profil przy każdej wizycie.
 * Przy dopasowaniu uzupełniamy brakujący kanał kontaktu (np. klient znany
 * z telefonu podał przy okazji e-mail) — nigdy nie nadpisujemy istniejącego.
 */
export async function findOrCreateCustomerForBooking(
  businessId: string,
  guest: { name: string; phone?: string | null; email?: string | null },
  db: Db = prisma,
): Promise<{ id: string; matched: boolean } | null> {
  const phone = guest.phone?.trim() || null;
  const email = guest.email?.trim() || null;
  if (!phone && !email) return null;

  const existing = await findCustomerByContact(businessId, { phone, email }, db);
  if (existing) {
    const fill: { phone?: string; email?: string } = {};
    if (phone && !existing.phone) fill.phone = phone;
    if (email && !existing.email) fill.email = email;
    if (Object.keys(fill).length > 0) {
      await db.customer.update({ where: { id: existing.id }, data: fill });
    }
    return { id: existing.id, matched: true };
  }

  const created = await db.customer.create({
    data: { businessId, fullName: guest.name, phone, email },
    select: { id: true },
  });
  return { id: created.id, matched: false };
}

/**
 * Profil klienta dla rezerwacji zalogowanego użytkownika.
 *
 * Kolejność: profil już powiązany z kontem → profil kontaktowy z wizyt
 * ręcznych (userId = null) o tym samym telefonie/e-mailu, który wtedy
 * dowiązujemy do konta → dopiero na końcu nowy wiersz. Bez środkowego kroku
 * ten sam człowiek miał dwa profile w firmie: jeden z recepcji (z blokadą
 * i historią nieobecności) i drugi, czysty, zakładany przy pierwszej
 * rezerwacji online z konta.
 */
export async function findOrCreateCustomerForUser(
  businessId: string,
  userId: string,
  profile: { name?: string | null; phone?: string | null; email?: string | null },
  db: Db = prisma,
): Promise<string> {
  const byUser = await db.customer.findUnique({
    where: { businessId_userId: { businessId, userId } },
    select: { id: true },
  });
  if (byUser) return byUser.id;

  const phone = profile.phone?.trim() || null;
  const email = profile.email?.trim() || null;

  const existing = await findCustomerByContact(businessId, { phone, email }, db);
  if (existing && existing.userId === null) {
    // Strażnik userId = null w WHERE: równoległe dowiązanie nie nadpisze
    // cudzego konta na tym samym profilu.
    const linked = await db.customer.updateMany({
      where: { id: existing.id, userId: null },
      data: {
        userId,
        ...(phone && !existing.phone ? { phone } : {}),
        ...(email && !existing.email ? { email } : {}),
      },
    });
    if (linked.count > 0) return existing.id;
  }

  const customer = await db.customer.upsert({
    where: { businessId_userId: { businessId, userId } },
    update: {},
    create: {
      businessId,
      userId,
      fullName: profile.name?.trim() || "Klient",
      email,
      phone,
    },
    select: { id: true },
  });
  return customer.id;
}
