# Konta testowe (dane demo z seeda)

Hasło do **wszystkich** kont: `haslo1234`
Odtworzenie danych: `npm run db:seed`

## Główne konta

| Rola | E-mail | Co zobaczysz |
|---|---|---|
| **Admin platformy** | `admin@planner.pl` | `/admin` — weryfikacja firm (czeka „Nożyce i Brzytwa"), moderacja opinii, zgłoszenia, użytkownicy |
| **Właściciel salonu** | `wlasciciel@demo.pl` | `/panel` — Cut & Shave (Warszawa): kalendarz, usługi, zespół, klienci, statystyki, promocje, serie, integracje, plan PRO (trial) |
| **Pracownik** | `adam@demo.pl` | `/pracownik` — grafik dnia, odznaczanie wizyt |
| **Klient** | `klient@demo.pl` | `/konto` — Anna Lewandowska: wizyty, opinie, ulubione, karnet „5 strzyżeń" (2/5) |
| **Właściciel restauracji** | `rezerwacje@bistrokwadrat.pl` | `/panel` — Bistro Kwadrat: sale, plan stolików, widok hosta „Dziś", lista oczekujących |

## Pozostałe konta

- Pracownicy Cut & Shave: `kuba@demo.pl`, `olek@demo.pl`
- Klienci: `michal.dabrowski@example.com`, `karolina.wojcik@example.com`, `piotr.kaminski@example.com`, `magda.zajac@example.com`, `tomasz.nowicki@example.com` (ma 2 no-show w Cut & Shave)
- Właściciele firm: `marek.kruk@krukbarber.pl` (Kruk Barber), `anna@atelierwlosow.pl` (Atelier Włosów, plan TEAM), `ciao@trattoriasole.pl` (Trattoria Sole, Kraków), `kontakt@nozyceibrzytwa.pl` (firma czeka na weryfikację)

## Dane testowe do funkcji

| Funkcja | Dane |
|---|---|
| Kody rabatowe (Cut & Shave) | `LATO20` (-20%), `PIERWSZA50` (-50 zł od 100 zł), `ZIMA10` (wygasły — do testu odmowy) |
| Klucz publicznego API | `pk_demo_a1b2_sekretny_klucz_demo` (nagłówek `Authorization: Bearer ...`, firma Cut & Shave) |
| Widget | `/widget/cut-and-shave-warszawa` |
| Wersja EN | przełącznik PL/EN w nagłówku strony publicznej |
| Cron (lokalnie) | `Authorization: Bearer dev-cron-secret-0123456789` → `/api/cron/reminders`, `/api/cron/webhooks` |

> Plik opisuje wyłącznie lokalne dane demo. Sekrety produkcyjne trzymamy w env Vercela, nigdy w repo.
