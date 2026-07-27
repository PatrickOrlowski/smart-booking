import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type {
  BookingStatus,
  BusinessType,
  StaffRole,
  SubscriptionPlan,
} from "../src/generated/prisma/enums";
import { addMinutes, localDayMinutesToUtc } from "../src/lib/time";

/**
 * Dane demo: realistyczny marketplace — 10 firm w 3 miastach, rynkowe ceny,
 * grafiki, historia wizyt i opinie. Seed jest idempotentny: usuwa firmy
 * o seedowanych slugach i tworzy je od nowa; konta userów są upsertowane.
 *
 * Konta demo (hasło wszędzie: haslo1234):
 *   wlasciciel@demo.pl — owner Cut & Shave (panel firmy)
 *   adam@demo.pl       — pracownik Cut & Shave (panel pracownika)
 *   klient@demo.pl     — Anna Lewandowska (konto klienta)
 */

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Brak DATABASE_URL / DIRECT_URL w środowisku");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const TIMEZONE = "Europe/Warsaw";
const DEMO_PASSWORD = "haslo1234";
const DAY_MS = 24 * 60 * 60 * 1000;

const hhmm = (hours: number, minutes = 0) => hours * 60 + minutes;
const zl = (amount: number) => Math.round(amount * 100);

// pon–pt 9–19, sob 9–15
const standardOpening = [
  ...[0, 1, 2, 3, 4].map((weekday) => ({
    weekday,
    startMinute: hhmm(9),
    endMinute: hhmm(19),
  })),
  { weekday: 5, startMinute: hhmm(9), endMinute: hhmm(15) },
];

const fullWeekHours = (start: number, end: number, days: number[]) =>
  days.map((weekday) => ({ weekday, startMinute: start, endMinute: end }));

type SeedService = {
  name: string;
  durationMin: number;
  priceCents: number;
  priceType?: "FIXED" | "FROM" | "FREE" | "ON_REQUEST";
  bufferAfterMin?: number;
  depositCents?: number;
};

type SeedBusiness = {
  slug: string;
  name: string;
  type: BusinessType;
  description: string;
  ownerEmail: string;
  ownerName: string;
  plan?: SubscriptionPlan;
  location: {
    name: string;
    address: string;
    city: string;
    postal: string;
    phone: string;
    lat: number;
    lng: number;
  };
  opening?: { weekday: number; startMinute: number; endMinute: number }[];
  staff: {
    name: string;
    title: string;
    role?: StaffRole;
    hours: { weekday: number; startMinute: number; endMinute: number }[];
  }[];
  categories: { name: string; services: SeedService[] }[];
  /// Opinie — każda tworzy zakończoną wizytę w przeszłości.
  reviews: {
    clientIdx: number;
    rating: number;
    comment: string;
    reply?: string;
    daysAgo: number;
  }[];
};

const CLIENTS = [
  { name: "Anna Lewandowska", email: "klient@demo.pl", phone: "+48 600 700 800" },
  { name: "Michał Dąbrowski", email: "michal.dabrowski@example.com", phone: "+48 512 334 556" },
  { name: "Karolina Wójcik", email: "karolina.wojcik@example.com", phone: "+48 693 221 908" },
  { name: "Piotr Kamiński", email: "piotr.kaminski@example.com", phone: "+48 505 617 442" },
  { name: "Magdalena Zając", email: "magda.zajac@example.com", phone: "+48 728 903 115" },
  { name: "Tomasz Nowicki", email: "tomasz.nowicki@example.com", phone: "+48 501 202 303" },
];

