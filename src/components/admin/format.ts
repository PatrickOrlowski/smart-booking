import type {
  BookingStatus,
  BusinessStatus,
  ReportStatus,
  ReportTargetType,
  UserRole,
} from "@/generated/prisma/enums";

/**
 * Etykiety i tony pigułek panelu administratora.
 * Moduł bez zależności serwerowych — bezpieczny w komponentach klienckich.
 *
 * Czas: panel admina patrzy na całą platformę, a nie na jedną lokalizację,
 * więc listy formatują daty w strefie operacyjnej platformy
 * (`PLATFORM_TIMEZONE`). Widoki dotyczące jednej firmy używają strefy jej
 * lokalizacji — tak jak reszta aplikacji.
 */

export const PLATFORM_TIMEZONE = "Europe/Warsaw";

export const BUSINESS_STATUS_LABELS: Record<BusinessStatus, string> = {
  DRAFT: "Szkic",
  PENDING_REVIEW: "Czeka na weryfikację",
  ACTIVE: "Aktywna",
  SUSPENDED: "Zawieszona",
};

/** Krótsza forma na wąskie pigułki w listach. */
export const BUSINESS_STATUS_SHORT: Record<BusinessStatus, string> = {
  DRAFT: "Szkic",
  PENDING_REVIEW: "Weryfikacja",
  ACTIVE: "Aktywna",
  SUSPENDED: "Zawieszona",
};

export const BUSINESS_STATUS_TONES: Record<BusinessStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  PENDING_REVIEW: "bg-warning-soft text-warning-strong",
  ACTIVE: "bg-success-soft text-primary dark:text-accent-foreground",
  SUSPENDED: "bg-destructive/10 text-destructive",
};

export const BUSINESS_STATUS_ORDER = [
  "PENDING_REVIEW",
  "ACTIVE",
  "DRAFT",
  "SUSPENDED",
] as const satisfies readonly BusinessStatus[];

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  OPEN: "Nowe",
  IN_REVIEW: "W toku",
  RESOLVED: "Rozpatrzone",
  REJECTED: "Odrzucone",
};

export const REPORT_STATUS_TONES: Record<ReportStatus, string> = {
  OPEN: "bg-destructive/10 text-destructive",
  IN_REVIEW: "bg-warning-soft text-warning-strong",
  RESOLVED: "bg-success-soft text-primary dark:text-accent-foreground",
  REJECTED: "bg-muted text-muted-foreground",
};

export const REPORT_STATUS_ORDER = [
  "OPEN",
  "IN_REVIEW",
  "RESOLVED",
  "REJECTED",
] as const satisfies readonly ReportStatus[];

export const REPORT_TARGET_LABELS: Record<ReportTargetType, string> = {
  BUSINESS: "Firma",
  REVIEW: "Opinia",
  USER: "Użytkownik",
};

export const REPORT_TARGET_ORDER = [
  "BUSINESS",
  "REVIEW",
  "USER",
] as const satisfies readonly ReportTargetType[];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  CUSTOMER: "Klient",
  BUSINESS_OWNER: "Właściciel firmy",
  STAFF: "Pracownik",
  PLATFORM_ADMIN: "Administrator platformy",
};

/** Krótkie warianty do wąskich pigułek w listach. */
export const USER_ROLE_SHORT: Record<UserRole, string> = {
  CUSTOMER: "Klient",
  BUSINESS_OWNER: "Właściciel",
  STAFF: "Pracownik",
  PLATFORM_ADMIN: "Administrator",
};

export const USER_ROLE_TONES: Record<UserRole, string> = {
  CUSTOMER: "bg-muted text-muted-foreground",
  BUSINESS_OWNER: "bg-accent text-accent-foreground",
  STAFF: "bg-secondary text-secondary-foreground",
  PLATFORM_ADMIN: "bg-warning-soft text-warning-strong",
};

export const USER_ROLE_ORDER = [
  "CUSTOMER",
  "BUSINESS_OWNER",
  "STAFF",
  "PLATFORM_ADMIN",
] as const satisfies readonly UserRole[];

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: "Oczekuje",
  CONFIRMED: "Potwierdzona",
  COMPLETED: "Zakończona",
  CANCELLED_BY_CUSTOMER: "Odwołana przez klienta",
  CANCELLED_BY_BUSINESS: "Odwołana przez firmę",
  NO_SHOW: "Nieobecność",
};

export const BOOKING_STATUS_TONES: Record<BookingStatus, string> = {
  PENDING: "bg-warning-soft text-warning-strong",
  CONFIRMED: "bg-success-soft text-primary dark:text-accent-foreground",
  COMPLETED: "bg-muted text-foreground/80",
  CANCELLED_BY_CUSTOMER: "bg-destructive/10 text-destructive",
  CANCELLED_BY_BUSINESS: "bg-destructive/10 text-destructive",
  NO_SHOW: "bg-destructive/10 text-destructive",
};

