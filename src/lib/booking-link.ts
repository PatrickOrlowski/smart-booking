import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Podpisany link do zarządzania rezerwacją gościa.
 *
 * Gość nie ma konta, więc e-mail z potwierdzeniem nie może kierować go na
 * profil firmy z instrukcją „anuluj wizytę z wyprzedzeniem" — nie miał gdzie
 * tego zrobić. Token to HMAC z identyfikatora rezerwacji i adresu e-mail:
 * nie da się go zgadnąć, nie trzeba go trzymać w bazie, a zmiana adresu
 * unieważnia stare linki.
 */

const TOKEN_LENGTH = 32;

const normalize = (email: string) => email.trim().toLowerCase();

export function bookingManageToken(bookingId: string, email: string): string {
  return createHmac("sha256", env.AUTH_SECRET)
    .update(`booking-manage:${bookingId}:${normalize(email)}`)
    .digest("base64url")
    .slice(0, TOKEN_LENGTH);
}

export function verifyBookingManageToken(
  bookingId: string,
  email: string,
  token: string,
): boolean {
  const expected = Buffer.from(bookingManageToken(bookingId, email));
  const given = Buffer.from(token);
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

const appUrl = () => env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

/** Pełny adres strony zarządzania rezerwacją gościa. */
export function bookingManageUrl(bookingId: string, email: string): string {
  return `${appUrl()}/wizyta/${bookingId}?t=${bookingManageToken(bookingId, email)}`;
}

/**
 * CTA dla klienta w e-mailu: konto dla zalogowanych, podpisany link dla
 * gości, a w ostateczności profil firmy (rezerwacja bez adresu e-mail).
 */
export function customerBookingUrl(options: {
  bookingId: string;
  hasAccount: boolean;
  email: string | null;
  businessSlug: string;
}): string {
  if (options.hasAccount) return `${appUrl()}/konto`;
  if (options.email) return bookingManageUrl(options.bookingId, options.email);
  return `${appUrl()}/b/${options.businessSlug}`;
}
