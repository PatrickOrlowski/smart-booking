/**
 * Typowany klient REST API plannera (src/app/api/v1/** w korzeniu repo).
 *
 * Kształty odpowiedzi i kody błędów są przepisane 1:1 z route handlerów —
 * przy zmianie kontraktu aktualizuj oba końce. Wszystkie czasy z API są
 * w UTC (ISO 8601); prezentację w strefie lokalu robi UI na bazie pola
 * `timezone` z odpowiedzi.
 */

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

/* ------------------------------------------------------------------ */
/* Błędy                                                               */
/* ------------------------------------------------------------------ */

/** Kody błędów zwracane przez API (pole `error` w body). */
export type ApiErrorCode =
  | "BAD_REQUEST" // 400
  | "VALIDATION" // 422 (z issues[])
  | "NOT_FOUND" // 404
  | "FORBIDDEN" // 403 — cudza rezerwacja / zły e-mail gościa
  | "SLOT_TAKEN" // 409 — termin zajęty przez rezerwację
  | "SLOT_HELD" // 409 — termin trzyma cudzy hold (sam wygaśnie)
  | "HOLD_EXPIRED" // 409 — hold wygasł w trakcie checkoutu
  | "HOLD_INVALID" // 422 — token nie pasuje do slotu / już zużyty
  | "TOO_MANY_HOLDS" // 429 — limity anty-abuse holdów
  | "INVALID_STATE" // 422 — wizyty nie można już anulować
  | "CUTOFF_PASSED" // 422 — minął termin bezpłatnego odwołania
  | "INTERNAL" // 500
  | "NETWORK"; // fetch się nie powiódł (offline, zły URL)

export type ValidationIssue = { path: string; message: string };

/**
 * Każdy nie-2xx (i błąd sieci) wychodzi z klienta jako ApiError.
 * `message` jest po polsku i pochodzi z API — można go pokazywać
 * użytkownikowi bez tłumaczenia.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(
      0,
      "NETWORK",
      "Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.",
    );
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // brak JSON-a w body — obsłużone niżej
  }

  if (!response.ok) {
    const errorBody = (body ?? {}) as {
      error?: string;
      message?: string;
      issues?: ValidationIssue[];
    };
    throw new ApiError(
      response.status,
      (errorBody.error as ApiErrorCode) ?? "INTERNAL",
      errorBody.message ?? "Coś poszło nie tak. Spróbuj ponownie.",
      errorBody.issues ?? [],
    );
  }

  return body as T;
}

/* ------------------------------------------------------------------ */
/* Typy domenowe (zgodne z odpowiedziami API)                          */
/* ------------------------------------------------------------------ */

export type BusinessType =
  | "BARBER"
  | "HAIR_SALON"
  | "BEAUTY"
  | "NAILS"
  | "SPA"
  | "TATTOO"
  | "FITNESS"
  | "AUTO_SERVICE"
  | "MEDICAL"
  | "RESTAURANT"
  | "OTHER";

export type PriceType = "FIXED" | "FROM" | "FREE" | "ON_REQUEST";

export type BookingStatus =
  | "PENDING"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELLED_BY_CUSTOMER"
  | "CANCELLED_BY_BUSINESS"
  | "NO_SHOW";

/** GET /api/v1/businesses */
export type BusinessListItem = {
  id: string;
  slug: string;
  name: string;
  type: BusinessType;
  description: string | null;
  locations: {
    id: string;
    name: string;
    addressLine1: string;
    city: string;
    timezone: string;
  }[];
  /** Cena najtańszej usługi rezerwowalnej online (grosze) — null, gdy brak. */
  priceFromCents: number | null;
  currency: string;
};

export type BusinessesResponse = { businesses: BusinessListItem[] };

/** GET /api/v1/businesses/[slug] */
export type BusinessService = {
  id: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  priceType: PriceType;
  currency: string;
  onlineBookable: boolean;
};

export type BusinessResource = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  staffProfile: { title: string | null; bio: string | null } | null;
};

export type BusinessLocation = {
  id: string;
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  postalCode: string | null;
  phone: string | null;
  timezone: string;
  cancellationCutoffHours: number;
  openingHours: { weekday: number; startMinute: number; endMinute: number }[];
  resources: BusinessResource[];
};

export type BusinessDetail = {
  id: string;
  slug: string;
  name: string;
  type: BusinessType;
  description: string | null;
  categories: { id: string; name: string; sortOrder: number }[];
  services: BusinessService[];
  locations: BusinessLocation[];
  rating: { average: number | null; count: number };
};

export type BusinessResponse = { business: BusinessDetail };

/** GET /api/v1/businesses/[slug]/availability */
export type AvailabilityResponse = {
  date: string; // YYYY-MM-DD (dzień lokalny lokalu)
  timezone: string;
  slotGranularityMin: number;
  service: { id: string; name: string; durationMin: number };
  /** Widok scalony („dowolny pracownik"). */
  slots: { startAt: string; resourceIds: string[] }[];
  perResource: {
    resourceId: string;
    slots: { startAt: string; endAt: string }[];
  }[];
};

/** POST /api/v1/holds (201) */
export type Hold = {
  token: string;
  expiresAt: string;
  ttlMinutes: number;
  resourceId: string;
  resourceName: string;
  startAt: string;
  endAt: string;
  timezone: string;
};

export type HoldResponse = { hold: Hold };

