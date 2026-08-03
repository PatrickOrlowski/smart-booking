import type { BusinessType } from "@/generated/prisma/enums";
import type { Locale } from "@/i18n/config";

/**
 * Mapa polskich slugów kategorii → typ firmy w bazie.
 * Slug jest częścią URL-a (/k/barber), więc bez polskich znaków i wspólny
 * dla obu języków — tłumaczone są tylko etykiety/nagłówki/opisy.
 */

type Localized = Record<Locale, string>;

export type Kategoria = {
  type: BusinessType;
  /** Krótka nazwa — linki w stopce, chipy. */
  label: Localized;
  /** Nagłówek h1 strony kategorii. */
  heading: Localized;
  /** Opis do metadata description. */
  description: Localized;
};

export const kategoriaLabel = (entry: Kategoria, locale: Locale): string =>
  entry.label[locale];
export const kategoriaHeading = (entry: Kategoria, locale: Locale): string =>
  entry.heading[locale];
export const kategoriaDescription = (
  entry: Kategoria,
  locale: Locale,
): string => entry.description[locale];

export const KATEGORIE: Record<string, Kategoria> = {
  barber: {
    type: "BARBER",
    label: { pl: "Barber", en: "Barber" },
    heading: { pl: "Barberzy", en: "Barbers" },
    description: {
      pl: "Strzyżenie męskie, modelowanie brody i golenie brzytwą. Znajdź barbera i zarezerwuj wizytę online.",
      en: "Men's haircuts, beard trims and straight-razor shaves. Find a barber and book online.",
    },
  },
  fryzjer: {
    type: "HAIR_SALON",
    label: { pl: "Fryzjer", en: "Hair" },
    heading: { pl: "Fryzjerzy", en: "Hair salons" },
    description: {
      pl: "Strzyżenie, koloryzacja i stylizacja włosów. Znajdź salon fryzjerski i zarezerwuj wizytę online.",
      en: "Haircuts, colouring and styling. Find a hair salon and book online.",
    },
  },
  uroda: {
    type: "BEAUTY",
    label: { pl: "Uroda", en: "Beauty" },
    heading: { pl: "Salony urody", en: "Beauty salons" },
    description: {
      pl: "Kosmetyka, makijaż i pielęgnacja. Znajdź salon urody i zarezerwuj wizytę online.",
      en: "Cosmetics, make-up and skincare. Find a beauty salon and book online.",
    },
  },
  paznokcie: {
    type: "NAILS",
    label: { pl: "Paznokcie", en: "Nails" },
    heading: { pl: "Stylizacja paznokci", en: "Nail styling" },
    description: {
      pl: "Manicure, pedicure i stylizacja paznokci. Znajdź salon i zarezerwuj wizytę online.",
      en: "Manicure, pedicure and nail styling. Find a salon and book online.",
    },
  },
  spa: {
    type: "SPA",
    label: { pl: "SPA", en: "SPA" },
    heading: { pl: "SPA i masaże", en: "SPA & massage" },
    description: {
      pl: "Masaże, rytuały i strefy relaksu. Znajdź SPA i zarezerwuj wizytę online.",
      en: "Massages, rituals and relaxation. Find a spa and book online.",
    },
  },
  tatuaz: {
    type: "TATTOO",
    label: { pl: "Tatuaż", en: "Tattoo" },
    heading: { pl: "Studia tatuażu", en: "Tattoo studios" },
    description: {
      pl: "Tatuaż i piercing. Znajdź studio tatuażu i zarezerwuj termin online.",
      en: "Tattoos and piercing. Find a tattoo studio and book online.",
    },
  },
  fitness: {
    type: "FITNESS",
    label: { pl: "Fitness", en: "Fitness" },
    heading: { pl: "Fitness i treningi", en: "Fitness & training" },
    description: {
      pl: "Treningi personalne, zajęcia grupowe i siłownie. Zarezerwuj trening online.",
      en: "Personal training, group classes and gyms. Book a session online.",
    },
  },
  moto: {
    type: "AUTO_SERVICE",
    label: { pl: "Moto", en: "Auto" },
    heading: { pl: "Warsztaty i serwisy", en: "Garages & services" },
    description: {
      pl: "Serwis samochodowy, wulkanizacja i detailing. Umów wizytę w warsztacie online.",
      en: "Car servicing, tyres and detailing. Book a garage visit online.",
    },
  },
  zdrowie: {
    type: "MEDICAL",
    label: { pl: "Zdrowie", en: "Health" },
    heading: { pl: "Zdrowie i gabinety", en: "Health & clinics" },
    description: {
      pl: "Gabinety lekarskie, fizjoterapia i diagnostyka. Umów wizytę online.",
      en: "Medical practices, physiotherapy and diagnostics. Book online.",
    },
  },
  restauracje: {
    type: "RESTAURANT",
    label: { pl: "Restauracje", en: "Restaurants" },
    heading: { pl: "Restauracje", en: "Restaurants" },
    description: {
      pl: "Zarezerwuj stolik w restauracji — szybko i bez telefonu.",
      en: "Book a restaurant table — fast and without a phone call.",
    },
  },
};

export const KATEGORIA_SLUGS = Object.keys(KATEGORIE);