/**
 * Dozwolone przejścia statusu zgłoszenia. Rozpatrzone i odrzucone da się
 * wznowić (wraca do „w toku"), ale nie da się przeskoczyć z „rozpatrzone"
 * wprost do „odrzucone" — historia decyzji ma być czytelna.
 */
export const REPORT_TRANSITIONS: Record<ReportStatus, readonly ReportStatus[]> = {
  OPEN: ["IN_REVIEW", "RESOLVED", "REJECTED"],
  IN_REVIEW: ["RESOLVED", "REJECTED"],
  RESOLVED: ["IN_REVIEW"],
  REJECTED: ["IN_REVIEW"],
};

/** Statusy, przy których zgłoszenie nadal czeka na człowieka. */
export const OPEN_REPORT_STATUSES = ["OPEN", "IN_REVIEW"] as const;

/** Formatter daty i godziny w strefie platformy (albo podanej). */
export function adminDateTimeFormatter(
  timeZone: string = PLATFORM_TIMEZONE,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

/** Formatter samej daty w strefie platformy (albo podanej). */
export function adminDateFormatter(
  timeZone: string = PLATFORM_TIMEZONE,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  });
}

/**
 * Etykiety wpisów AuditLog widocznych w panelu admina. Dziennik firmy ma
 * własny słownik w panelu firmy — tutaj dokładamy akcje platformowe, których
 * właściciel nie generuje, i zostawiamy czytelny fallback dla reszty.
 */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  BUSINESS_VERIFIED: "Firma zweryfikowana",
  BUSINESS_REJECTED: "Zgłoszenie odrzucone",
  BUSINESS_SUSPENDED: "Firma zawieszona",
  BUSINESS_RESTORED: "Firma przywrócona",
  REVIEW_HIDDEN: "Opinia ukryta",
  REVIEW_RESTORED: "Opinia przywrócona",
  REPORT_STATUS_CHANGED: "Zgłoszenie — zmiana statusu",
  USER_ROLE_CHANGED: "Zmiana roli konta",
  PAYMENT_PAID: "Płatność opłacona",
  PAYMENT_REFUNDED: "Zwrot płatności",
  PLAN_CHANGED: "Zmiana planu",
  BOOKING_CREATED: "Nowa rezerwacja",
  BOOKING_CONFIRMED: "Rezerwacja potwierdzona",
  BOOKING_COMPLETED: "Wizyta zakończona",
  BOOKING_CANCELLED: "Wizyta odwołana",
  BOOKING_NO_SHOW: "Nieobecność klienta",
  CUSTOMER_BLOCKED: "Klient zablokowany",
  CUSTOMER_UNBLOCKED: "Klient odblokowany",
  SERVICE_CREATED: "Usługa dodana",
  SERVICE_UPDATED: "Usługa zmieniona",
  SERVICE_DELETED: "Usługa usunięta",
  STAFF_DEACTIVATED: "Pracownik dezaktywowany",
  DATA_EXPORTED: "Eksport danych",
};

export function auditActionLabel(action: string): string {
  const known = AUDIT_ACTION_LABELS[action];
  if (known) return known;
  const pretty = action.replaceAll("_", " ").toLowerCase();
  return pretty.charAt(0).toUpperCase() + pretty.slice(1);
}

/** Ton pigułki wpisu audytu: negatywny / pozytywny / neutralny. */
export function auditActionTone(action: string): string {
  if (/CANCELLED|NO_SHOW|BLOCKED|DELETED|FAILED|SUSPENDED|REJECTED|HIDDEN/.test(action)) {
    return "bg-destructive/10 text-destructive";
  }
  if (/PAID|CONFIRMED|COMPLETED|CREATED|UNBLOCKED|VERIFIED|RESTORED/.test(action)) {
    return "bg-success-soft text-primary dark:text-accent-foreground";
  }
  return "bg-muted text-foreground/80";
}

/** Metadata (JSON) → krótkie pary „klucz: wartość" do wiersza dziennika. */
export function auditDetails(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [];
  }
  const details: string[] = [];
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    if (/Id$/.test(key)) continue;
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      continue;
    }
    const text = String(value);
    details.push(`${key}: ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`);
  }
  return details.slice(0, 4);
}

/** "3 firmy" z polską odmianą liczebnika. */
export function pluralize(
  count: number,
  one: string,
  few: string,
  many: string,
): string {
  if (count === 1) return `${count} ${one}`;
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} ${few}`;
  }
  return `${count} ${many}`;
}

/**
 * Buduje URL listy z zachowaniem pozostałych filtrów.
 * Pusta wartość usuwa parametr, każda zmiana filtra resetuje stronicowanie.
 */
export function filterHref(
  basePath: string,
  current: Record<string, string | undefined>,
  changes: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  const merged = { ...current, ...changes, strona: undefined };
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/** URL strony `page` z zachowaniem wszystkich filtrów. */
export function pageHref(
  basePath: string,
  current: Record<string, string | undefined>,
  page: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (value && key !== "strona") params.set(key, value);
  }
  if (page > 1) params.set("strona", String(page));
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}