/** POST /api/v1/bookings (201) */
export type CreatedBooking = {
  id: string;
  status: BookingStatus;
  startAt: string;
  endAt: string;
  durationMin: number;
  priceCents: number;
  currency: string;
  serviceName: string;
  resourceId: string;
  resourceName: string;
  businessName: string;
  address: string;
  timezone: string;
  cancellationCutoffHours: number;
  cancellationDeadline: string;
};

/**
 * Zadatek utworzony do rezerwacji (usługa z `depositRequired`) — null, gdy
 * usługa go nie wymaga. `redirectUrl` (Stripe Checkout) przychodzi tylko,
 * gdy płatność online jest włączona; provider MANUAL = zapłata na miejscu.
 */
export type BookingPayment = {
  amountCents: number;
  currency: string;
  provider: string;
  status: string;
  redirectUrl?: string;
};

export type BookingResponse = {
  booking: CreatedBooking;
  payment: BookingPayment | null;
};

/** GET /api/v1/bookings/[id]?email= */
export type BookingDetail = {
  id: string;
  status: BookingStatus;
  startAt: string;
  endAt: string;
  durationMin: number | null;
  serviceName: string | null;
  resourceName: string | null;
  priceCents: number;
  currency: string;
  businessName: string;
  businessSlug: string;
  /** Pełny adres lokalu: „Marszałkowska 10, 00-590 Warszawa". */
  address: string;
  city: string;
  phone: string | null;
  timezone: string;
  cancellationCutoffHours: number;
  cancellationDeadline: string;
  cancelledAt: string | null;
};

export type BookingDetailResponse = { booking: BookingDetail };

/** POST /api/v1/bookings/[id]/cancel */
export type CancelBookingResponse = {
  booking: {
    id: string;
    status: "CANCELLED_BY_CUSTOMER";
    cancelledAt: string;
  };
};

/* ------------------------------------------------------------------ */
/* Wywołania                                                           */
/* ------------------------------------------------------------------ */

/** Lista aktywnych firm; `q` filtruje po nazwie/mieście, `city` po mieście. */
export function getBusinesses(q?: string, city?: string) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (city) params.set("city", city);
  const query = params.toString();
  return request<BusinessesResponse>(
    `/api/v1/businesses${query ? `?${query}` : ""}`,
  );
}

/** Publiczny profil firmy: usługi, zespół, lokalizacje, ocena. */
export function getBusiness(slug: string) {
  return request<BusinessResponse>(
    `/api/v1/businesses/${encodeURIComponent(slug)}`,
  );
}

/** Wolne sloty na jeden dzień (bez resourceId = „dowolny pracownik"). */
export function getAvailability(
  slug: string,
  options: { serviceId: string; date: string; resourceId?: string },
) {
  const params = new URLSearchParams({
    serviceId: options.serviceId,
    date: options.date,
  });
  if (options.resourceId) params.set("resourceId", options.resourceId);
  return request<AvailabilityResponse>(
    `/api/v1/businesses/${encodeURIComponent(slug)}/availability?${params}`,
  );
}

/**
 * Blokada slotu na czas checkoutu (TTL 10 min). Bez `resourceId` zasób
 * wybiera serwer i zwraca go w odpowiedzi. Token przekazuje się dalej
 * do createBooking(); porzucenie checkoutu = releaseHold().
 */
export function createHold(input: {
  businessSlug: string;
  serviceId: string;
  resourceId?: string;
  /** ISO 8601 UTC, dokładnie wartość `startAt` ze slotu availability. */
  startAt: string;
}) {
  return request<HoldResponse>(`/api/v1/holds`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Zwolnienie holda — idempotentne (wygasły/nieznany token to nadal sukces). */
export function releaseHold(token: string) {
  return request<{ released: boolean }>(
    `/api/v1/holds/${encodeURIComponent(token)}`,
    { method: "DELETE" },
  );
}

/**
 * Utworzenie rezerwacji. Gość podaje `guest`; `holdToken` z createHold()
 * jest konsumowany w tej samej transakcji. Konflikty: 409 SLOT_TAKEN /
 * SLOT_HELD / HOLD_EXPIRED, 422 HOLD_INVALID.
 */
export function createBooking(input: {
  businessSlug: string;
  serviceId: string;
  resourceId?: string;
  startAt: string;
  holdToken?: string;
  guest?: { name: string; email: string; phone: string };
  customerNote?: string;
}) {
  return request<BookingResponse>(`/api/v1/bookings`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Szczegóły rezerwacji. Tożsamość potwierdza e-mail z rezerwacji —
 * brak lub niezgodny → 403 FORBIDDEN (API nie ujawnia wtedy niczego).
 */
export function getBooking(id: string, email: string) {
  return request<BookingDetailResponse>(
    `/api/v1/bookings/${encodeURIComponent(id)}?email=${encodeURIComponent(email)}`,
  );
}

/**
 * Anulowanie rezerwacji przez klienta. Gość potwierdza tożsamość e-mailem
 * z rezerwacji (zły e-mail → 403 FORBIDDEN). Po cutoffie → 422 CUTOFF_PASSED.
 */
export function cancelBooking(id: string, email: string, reason?: string) {
  return request<CancelBookingResponse>(
    `/api/v1/bookings/${encodeURIComponent(id)}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({ email, ...(reason ? { reason } : {}) }),
    },
  );
}