const BUSINESSES: SeedBusiness[] = [
  {
    slug: "cut-and-shave-warszawa",
    name: "Cut & Shave",
    type: "BARBER",
    description:
      "Klasyczny barber shop na Mokotowie. Strzyżenie maszynką i nożyczkami, modelowanie brody, golenie brzytwą. Umów się online — bez dzwonienia.",
    ownerEmail: "wlasciciel@demo.pl",
    ownerName: "Marek Kowalski",
    plan: "PRO",
    location: {
      name: "Cut & Shave Mokotów",
      address: "ul. Puławska 42",
      city: "Warszawa",
      postal: "02-508",
      phone: "+48 500 100 200",
      lat: 52.1936,
      lng: 21.0245,
    },
    staff: [
      {
        name: "Adam Nowak",
        title: "Barber senior",
        role: "MANAGER",
        hours: [
          ...fullWeekHours(hhmm(9), hhmm(17), [0, 1, 2, 3, 4]),
          { weekday: 5, startMinute: hhmm(9), endMinute: hhmm(15) },
        ],
      },
      {
        name: "Kuba Wiśniewski",
        title: "Barber",
        hours: fullWeekHours(hhmm(11), hhmm(19), [1, 2, 3, 4]),
      },
      {
        name: "Olek Zieliński",
        title: "Barber junior",
        hours: [
          { weekday: 0, startMinute: hhmm(9), endMinute: hhmm(13) },
          { weekday: 0, startMinute: hhmm(14), endMinute: hhmm(18) },
          { weekday: 2, startMinute: hhmm(9), endMinute: hhmm(13) },
          { weekday: 2, startMinute: hhmm(14), endMinute: hhmm(18) },
          { weekday: 4, startMinute: hhmm(10), endMinute: hhmm(18) },
        ],
      },
    ],
    categories: [
      {
        name: "Strzyżenie",
        services: [
          { name: "Strzyżenie męskie", durationMin: 45, priceCents: zl(90) },
          { name: "Strzyżenie maszynką", durationMin: 30, priceCents: zl(60) },
          { name: "Strzyżenie + broda", durationMin: 75, priceCents: zl(140), bufferAfterMin: 10 },
          { name: "Strzyżenie dziecięce", durationMin: 30, priceCents: zl(50) },
        ],
      },
      {
        name: "Broda i golenie",
        services: [
          { name: "Modelowanie brody", durationMin: 30, priceCents: zl(60) },
          { name: "Golenie brzytwą", durationMin: 45, priceCents: zl(90), bufferAfterMin: 10 },
          { name: "Mycie i stylizacja", durationMin: 20, priceCents: zl(40) },
          { name: "Konsultacja", durationMin: 15, priceCents: 0, priceType: "FREE" },
        ],
      },
    ],
    reviews: [
      {
        clientIdx: 0,
        rating: 5,
        comment: "Świetna robota, broda wymodelowana idealnie. Punktualnie i w miłej atmosferze.",
        reply: "Dzięki wielkie, do zobaczenia następnym razem!",
        daysAgo: 7,
      },
      { clientIdx: 1, rating: 5, comment: "Adam to mistrz nożyczek. Najlepsze cięcie od lat.", daysAgo: 12 },
      { clientIdx: 3, rating: 4, comment: "Bardzo dobrze, choć musiałem chwilę poczekać mimo rezerwacji.", reply: "Przepraszamy za poślizg — sobota nas przerosła. Zapraszamy ponownie!", daysAgo: 19 },
      { clientIdx: 4, rating: 5, comment: "Golenie brzytwą jak z dawnych lat. Gorący ręcznik, spokój, klasa.", daysAgo: 26 },
    ],
  },
  {
    slug: "kruk-barber-shop-warszawa",
    name: "Kruk Barber Shop",
    type: "BARBER",
    description:
      "Barbershop przy Puławskiej. Mocne fade'y, klasyczne strzyżenia i pielęgnacja brody. Kawa z ekspresu w cenie wizyty.",
    ownerEmail: "marek.kruk@krukbarber.pl",
    ownerName: "Marek Kruk",
    plan: "PRO",
    location: {
      name: "Kruk Barber Shop",
      address: "ul. Puławska 24",
      city: "Warszawa",
      postal: "02-512",
      phone: "+48 519 883 210",
      lat: 52.2033,
      lng: 21.0231,
    },
    staff: [
      { name: "Bartek Kruk", title: "Head barber", role: "MANAGER", hours: fullWeekHours(hhmm(9), hhmm(18), [0, 1, 2, 3, 4]) },
      { name: "Szymon Lis", title: "Barber", hours: [...fullWeekHours(hhmm(10), hhmm(19), [1, 2, 3, 4]), { weekday: 5, startMinute: hhmm(9), endMinute: hhmm(15) }] },
      { name: "Igor Sowa", title: "Barber", hours: fullWeekHours(hhmm(9), hhmm(17), [0, 2, 4]) },
    ],
    categories: [
      {
        name: "Strzyżenie",
        services: [
          { name: "Strzyżenie klasyczne", durationMin: 45, priceCents: zl(100) },
          { name: "Skin fade", durationMin: 50, priceCents: zl(110) },
          { name: "Strzyżenie maszynką", durationMin: 25, priceCents: zl(70) },
          { name: "Combo: włosy + broda", durationMin: 70, priceCents: zl(160), bufferAfterMin: 10 },
        ],
      },
      {
        name: "Broda",
        services: [
          { name: "Trymowanie brody", durationMin: 30, priceCents: zl(60) },
          { name: "Golenie brzytwą z ręcznikiem", durationMin: 45, priceCents: zl(95), bufferAfterMin: 10 },
        ],
      },
    ],
    reviews: [
      { clientIdx: 1, rating: 5, comment: "Najlepszy fade na Mokotowie, nie ma dyskusji.", reply: "Doceniamy! Do zobaczenia.", daysAgo: 5 },
      { clientIdx: 2, rating: 5, comment: "Rezerwacja online w minutę, zero czekania na miejscu.", daysAgo: 9 },
      { clientIdx: 5, rating: 4, comment: "Solidne strzyżenie, klimatyczny lokal. Ceny lekko z górnej półki.", daysAgo: 16 },
      { clientIdx: 3, rating: 5, comment: "Combo włosy + broda — godzina i wychodzisz jak nowy.", daysAgo: 23 },
      { clientIdx: 0, rating: 5, comment: "Byłam z synem, pan Bartek ma anielską cierpliwość do dzieci.", daysAgo: 31 },
    ],
  },
  {
    slug: "golden-razor-warszawa",
    name: "Golden Razor",
    type: "BARBER",
    description:
      "Kameralny barber przy Wilanowskiej. Dwóch barberów, muzyka z winyli i strzyżenie bez pośpiechu.",
    ownerEmail: "kontakt@goldenrazor.pl",
    ownerName: "Paweł Złotnik",
    location: {
      name: "Golden Razor",
      address: "ul. Wilanowska 8",
      city: "Warszawa",
      postal: "00-422",
      phone: "+48 517 402 998",
      lat: 52.2141,
      lng: 21.0355,
    },
    staff: [
      { name: "Paweł Złotnik", title: "Właściciel / barber", role: "OWNER", hours: fullWeekHours(hhmm(10), hhmm(18), [0, 1, 2, 3, 4]) },
      { name: "Filip Borowski", title: "Barber", hours: [...fullWeekHours(hhmm(11), hhmm(19), [2, 3, 4]), { weekday: 5, startMinute: hhmm(10), endMinute: hhmm(14) }] },
    ],
    categories: [
      {
        name: "Usługi",
        services: [
          { name: "Strzyżenie męskie", durationMin: 40, priceCents: zl(85) },
          { name: "Strzyżenie + broda", durationMin: 65, priceCents: zl(135) },
          { name: "Broda z konturowaniem", durationMin: 30, priceCents: zl(55) },
          { name: "Ojciec i syn", durationMin: 60, priceCents: zl(120) },
        ],
      },
    ],
    reviews: [
      { clientIdx: 4, rating: 5, comment: "Kameralnie, bez pośpiechu, świetna rozmowa i jeszcze lepsze cięcie.", daysAgo: 8 },
      { clientIdx: 5, rating: 4, comment: "Bardzo dobrze, choć terminy trzeba łapać z wyprzedzeniem.", daysAgo: 20 },
    ],
  },
  {
    slug: "cut-and-coffee-warszawa",
    name: "Cut & Coffee",
    type: "BARBER",
    description:
      "Barber i kawiarnia specialty w jednym. Strzyżenie z flat white w dłoni — Belwederska 3.",
    ownerEmail: "hello@cutandcoffee.pl",
    ownerName: "Natalia Czarnecka",
    location: {
      name: "Cut & Coffee",
      address: "ul. Belwederska 3",
      city: "Warszawa",
      postal: "00-761",
      phone: "+48 690 115 224",
      lat: 52.2079,
      lng: 21.0278,
    },
    opening: [
      ...[0, 1, 2, 3, 4].map((weekday) => ({ weekday, startMinute: hhmm(8), endMinute: hhmm(20) })),
      { weekday: 5, startMinute: hhmm(9), endMinute: hhmm(17) },
      { weekday: 6, startMinute: hhmm(10), endMinute: hhmm(15) },
    ],
    staff: [
      { name: "Wiktor Sarna", title: "Barber senior", role: "MANAGER", hours: [...fullWeekHours(hhmm(8), hhmm(16), [0, 1, 2, 3, 4]), { weekday: 5, startMinute: hhmm(9), endMinute: hhmm(17) }] },
      { name: "Julia Pawlak", title: "Barberka", hours: [...fullWeekHours(hhmm(12), hhmm(20), [0, 1, 2, 3, 4]), { weekday: 6, startMinute: hhmm(10), endMinute: hhmm(15) }] },
      { name: "Oskar Wrona", title: "Barber", hours: fullWeekHours(hhmm(9), hhmm(17), [1, 3, 5]) },
    ],
    categories: [
      {
        name: "Strzyżenie",
        services: [
          { name: "Strzyżenie z kawą", durationMin: 45, priceCents: zl(95) },
          { name: "Fade + espresso", durationMin: 50, priceCents: zl(105) },
          { name: "Strzyżenie ekspresowe", durationMin: 25, priceCents: zl(65) },
        ],
      },
      {
        name: "Broda",
        services: [
          { name: "Broda full serwis", durationMin: 40, priceCents: zl(75) },
          { name: "Kontur brody", durationMin: 20, priceCents: zl(45) },
        ],
      },
    ],
    reviews: [
      { clientIdx: 3, rating: 5, comment: "Koncept 10/10 — strzyżenie i najlepsza kawa w okolicy za jednym zamachem.", reply: "Dzięki! Flat white czeka przy następnej wizycie 😉", daysAgo: 4 },
      { clientIdx: 1, rating: 5, comment: "Otwarte do 20, w końcu barber po pracy bez urywania się z biura.", daysAgo: 11 },
      { clientIdx: 2, rating: 4, comment: "Świetna atmosfera. Przy oknie trochę głośno od ulicy, ale cięcie super.", daysAgo: 27 },
    ],
  },
  {
    slug: "atelier-wlosow-anna-maj-warszawa",
    name: "Atelier Włosów Anna Maj",
    type: "HAIR_SALON",
    description:
      "Autorski salon fryzjerski na Żoliborzu. Koloryzacje, strzyżenia damskie i męskie, pielęgnacja Olaplex.",
    ownerEmail: "anna@atelierwlosow.pl",
    ownerName: "Anna Maj",
    plan: "TEAM",
    location: {
      name: "Atelier Włosów",
      address: "ul. Mickiewicza 27",
      city: "Warszawa",
      postal: "01-562",
      phone: "+48 22 839 40 12",
      lat: 52.2691,
      lng: 20.9862,
    },
    staff: [
      { name: "Anna Maj", title: "Stylistka / właścicielka", role: "OWNER", hours: fullWeekHours(hhmm(10), hhmm(18), [1, 2, 3, 4]) },
      { name: "Ewa Sikora", title: "Kolorystka", hours: [...fullWeekHours(hhmm(9), hhmm(17), [0, 1, 2, 3]), { weekday: 5, startMinute: hhmm(9), endMinute: hhmm(14) }] },
      { name: "Daria Motyl", title: "Stylistka", hours: [...fullWeekHours(hhmm(11), hhmm(19), [0, 2, 3, 4]), { weekday: 5, startMinute: hhmm(9), endMinute: hhmm(15) }] },
      { name: "Alicja Borkowska", title: "Asystentka", hours: fullWeekHours(hhmm(9), hhmm(17), [0, 1, 3, 4]) },
    ],
    categories: [
      {
        name: "Strzyżenie",
        services: [
          { name: "Strzyżenie damskie z modelowaniem", durationMin: 60, priceCents: zl(150), priceType: "FROM" },
          { name: "Strzyżenie męskie", durationMin: 40, priceCents: zl(90) },
          { name: "Grzywka — korekta", durationMin: 15, priceCents: zl(30) },
        ],
      },
      {
        name: "Koloryzacja",
        services: [
          { name: "Koloryzacja całościowa", durationMin: 150, priceCents: zl(320), priceType: "FROM", bufferAfterMin: 15, depositCents: zl(50) },
          { name: "Balayage / sombre", durationMin: 210, priceCents: zl(480), priceType: "FROM", bufferAfterMin: 15, depositCents: zl(80) },
          { name: "Tonowanie", durationMin: 60, priceCents: zl(140) },
        ],
      },
      {
        name: "Pielęgnacja",
        services: [
          { name: "Zabieg Olaplex", durationMin: 45, priceCents: zl(160) },
          { name: "Mycie + modelowanie", durationMin: 40, priceCents: zl(90) },
        ],
      },
    ],
    reviews: [
      { clientIdx: 2, rating: 5, comment: "Balayage wyszedł dokładnie tak, jak na inspiracjach. Pani Ewa to artystka.", reply: "Dziękujemy Karolino! Widzimy się na tonowaniu :)", daysAgo: 6 },
      { clientIdx: 0, rating: 5, comment: "Wreszcie fryzjer, który słucha. Obcięte dokładnie tyle, ile prosiłam.", daysAgo: 14 },
      { clientIdx: 4, rating: 5, comment: "Zabieg Olaplex uratował moje włosy po lecie. Polecam każdemu.", daysAgo: 22 },
      { clientIdx: 5, rating: 3, comment: "Koloryzacja ok, ale wizyta zaczęła się 25 minut po czasie.", reply: "Przepraszamy — poprzedni zabieg się przedłużył. Następna wizyta z rabatem 15%.", daysAgo: 35 },
    ],
  },
  {
    slug: "studio-urody-glow-warszawa",
    name: "Studio Urody Glow",
    type: "BEAUTY",
    description:
      "Brwi, rzęsy i makijaż w centrum. Laminacja, henna pudrowa i makijaże okolicznościowe.",
    ownerEmail: "studio@glowbeauty.pl",
    ownerName: "Patrycja Głowacka",
    location: {
      name: "Studio Glow",
      address: "ul. Chmielna 11",
      city: "Warszawa",
      postal: "00-021",
      phone: "+48 786 220 431",
      lat: 52.2318,
      lng: 21.0141,
    },
    staff: [
      { name: "Patrycja Głowacka", title: "Linergistka / właścicielka", role: "OWNER", hours: fullWeekHours(hhmm(10), hhmm(18), [0, 1, 2, 3, 4]) },
      { name: "Sandra Urban", title: "Stylistka rzęs", hours: [...fullWeekHours(hhmm(11), hhmm(19), [1, 2, 3, 4]), { weekday: 5, startMinute: hhmm(10), endMinute: hhmm(15) }] },
    ],
    categories: [
      {
        name: "Brwi",
        services: [
          { name: "Laminacja brwi z koloryzacją", durationMin: 60, priceCents: zl(120) },
          { name: "Henna pudrowa + regulacja", durationMin: 45, priceCents: zl(90) },
          { name: "Regulacja brwi", durationMin: 20, priceCents: zl(40) },
        ],
      },
      {
        name: "Rzęsy i makijaż",
        services: [
          { name: "Laminacja rzęs", durationMin: 60, priceCents: zl(130) },
          { name: "Przedłużanie rzęs 1:1", durationMin: 120, priceCents: zl(220), bufferAfterMin: 10, depositCents: zl(50) },
          { name: "Makijaż okolicznościowy", durationMin: 75, priceCents: zl(200), depositCents: zl(60) },
        ],
      },
    ],
    reviews: [
      { clientIdx: 0, rating: 5, comment: "Laminacja brwi trzyma się rewelacyjnie już szósty tydzień.", daysAgo: 10 },
      { clientIdx: 2, rating: 5, comment: "Makijaż na wesele przetrwał 14 godzin tańca. Mistrzostwo.", reply: "To zasługa dobrej bazy! Dziękuję ❤", daysAgo: 18 },
      { clientIdx: 4, rating: 4, comment: "Rzęsy piękne, ale ciężko o termin — rezerwujcie z dwutygodniowym zapasem.", daysAgo: 29 },
    ],
  },
  {
    slug: "nail-bar-malina-krakow",
    name: "Nail Bar Malina",
    type: "NAILS",
    description:
      "Manicure hybrydowy i żelowy przy Karmelickiej. Sterylizacja klasy medycznej, autorskie zdobienia.",
    ownerEmail: "malina@nailbar.pl",
    ownerName: "Malwina Krawczyk",
    location: {
      name: "Nail Bar Malina",
      address: "ul. Karmelicka 19",
      city: "Kraków",
      postal: "31-131",
      phone: "+48 668 090 337",
      lat: 50.0665,
      lng: 19.9312,
    },
    staff: [
      { name: "Malwina Krawczyk", title: "Stylistka paznokci", role: "OWNER", hours: [...fullWeekHours(hhmm(9), hhmm(17), [0, 1, 2, 3, 4]), { weekday: 5, startMinute: hhmm(9), endMinute: hhmm(14) }] },
      { name: "Ola Ptak", title: "Stylistka paznokci", hours: fullWeekHours(hhmm(11), hhmm(19), [0, 1, 3, 4]) },
    ],
    categories: [
      {
        name: "Manicure",
        services: [
          { name: "Manicure hybrydowy", durationMin: 75, priceCents: zl(120) },
          { name: "Manicure hybrydowy ze zdobieniem", durationMin: 90, priceCents: zl(150), priceType: "FROM" },
          { name: "Manicure klasyczny", durationMin: 45, priceCents: zl(80) },
          { name: "Ściągnięcie hybrydy + odżywka", durationMin: 30, priceCents: zl(50) },
        ],
      },
      {
        name: "Pedicure",
        services: [
          { name: "Pedicure hybrydowy", durationMin: 90, priceCents: zl(160), bufferAfterMin: 10 },
          { name: "Pedicure klasyczny", durationMin: 60, priceCents: zl(120) },
        ],
      },
    ],
    reviews: [
      { clientIdx: 2, rating: 5, comment: "Hybryda trzyma się 4 tygodnie bez odprysków. Najlepszy salon w Krakowie.", daysAgo: 9 },
      { clientIdx: 4, rating: 5, comment: "Zdobienia jak z Instagrama. Malwina ma niesamowitą rękę.", reply: "Dziękuję! Do zobaczenia za miesiąc :)", daysAgo: 15 },
      { clientIdx: 0, rating: 4, comment: "Solidnie i higienicznie. Parking w okolicy to dramat, ale to nie wina salonu.", daysAgo: 24 },
    ],
  },
  {
    slug: "barber-bracia-wilk-krakow",
    name: "Barber Bracia Wilk",
    type: "BARBER",
    description:
      "Rodzinny barbershop na Kazimierzu. Trzech braci, trzy fotele, zero pośpiechu — whisky do strzyżenia po 18:00.",
    ownerEmail: "bracia@wilkbarber.pl",
    ownerName: "Janusz Wilk",
    location: {
      name: "Barber Bracia Wilk",
      address: "ul. Józefa 14",
      city: "Kraków",
      postal: "31-056",
      phone: "+48 730 411 276",
      lat: 50.0497,
      lng: 19.9445,
    },
    staff: [
      { name: "Janusz Wilk", title: "Barber / właściciel", role: "OWNER", hours: fullWeekHours(hhmm(10), hhmm(19), [0, 1, 2, 3, 4]) },
      { name: "Krzysztof Wilk", title: "Barber", hours: [...fullWeekHours(hhmm(10), hhmm(19), [1, 2, 3, 4]), { weekday: 5, startMinute: hhmm(10), endMinute: hhmm(16) }] },
      { name: "Andrzej Wilk", title: "Barber", hours: fullWeekHours(hhmm(12), hhmm(19), [0, 2, 4]) },
    ],
    categories: [
      {
        name: "Usługi",
        services: [
          { name: "Strzyżenie klasyczne", durationMin: 45, priceCents: zl(85) },
          { name: "Strzyżenie + broda", durationMin: 70, priceCents: zl(130) },
          { name: "Broda tradycyjna (brzytwa)", durationMin: 40, priceCents: zl(70) },
          { name: "Strzyżenie głowy maszynką", durationMin: 20, priceCents: zl(50) },
        ],
      },
    ],
    reviews: [
      { clientIdx: 3, rating: 5, comment: "Klimat Kazimierza, trzech braci i najlepsza broda w mieście.", daysAgo: 7 },
      { clientIdx: 5, rating: 5, comment: "Chodzę co trzy tygodnie od roku. Ani razu się nie zawiodłem.", reply: "Trzy lata i licznik bije! Dzięki Tomek.", daysAgo: 13 },
      { clientIdx: 1, rating: 4, comment: "Świetne strzyżenie. Wieczorami bywa kolejka nawet z rezerwacją.", daysAgo: 25 },
    ],
  },
  {
    slug: "salon-iskra-wroclaw",
    name: "Salon Fryzjerski Iskra",
    type: "HAIR_SALON",
    description:
      "Damsko-męski salon przy Rynku. Szybkie terminy, uczciwe ceny i kawa na dzień dobry.",
    ownerEmail: "salon@iskra.wroclaw.pl",
    ownerName: "Iwona Skrzypczak",
    location: {
      name: "Salon Iskra",
      address: "ul. Świdnicka 8",
      city: "Wrocław",
      postal: "50-067",
      phone: "+48 71 344 28 90",
      lat: 51.1068,
      lng: 17.0322,
    },
    staff: [
      { name: "Iwona Skrzypczak", title: "Fryzjerka / właścicielka", role: "OWNER", hours: [...fullWeekHours(hhmm(9), hhmm(17), [0, 1, 2, 3, 4]), { weekday: 5, startMinute: hhmm(9), endMinute: hhmm(14) }] },
      { name: "Marta Cieślak", title: "Fryzjerka", hours: fullWeekHours(hhmm(11), hhmm(19), [0, 1, 2, 3, 4]) },
    ],
    categories: [
      {
        name: "Damskie",
        services: [
          { name: "Strzyżenie damskie", durationMin: 60, priceCents: zl(110), priceType: "FROM" },
          { name: "Koloryzacja jednolita", durationMin: 120, priceCents: zl(240), priceType: "FROM", bufferAfterMin: 15 },
          { name: "Modelowanie", durationMin: 30, priceCents: zl(60) },
        ],
      },
      {
        name: "Męskie",
        services: [
          { name: "Strzyżenie męskie", durationMin: 30, priceCents: zl(65) },
          { name: "Strzyżenie + mycie", durationMin: 40, priceCents: zl(80) },
        ],
      },
    ],
    reviews: [
      { clientIdx: 4, rating: 5, comment: "Termin na następny dzień, cięcie perfekcyjne, cena uczciwa. Wrócę.", daysAgo: 6 },
      { clientIdx: 1, rating: 4, comment: "Dobry salon w świetnej lokalizacji. Męskie strzyżenie bez fajerwerków, ale solidne.", daysAgo: 17 },
    ],
  },
  {
    slug: "spa-zielone-wzgorze-wroclaw",
    name: "SPA Zielone Wzgórze",
    type: "SPA",
    description:
      "Gabinet masażu i SPA na Krzykach. Masaże klasyczne, gorące kamienie i rytuały relaksacyjne.",
    ownerEmail: "recepcja@zielonewzgorze.pl",
    ownerName: "Renata Wzgórska",
    location: {
      name: "SPA Zielone Wzgórze",
      address: "ul. Powstańców Śląskich 95",
      city: "Wrocław",
      postal: "53-332",
      phone: "+48 71 780 55 41",
      lat: 51.0862,
      lng: 17.0201,
    },
    opening: [
      ...[0, 1, 2, 3, 4].map((weekday) => ({ weekday, startMinute: hhmm(10), endMinute: hhmm(21) })),
      { weekday: 5, startMinute: hhmm(10), endMinute: hhmm(18) },
      { weekday: 6, startMinute: hhmm(11), endMinute: hhmm(17) },
    ],
    staff: [
      { name: "Renata Wzgórska", title: "Masażystka dyplomowana", role: "OWNER", hours: fullWeekHours(hhmm(10), hhmm(18), [0, 1, 2, 3, 4]) },
      { name: "Paweł Mróz", title: "Fizjoterapeuta", hours: [...fullWeekHours(hhmm(13), hhmm(21), [0, 1, 2, 3, 4]), { weekday: 6, startMinute: hhmm(11), endMinute: hhmm(17) }] },
    ],
    categories: [
      {
        name: "Masaże",
        services: [
          { name: "Masaż klasyczny całościowy", durationMin: 60, priceCents: zl(180), bufferAfterMin: 15 },
          { name: "Masaż pleców", durationMin: 30, priceCents: zl(110), bufferAfterMin: 10 },
          { name: "Masaż gorącymi kamieniami", durationMin: 90, priceCents: zl(250), bufferAfterMin: 15, depositCents: zl(60) },
          { name: "Masaż sportowy", durationMin: 60, priceCents: zl(190), bufferAfterMin: 15 },
        ],
      },
      {
        name: "Rytuały",
        services: [
          { name: "Rytuał relaksacyjny dla dwojga", durationMin: 120, priceCents: zl(480), bufferAfterMin: 20, depositCents: zl(120) },
          { name: "Peeling całego ciała", durationMin: 45, priceCents: zl(150), bufferAfterMin: 10 },
        ],
      },
    ],
    reviews: [
      { clientIdx: 0, rating: 5, comment: "Masaż gorącymi kamieniami — dwie godziny totalnego resetu. Cudo.", reply: "Dziękujemy i zapraszamy na rytuał jesienny!", daysAgo: 11 },
      { clientIdx: 3, rating: 5, comment: "Pan Paweł rozprawił się z moimi plecami po siedzącej pracy. Rewelacja.", daysAgo: 21 },
      { clientIdx: 2, rating: 4, comment: "Bardzo relaksująco. Jedyny minus: trudno o wieczorne terminy.", daysAgo: 33 },
    ],
  },
];

