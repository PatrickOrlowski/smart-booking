# Planner — aplikacja mobilna klienta (Expo)

Aplikacja Expo/React Native marketplace'u rezerwacji. UI po polsku,
design zgodny z `../design/DESIGN.md` (tokeny w `src/theme/tokens.ts`).

## Wymagania

- Node 20+
- Backend Next.js z korzenia repo (REST API pod `/api/v1`)

## Uruchomienie

1. Wystartuj backend (z korzenia repo, na wolnym porcie, np. 3031):

   ```sh
   NEXT_DIST_DIR=.next-mob npx next dev -p 3031
   ```

2. Wystartuj aplikację (z katalogu `mobile/`):

   ```sh
   npm install
   EXPO_PUBLIC_API_URL=http://localhost:3031 npx expo start
   ```

   - `w` — otwarcie w przeglądarce (react-native-web),
   - `i` / `a` — symulator iOS / emulator Android,
   - kod QR — Expo Go na telefonie (wtedy `EXPO_PUBLIC_API_URL` musi
     wskazywać adres IP komputera w sieci lokalnej, nie `localhost`).

### `EXPO_PUBLIC_API_URL`

Bazowy adres API. Domyślnie `http://localhost:3000`. Zmienna jest czytana
w `src/api/client.ts` podczas budowania bundle'a — po zmianie zrestartuj
`expo start`.

## Struktura

```
src/
  api/client.ts        typowany klient REST (businesses, availability,
                       holds, bookings; błędy jako ApiError z polskim message)
  theme/tokens.ts      tokeny designu: kolory, fonty, spacing, promienie
  theme/typography.tsx DisplayText / BodyText / MetaLabel / MonoText
  app/_layout.tsx      ładowanie fontów + splash + dolny tab bar
  app/index.tsx        zakładka „Szukaj"
  app/wizyty.tsx       zakładka „Moje wizyty"
```

## Zasady

- Żadnych hexów w ekranach — tylko tokeny z `src/theme/tokens.ts`.
- Kwoty z API są w groszach; formatuj przez
  `Intl.NumberFormat("pl-PL", { style: "currency", currency })`.
- Czasy z API są w UTC — prezentuj w strefie lokalu (pole `timezone`
  w odpowiedziach), nigdy w strefie urządzenia.

## Weryfikacja typów

```sh
npx tsc --noEmit
```
