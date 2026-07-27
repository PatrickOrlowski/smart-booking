# Planner — plan projektu

Platforma rezerwacji w stylu Booksy: firmy usługowe (barber, fryzjer, kosmetyczka, warsztat,
gabinet, a docelowo także restauracje) zakładają profil, definiują pracowników, ich grafiki
i cennik usług, a klienci rezerwują wolne terminy online.

---

## 1. Decyzje bazowe

| Obszar | Decyzja |
|---|---|
| Model produktu | **Marketplace** — wspólna baza firm, publiczna wyszukiwarka, klient ma jedno konto i rezerwuje u wielu firm |
| Stack | **Next.js (App Router) + TypeScript + PostgreSQL + Prisma** |
| Platformy | Web responsywny (PWA) → aplikacja mobilna klienta (Expo/React Native) → osobny panel pracownika |
| Auth | NextAuth/Auth.js — e-mail + hasło, OAuth (Google/Apple), OTP SMS dla klienta |
| Hosting | Vercel / Docker + Postgres (Neon lub self-hosted), S3-compatible na zdjęcia |
| Jobs | Kolejka zadań (BullMQ + Redis lub pg-boss) — przypomnienia, e-maile, wygaszanie rezerwacji |

**Zasada przewodnia:** silnik dostępności (availability engine) jest sercem systemu. Wszystko inne
(cennik, powiadomienia, opinie) to nadbudowa. Restauracje w późniejszej fazie to **inny typ zasobu**
(stolik zamiast pracownika), a nie osobny system — dlatego model danych od początku mówi o
*zasobach rezerwowalnych*, nie o „pracownikach".

---

## 2. Model domenowy (szkic)

### Rdzeń

```
User            — konto (klient / właściciel / pracownik / admin platformy)
Business        — firma: nazwa, typ (BARBER, HAIR, BEAUTY, RESTAURANT, ...), opis, slug, status
Location        — punkt/lokal firmy: adres, geo (lat/lng), strefa czasowa, telefon
Resource        — zasób rezerwowalny (pracownik LUB stolik LUB stanowisko), należy do Location
Staff           — profil pracownika (User ↔ Resource), rola w firmie, prowizja
Service         — usługa: nazwa, kategoria, czas trwania, bufor przed/po, cena, VAT
ServiceResource — które zasoby wykonują daną usługę (+ ewentualnie inny czas/cena per pracownik)
```

### Czas i dostępność

```
WorkingHours    — cykliczny grafik zasobu (dzień tygodnia, od–do), wersjonowany od daty
TimeOff         — urlop / przerwa / święto / blokada ad-hoc (zasób lub cała lokalizacja)
Booking         — rezerwacja: klient, usługa(i), zasób, start, end, status, cena, źródło
BookingItem     — pozycja rezerwacji (usługa + zasób + slot) — pod wizyty wieloetapowe
Hold            — tymczasowa blokada slotu na czas checkoutu (TTL ~10 min)
```

### Wokół

```
Customer        — profil klienta w kontekście firmy (notatki, tagi, historia) — CRM light
Review          — ocena + treść, powiązana z zakończoną rezerwacją
Payment         — zadatek / płatność online / rozliczenie
Notification    — log wysyłek (e-mail, SMS, push)
AuditLog        — kto co zmienił (kluczowe przy sporach o rezerwacje)
```

### Reguły, które muszą być twarde od początku

- **Czas zawsze w UTC w bazie**, prezentacja w strefie lokalizacji. Uwzględnić zmianę czasu (DST).
- **Slot = duration + bufor przed + bufor po.** Bufory nie są widoczne dla klienta, ale blokują grafik.
- **Brak podwójnych rezerwacji** — unikalność wymuszona na poziomie bazy (exclusion constraint na
  `tstzrange` per zasób) plus blokada transakcyjna, nie tylko walidacja w aplikacji.
- **Rezerwacja jest niemutowalna w czasie** — zmiana terminu tworzy nowy wpis i loguje historię.

---

## 3. Fazy

### Faza 0 — Fundament (1 sprint)

Cel: działający szkielet, na którym da się budować bez późniejszych migracji-katastrof.

