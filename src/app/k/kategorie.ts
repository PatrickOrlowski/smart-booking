import type { BusinessType } from "@/generated/prisma/enums";

/**
 * Mapa polskich slugów kategorii → typ firmy w bazie.
 * Slug jest częścią URL-a (/k/barber), więc bez polskich znaków.
 */

export type Kategoria = {
  type: BusinessType;
  /** Krótka nazwa — linki w stopce, chipy. */
  label: string;
  /** Nagłówek h1 strony kategorii. */
  heading: string;
  /** Opis do metadata description. */
  description: string;
};

export const KATEGORIE: Record<string, Kategoria> = {
  barber: {
    type: "BARBER",
    label: "Barber",
    heading: "Barberzy",
    description:
      "Strzyżenie męskie, modelowanie brody i golenie brzytwą. Znajdź barbera i zarezerwuj wizytę online.",
  },
  fryzjer: {
    type: "HAIR_SALON",
    label: "Fryzjer",
    heading: "Fryzjerzy",
    description:
      "Strzyżenie, koloryzacja i stylizacja włosów. Znajdź salon fryzjerski i zarezerwuj wizytę online.",
  },
  uroda: {
    type: "BEAUTY",
    label: "Uroda",
    heading: "Salony urody",
    description:
      "Kosmetyka, makijaż i pielęgnacja. Znajdź salon urody i zarezerwuj wizytę online.",
  },
  paznokcie: {
    type: "NAILS",
    label: "Paznokcie",
    heading: "Stylizacja paznokci",
    description:
      "Manicure, pedicure i stylizacja paznokci. Znajdź salon i zarezerwuj wizytę online.",
  },
  spa: {
    type: "SPA",
    label: "SPA",
    heading: "SPA i masaże",
    description:
      "Masaże, rytuały i strefy relaksu. Znajdź SPA i zarezerwuj wizytę online.",
  },
  tatuaz: {
    type: "TATTOO",
    label: "Tatuaż",
    heading: "Studia tatuażu",
    description:
      "Tatuaż i piercing. Znajdź studio tatuażu i zarezerwuj termin online.",
  },
  fitness: {
    type: "FITNESS",
    label: "Fitness",
    heading: "Fitness i treningi",
    description:
      "Treningi personalne, zajęcia grupowe i siłownie. Zarezerwuj trening online.",
  },
  moto: {
    type: "AUTO_SERVICE",
    label: "Moto",
    heading: "Warsztaty i serwisy",
    description:
      "Serwis samochodowy, wulkanizacja i detailing. Umów wizytę w warsztacie online.",
  },
  zdrowie: {
    type: "MEDICAL",
    label: "Zdrowie",
    heading: "Zdrowie i gabinety",
    description:
      "Gabinety lekarskie, fizjoterapia i diagnostyka. Umów wizytę online.",
  },
  restauracje: {
    type: "RESTAURANT",
    label: "Restauracje",
    heading: "Restauracje",
    description:
      "Zarezerwuj stolik w restauracji — szybko i bez telefonu.",
  },
};

export const KATEGORIA_SLUGS = Object.keys(KATEGORIE);