// ---------------------------------------------------------------------------

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  console.log("→ czyszczenie danych demo");
  const slugs = BUSINESSES.map((b) => b.slug);
  const existing = await prisma.business.findMany({
    where: { slug: { in: slugs } },
    select: { id: true },
  });
  const existingIds = existing.map((b) => b.id);
  // Rezerwacje nie kaskadują z firmą (RESTRICT) — idą pierwsze.
  await prisma.booking.deleteMany({ where: { businessId: { in: existingIds } } });
  await prisma.business.deleteMany({ where: { id: { in: existingIds } } });

  console.log("→ klienci");
  const clientUsers: { id: string; name: string | null; email: string | null }[] = [];
  for (const client of CLIENTS) {
    clientUsers.push(
      await prisma.user.upsert({
        where: { email: client.email },
        update: { passwordHash, name: client.name },
        create: { email: client.email, name: client.name, role: "CUSTOMER", passwordHash },
      }),
    );
  }

  // Pracownicy Cut & Shave z kontami (demo panelu pracownika).
  const staffAccountEmails: Record<string, string> = {
    "Adam Nowak": "adam@demo.pl",
    "Kuba Wiśniewski": "kuba@demo.pl",
    "Olek Zieliński": "olek@demo.pl",
  };

  for (const definition of BUSINESSES) {
    console.log(`→ ${definition.name} (${definition.location.city})`);

    const owner = await prisma.user.upsert({
      where: { email: definition.ownerEmail },
      update: { passwordHash, role: "BUSINESS_OWNER", name: definition.ownerName },
      create: {
        email: definition.ownerEmail,
        name: definition.ownerName,
        role: "BUSINESS_OWNER",
        passwordHash,
      },
    });

    const business = await prisma.business.create({
      data: {
        slug: definition.slug,
        name: definition.name,
        type: definition.type,
        status: "ACTIVE",
        description: definition.description,
        ownerId: owner.id,
        locations: {
          create: {
            name: definition.location.name,
            addressLine1: definition.location.address,
            city: definition.location.city,
            postalCode: definition.location.postal,
            phone: definition.location.phone,
            latitude: definition.location.lat,
            longitude: definition.location.lng,
            timezone: TIMEZONE,
            cancellationCutoffHours: 12,
            openingHours: { create: definition.opening ?? standardOpening },
          },
        },
      },
      include: { locations: true },
    });
    const location = business.locations[0];

    await prisma.subscription.create({
      data: {
        businessId: business.id,
        plan: definition.plan ?? "FREE",
        status: definition.plan === "PRO" ? "TRIALING" : "ACTIVE",
        trialEndsAt:
          definition.plan === "PRO" ? new Date(Date.now() + 14 * DAY_MS) : null,
      },
    });

    // Pracownicy
    const resources = [];
    for (const [index, staff] of definition.staff.entries()) {
      const accountEmail = staffAccountEmails[staff.name];
      let staffUser = null;
      if (accountEmail) {
        staffUser = await prisma.user.upsert({
          where: { email: accountEmail },
          update: { passwordHash, role: "STAFF", name: staff.name },
          create: { email: accountEmail, name: staff.name, role: "STAFF", passwordHash },
        });
      }
      const resource = await prisma.resource.create({
        data: {
          locationId: location.id,
          type: "STAFF",
          name: staff.name,
          sortOrder: index,
          workingHours: { create: staff.hours },
          staffProfile: {
            create: {
              businessId: business.id,
              userId: staffUser?.id ?? null,
              invitedEmail: staffUser ? null : `${definition.slug}-${index}@zaproszenie.planner.pl`,
              role: staff.role ?? "EMPLOYEE",
              title: staff.title,
            },
          },
        },
      });
      resources.push(resource);
    }

    // Cennik
    const services = [];
    let categoryOrder = 0;
    for (const category of definition.categories) {
      const created = await prisma.serviceCategory.create({
        data: { businessId: business.id, name: category.name, sortOrder: categoryOrder++ },
      });
      for (const [serviceIndex, service] of category.services.entries()) {
        const row = await prisma.service.create({
          data: {
            businessId: business.id,
            categoryId: created.id,
            name: service.name,
            durationMin: service.durationMin,
            bufferAfterMin: service.bufferAfterMin ?? 0,
            priceCents: service.priceCents,
            priceType: service.priceType ?? "FIXED",
            depositRequired: service.depositCents != null,
            depositCents: service.depositCents ?? null,
            sortOrder: serviceIndex,
            resources: {
              create: resources.map((resource) => ({ resourceId: resource.id })),
            },
          },
        });
        services.push(row);
      }
    }

    // Profile klientów w firmie (Customer) — leniwie, per użyte indeksy.
    const customersByClient = new Map<number, string>();
    const customerFor = async (clientIdx: number) => {
      const cached = customersByClient.get(clientIdx);
      if (cached) return cached;
      const client = CLIENTS[clientIdx];
      const row = await prisma.customer.create({
        data: {
          businessId: business.id,
          userId: clientUsers[clientIdx].id,
          fullName: client.name,
          email: client.email,
          phone: client.phone,
        },
      });
      customersByClient.set(clientIdx, row.id);
      return row.id;
    };

    // Opinie — każda na osobnej zakończonej wizycie w przeszłości.
    for (const [reviewIndex, review] of definition.reviews.entries()) {
      const service = services[reviewIndex % services.length];
      const resource = resources[reviewIndex % resources.length];
      const day = new Date(Date.now() - review.daysAgo * DAY_MS);
      const start = localDayMinutesToUtc(
        { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate() },
        hhmm(10 + (reviewIndex % 6)),
        TIMEZONE,
      );
      const end = addMinutes(start, service.durationMin);

      const booking = await prisma.booking.create({
        data: {
          businessId: business.id,
          locationId: location.id,
          customerId: await customerFor(review.clientIdx),
          customerUserId: clientUsers[review.clientIdx].id,
          status: "COMPLETED",
          source: "WEB_MARKETPLACE",
          startAt: start,
          endAt: end,
          totalPriceCents: service.priceCents,
          items: {
            create: {
              serviceId: service.id,
              resourceId: resource.id,
              startAt: start,
              endAt: end,
              blockedStartAt: start,
              blockedEndAt: addMinutes(end, 0),
              durationMin: service.durationMin,
              priceCents: service.priceCents,
            },
          },
        },
      });

      await prisma.review.create({
        data: {
          businessId: business.id,
          bookingId: booking.id,
          authorUserId: clientUsers[review.clientIdx].id,
          rating: review.rating,
          comment: review.comment,
          reply: review.reply ?? null,
          repliedAt: review.reply ? new Date(Date.now() - (review.daysAgo - 1) * DAY_MS) : null,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Cut & Shave — bogatsza historia pod CRM/statystyki + nadchodzące wizyty.
  // -------------------------------------------------------------------------
  console.log("→ Cut & Shave: historia CRM i nadchodzące wizyty");
  const cutAndShave = await prisma.business.findUniqueOrThrow({
    where: { slug: "cut-and-shave-warszawa" },
    include: {
      locations: true,
      services: { orderBy: { sortOrder: "asc" } },
      customers: true,
    },
  });
  const csLocation = cutAndShave.locations[0];
  const csResources = await prisma.resource.findMany({
    where: { locationId: csLocation.id },
    orderBy: { sortOrder: "asc" },
  });
  const anna = clientUsers[0];
  const annaCustomer =
    cutAndShave.customers.find((c) => c.userId === anna.id) ??
    (await prisma.customer.create({
      data: {
        businessId: cutAndShave.id,
        userId: anna.id,
        fullName: CLIENTS[0].name,
        email: CLIENTS[0].email,
        phone: CLIENTS[0].phone,
        tags: ["stały klient"],
      },
    }));

  const historyStatuses: BookingStatus[] = [
    "COMPLETED", "COMPLETED", "COMPLETED", "NO_SHOW",
    "COMPLETED", "CANCELLED_BY_CUSTOMER", "COMPLETED", "COMPLETED",
  ];

  for (let i = 0; i < 14; i++) {
    // Popołudnia (15:00+) — nie kolidują z porannymi wizytami opinii.
    const daysAgo = 2 + i * 2;
    const day = new Date(Date.now() - daysAgo * DAY_MS);
    const service = cutAndShave.services[i % cutAndShave.services.length];
    const resource = csResources[i % csResources.length];
    const status = historyStatuses[i % historyStatuses.length];
    const clientIdx = i % 2 === 0 ? 0 : 5; // Anna i Tomasz

    const start = localDayMinutesToUtc(
      { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate() },
      hhmm(15) + (i % 4) * 45,
      TIMEZONE,
    );
    const end = addMinutes(start, service.durationMin);

    const customerId =
      clientIdx === 0
        ? annaCustomer.id
        : (
            await prisma.customer.upsert({
              where: { businessId_userId: { businessId: cutAndShave.id, userId: clientUsers[5].id } },
              update: {},
              create: {
                businessId: cutAndShave.id,
                userId: clientUsers[5].id,
                fullName: CLIENTS[5].name,
                email: CLIENTS[5].email,
                phone: CLIENTS[5].phone,
              },
            })
          ).id;

    await prisma.booking.create({
      data: {
        businessId: cutAndShave.id,
        locationId: csLocation.id,
        customerId,
        customerUserId: clientUsers[clientIdx].id,
        status,
        source: i % 3 === 0 ? "MANUAL_STAFF" : "WEB_MARKETPLACE",
        startAt: start,
        endAt: end,
        totalPriceCents: service.priceCents,
        items: {
          create: {
            serviceId: service.id,
            resourceId: resource.id,
            startAt: start,
            endAt: end,
            blockedStartAt: start,
            blockedEndAt: end,
            durationMin: service.durationMin,
            priceCents: service.priceCents,
            isBlocking: !status.startsWith("CANCELLED"),
          },
        },
      },
    });
  }

  // Nadchodząca wizyta Anny — jutro 10:00.
  const tomorrow = new Date(Date.now() + DAY_MS);
  const upcomingService = cutAndShave.services[0];
  const upcomingStart = localDayMinutesToUtc(
    { year: tomorrow.getUTCFullYear(), month: tomorrow.getUTCMonth() + 1, day: tomorrow.getUTCDate() },
    hhmm(10),
    TIMEZONE,
  );
  const upcomingEnd = addMinutes(upcomingStart, upcomingService.durationMin);
  await prisma.booking.create({
    data: {
      businessId: cutAndShave.id,
      locationId: csLocation.id,
      customerId: annaCustomer.id,
      customerUserId: anna.id,
      status: "CONFIRMED",
      source: "WEB_MARKETPLACE",
      startAt: upcomingStart,
      endAt: upcomingEnd,
      totalPriceCents: upcomingService.priceCents,
      items: {
        create: {
          serviceId: upcomingService.id,
          resourceId: csResources[0].id,
          startAt: upcomingStart,
          endAt: upcomingEnd,
          blockedStartAt: upcomingStart,
          blockedEndAt: upcomingEnd,
          durationMin: upcomingService.durationMin,
          priceCents: upcomingService.priceCents,
        },
      },
    },
  });

  // Ulubione Anny.
  for (const slug of ["cut-and-shave-warszawa", "kruk-barber-shop-warszawa", "spa-zielone-wzgorze-wroclaw"]) {
    const favBusiness = await prisma.business.findUniqueOrThrow({ where: { slug }, select: { id: true } });
    await prisma.favorite.upsert({
      where: { userId_businessId: { userId: anna.id, businessId: favBusiness.id } },
      update: {},
      create: { userId: anna.id, businessId: favBusiness.id },
    });
  }

  const counts = {
    businesses: await prisma.business.count(),
    services: await prisma.service.count(),
    resources: await prisma.resource.count(),
    bookings: await prisma.booking.count(),
    reviews: await prisma.review.count(),
  };

  console.log("\n✓ Dane demo gotowe:", JSON.stringify(counts));
  console.log("  Właściciel:  wlasciciel@demo.pl / " + DEMO_PASSWORD);
  console.log("  Pracownik:   adam@demo.pl / " + DEMO_PASSWORD);
  console.log("  Klient:      klient@demo.pl / " + DEMO_PASSWORD);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