- Setup: Next.js + TS strict, ESLint/Prettier, Vitest, Playwright, Docker Compose (Postgres + Redis)
- Prisma + pierwsze migracje, seed z danymi demo (1 barber, 3 pracowników, 8 usług)
- Auth.js: rejestracja/logowanie, sesje, role (`CUSTOMER`, `BUSINESS_OWNER`, `STAFF`, `ADMIN`)
- Warstwa autoryzacji: guard `canAccessBusiness(user, businessId)` — jeden punkt prawdy
- CI: lint + testy + migracje na PR
- Design system: Tailwind + shadcn/ui, tokeny kolorów, layout shell panelu i strony publicznej

**Definicja gotowości:** można się zarejestrować, zalogować i zobaczyć pusty panel firmy.

---

### Faza 1 — Firma, pracownicy, usługi (2 sprinty)

Cel: właściciel może w pełni skonfigurować swoją firmę. Bez rezerwacji.

- Onboarding firmy: nazwa, typ, lokalizacja (mapa + geokodowanie), godziny otwarcia, zdjęcia
- Zarządzanie pracownikami: dodanie, zaproszenie mailem, przypisanie roli, avatar, opis
- Grafiki pracowników: tygodniowy szablon (pon–ndz, wiele bloków dziennie), obowiązujący od daty
- Urlopy i blokady: pojedyncze dni, zakresy, przerwy w ciągu dnia, święta na poziomie lokalizacji
- Cennik i usługi: kategorie, nazwa, **czas trwania**, bufory, cena (stała / „od" / na zapytanie)
- Mapowanie usługa ↔ pracownik, z opcjonalnym nadpisaniem czasu i ceny per pracownik
- Publiczny profil firmy (read-only): cennik, zespół, godziny, galeria, mapa

**Definicja gotowości:** barber wypełnia dane w 15 minut i ma publiczny link do swojego profilu.

---

### Faza 2 — Silnik dostępności + rezerwacja (2–3 sprinty) ⭐ najważniejsza faza

Cel: klient rezerwuje termin, właściciel widzi go w kalendarzu.

**Availability engine** (osobny, w pełni testowany moduł, bez zależności od UI):

```
getAvailableSlots({ businessId, serviceIds, resourceId?, dateRange, timezone })
  → odejmij od WorkingHours: TimeOff, istniejące Booking, aktywne Hold
  → uwzględnij duration + bufory + granularność siatki (5/10/15 min, konfigurowalna)
  → uwzględnij lead time (min. wyprzedzenie) i horyzont rezerwacji (maks. X dni w przód)
  → wynik: lista slotów per zasób + widok scalony „dowolny pracownik"
```

- Testy jednostkowe: DST, północ, wielodniowe zakresy, sąsiadujące bufory, urlop w środku dnia
- Flow rezerwacji klienta: usługa → pracownik (lub „dowolny") → data → godzina → dane → potwierdzenie
- `Hold` na slot podczas checkoutu, z automatycznym wygaśnięciem
- Rezerwacja jako gość (bez konta) + późniejsza konwersja na konto po e-mailu/telefonie
- Kalendarz w panelu firmy: widok dnia/tygodnia, kolumny per pracownik, drag & drop, szybkie tworzenie
- Statusy rezerwacji: `PENDING` → `CONFIRMED` → `COMPLETED` / `CANCELLED` / `NO_SHOW`
- Polityka anulowania: do X godzin przed, konfigurowalna per firma
- E-mail: potwierdzenie dla klienta i dla firmy; plik `.ics` w załączniku

**Definicja gotowości:** pełny cykl — klient rezerwuje, firma widzi, obie strony dostają e-mail,
i **nie da się** zarezerwować zajętego slotu nawet przy równoczesnych żądaniach (test obciążeniowy).

---

### Faza 3 — Marketplace: wyszukiwarka i konto klienta (2 sprinty)

Cel: klient znajduje firmę, a nie tylko dostaje link.

- Wyszukiwarka: po nazwie, kategorii, mieście; filtry (typ usługi, cena, ocena, „wolne dziś")
- Wyszukiwanie geograficzne — PostGIS lub prosty bounding box + sortowanie po odległości
- Strona kategorii i miasta pod SEO (SSG/ISR, dane strukturalne `LocalBusiness` + `Service`)
- Konto klienta: nadchodzące i minione wizyty, anulowanie/zmiana terminu, ulubione firmy
- Opinie i oceny: tylko po zakończonej wizycie, odpowiedź właściciela, moderacja
- Powiadomienia SMS/push: przypomnienie 24 h i 2 h przed wizytą (kolejka + retry)

**Definicja gotowości:** nowy użytkownik z ulicy znajduje barbera w swoim mieście i rezerwuje.

---

### Faza 4 — Pieniądze i operacje (2 sprinty)

Cel: platforma zarabia, firma ma narzędzia operacyjne.

- Płatności online: Stripe / Przelewy24 — zadatek lub pełna przedpłata, konfigurowalne per usługa
- Polityka no-show: przepadający zadatek, blokada klienta po N nieodwołanych nieobecnościach
- Subskrypcje firm: plany (Free / Pro / Team), limity pracowników i lokalizacji, trial, faktury
- CRM light: karta klienta z historią, notatkami, tagami, sumą wydatków
- Statystyki: obłożenie pracowników, przychód, top usługi, no-show rate, źródła rezerwacji
- Eksport: CSV rezerwacji i rozliczeń, integracja z Google Calendar (dwukierunkowa)

---

### Faza 5 — Aplikacja mobilna klienta (2 sprinty)

- Expo / React Native na tym samym API (wydzielić `/api/v1` jako stabilny kontrakt + typy współdzielone)
- Push notifications, geolokalizacja, „rezerwuj ponownie" jednym tapnięciem
- Deep linki do profilu firmy i do rezerwacji

---

### Faza 6 — Panel pracownika (1 sprint)

- Uproszczony widok: „mój dzisiejszy grafik", lista wizyt, dane kontaktowe klienta
- Odznaczanie: przyszedł / nie przyszedł / zakończone; szybkie dopisanie usługi
- Wniosek o urlop → akceptacja przez właściciela
- Uprawnienia: pracownik widzi wyłącznie swój grafik i swoich klientów

---

### Faza 7 — Restauracje: stoliki i rezerwacja stolików (3 sprinty)

Rozszerzenie modelu, nie nowy system. `Resource` zyskuje typ `TABLE` z dodatkowymi atrybutami.

- Model: `Table` (numer, pojemność min/max, sala, strefa: taras/wewnątrz/bar, łączenie stolików)
- Plan sali: edytor drag & drop, pozycje stolików na siatce, wiele sal per lokalizacja
- Rezerwacja pod liczbę osób, nie pod usługę: `partySize` → dobór stolika lub kombinacji stolików
- **Turn time** — czas zajęcia stolika zależny od liczby osób (2 os. = 90 min, 6 os. = 150 min)
- Sloty co 15/30 min, limit pokrycia (pacing) — maks. X nowych rezerwacji na przedział czasowy
- Waitlist gdy brak miejsc + powiadomienie o zwolnionym stoliku
- Widok hosta na dziś: plan sali w czasie rzeczywistym, statusy (wolny / zarezerwowany / zajęty)
- Menu i eventy jako treść na profilu; opcjonalnie przedpłata przy dużych grupach

---

### Faza 8 — Dojrzałość platformy (ciągłe)

- Panel admina platformy: weryfikacja firm, moderacja, zgłoszenia nadużyć, wsparcie
- Programy lojalnościowe, kody rabatowe, karnety i pakiety wizyt
- Rezerwacje grupowe i cykliczne (co 4 tygodnie ten sam termin)
- Wielojęzyczność (PL/EN) i wielowalutowość
- Publiczne API + webhooki dla integratorów; widget rezerwacji do osadzenia na stronie firmy
- RODO: eksport i usunięcie danych, polityka retencji, zgody marketingowe

---

## 4. Ryzyka i miejsca, gdzie takie projekty się wykładają

1. **Strefy czasowe i DST** — rezerwacja o 2:30 w noc zmiany czasu. Testy od pierwszego dnia.
2. **Wyścigi przy rezerwacji** — dwie osoby, ten sam slot, ta sama sekunda. Rozwiązanie musi być
   w bazie (constraint + transakcja), nie w kodzie aplikacji.
3. **Zmiana grafiku wstecz** — właściciel skraca godziny pracy, a są już rezerwacje.
   Potrzebny mechanizm wykrywania kolizji i asysty w przenoszeniu wizyt.
4. **Wydajność wyszukiwania slotów** — naiwne liczenie dla 30 dni × 10 pracowników zabija bazę.
   Materializowana dostępność lub cache z inwalidacją przy zapisie.
5. **Zbyt wczesne uogólnienie na restauracje** — abstrakcja `Resource` tak, ale reszta logiki
   restauracyjnej dopiero w Fazie 7, na realnych wymaganiach.
6. **Powiadomienia** — SMS kosztuje. Limity, deduplikacja, retry z backoffem, kontrola budżetu.

---

## 5. Stan realizacji (26.07.2026)

**Faza 0 — ZROBIONA.** Next.js 16 + TS strict + Prisma 7 + Neon (pooled/direct URL),
Auth.js v5 (Credentials + JWT + role), guardy `src/lib/authz.ts`, helpery stref `src/lib/time.ts`,
seed demo (Cut & Shave), CI-owe komendy: `typecheck`, `lint`, `test`, `build` — wszystkie zielone.
Exclusion constraint `booking_items_no_overlap` + trigger `is_blocking` w bazie, pokryte testami
integracyjnymi (równoczesne INSERTy → dokładnie jeden przechodzi).

**Design system — ZROBIONY.** Prototyp z claude.ai/design → `design/prototyp.dc.html`,
tokeny w `globals.css`, spec `design/DESIGN.md`, fonty Bricolage Grotesque / Instrument Sans / DM Mono,
24 komponenty shadcn/ui.

**Faza 1 — ZROBIONA w rdzeniu.** Panel firmy `/panel`: onboarding (firma+adres+godziny otwarcia),
cennik z kategoriami i przypisaniem pracowników (nadpisania czasu/ceny), zespół z grafikami
tygodniowymi i urlopami. Publiczny profil `/b/[slug]`. Braki: zdjęcia, geokodowanie, zaproszenia
mailowe pracowników, wersjonowanie grafiku `validFrom`.

**Faza 2 — ZROBIONA w rdzeniu.** Silnik dostępności `src/lib/availability.ts` (czysta logika,
25 testów, DST przechodzi), API `/api/v1` (businesses, availability, bookings + cancel z cutoffem),
flow rezerwacji klienta s1–s7, kalendarz dnia w panelu, konflikt slotu → 409. Braki: Hold przy
checkout (wyścig łapie constraint), e-maile z .ics, widok tygodnia, drag & drop.

**Fazy 6 (panel pracownika) — ZROBIONA wcześniej niż planowano**: `/pracownik` z grafikiem dnia
i odznaczaniem COMPLETED/NO_SHOW. Braki: wniosek o urlop.

**Aktualizacja 27.07.2026 — Faza 2 DOMKNIĘTA, Faza 3 ZROBIONA (rdzeń):**
holdy z TTL przy checkoucie (limity per klient/IP/zasób, licznik w UI), e-maile z .ics
(Resend za flagą env, log w `notifications`, cron przypomnień 24h + `vercel.json`),
podpisany link `/wizyta/[id]` dla gości, widok tygodnia i `/panel/opinie` w panelu,
`/konto` (wizyty, anulowanie ze wspólnym `cancelBooking()`, oceny, ulubione),
opinie + JSON-LD + ulubione na profilu, strony `/m/[miasto]` i `/k/[kategoria]` (ISR),
sitemap/robots, stopka. Całość przeszła adwersaryjną weryfikację: 41 findingów,
32 naprawione (m.in. krytyczny wybór zasobu przy holdzie „dowolny pracownik").
Responsywność 390–1440 wszędzie. Testy: 55 zielonych.

**Seed realistyczny:** 10 firm w 3 miastach (Warszawa/Kraków/Wrocław), rynkowe ceny,
~32 opinie na prawdziwych wizytach, historia CRM, subskrypcje FREE/PRO/TEAM, zadatki
na usługach premium.

**Faza 4 — W TOKU (workflow):** zadatki w checkoucie (MANUAL + Stripe za flagą, webhook
HMAC), polityka no-show (blokada klienta po limicie), subskrypcje z limitami planów,
CRM `/panel/klienci`, statystyki + eksport CSV, dziennik `AuditLog`.
Schemat bazy pod fazę już zmigrowany (`payments_subscriptions_audit`).

## 5b. Kolejne kroki po Fazie 4

1. Deploy na Vercel (env: DATABASE_URL, DIRECT_URL, AUTH_SECRET, CRON_SECRET;
   build ma już `prisma generate`, migracje: `npx prisma migrate deploy` w predeploy).
2. Faza 5: aplikacja mobilna klienta (Expo na API /api/v1).
3. Reszta Fazy 3: wyszukiwanie geo po odległości, przypomnienia SMS/push.

---

## 6. Notatnik pomysłów

_(miejsce na luźne pomysły do przypisania do faz)_

-
