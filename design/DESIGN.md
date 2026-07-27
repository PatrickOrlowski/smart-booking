# Planner — design system

Źródło prawdy wyglądu: `design/prototyp.dc.html` (prototyp z claude.ai/design).
Ten dokument tłumaczy prototyp na tokeny i przepisy komponentów w kodzie.
Tokeny są zdefiniowane w `src/app/globals.css`, fonty w `src/app/layout.tsx`.

## Charakter

Ciepły, redakcyjny, „papierowy": kremowe tła, atramentowa czerń zamiast szarości,
butelkowa zieleń jako jedyny kolor akcji. Duże, zbite nagłówki. Meta-informacje
(etykiety, ceny, czasy) zawsze w monospace. Zero gradientów i cieni poza
wyraźnie uniesionymi elementami (rama telefonu, popovery).

## Fonty

| Rola | Font | Tailwind | Użycie |
|---|---|---|---|
| Display | Bricolage Grotesque 600–800 | `font-display` | h1–h3, nazwy firm, liczby w statach; zawsze z `tracking-tight`, duże nagłówki `leading-none` |
| Tekst | Instrument Sans 400–700 | `font-sans` (domyślny) | wszystko pozostałe |
| Meta | DM Mono 400–500 | `font-mono` | etykiety sekcji, ceny, czasy, liczniki, statusy |

Gotowa klasa `.meta-label` = etykieta sekcji („LOKALIZACJA", „KROK 1 / 3"):
DM Mono 10px, uppercase, tracking .1em, kolor muted.

## Kolory (tokeny shadcn)

| Token | Wartość (light) | Rola |
|---|---|---|
| `background` | `#f2eee6` | tło aplikacji (krem) |
| `card` | `#fffdf9` | karty, powierzchnie |
| `foreground` | `#131412` | tekst (atrament) |
| `primary` | `#143d31` | akcje, CTA, aktywne stany (butelkowa zieleń) |
| `primary-foreground` | `#f7f4ef` | tekst na primary |
| `muted` / `secondary` | `#ece7dd` / `#eae5db` | tła drugorzędne |
| `muted-foreground` | `#6d6a63` | tekst drugorzędny (jaśniejszy wariant `#8f8b81`) |
| `accent` | `#eaf1ec` | zielony tint — pola „wolny termin", potwierdzenia |
| `border` | `#ddd7ca` | obramowania zwykłe (1px) |
| `border-strong` | `#131412` | obrys wyróżnionych kart/inputów — **1.5px** |
| `success` | `#14803f` | dostępność, statusy pozytywne |
| `success-soft(-border)` | `#eaf1ec` / `#cfe0d5` | pastylka „najbliższy wolny termin" |
| `warning` / `warning-strong` / `warning-soft` | `#b4771f` / `#7a5312` / `#fdf3e3` | oczekujące, ostrzeżenia |
| `destructive` | `#a83228` | anulowania, no-show, błędy |
| `ink` / `ink-foreground` | `#131412` / `#f7f4ef` | ciemny top-bar, inwersje |

Dark mode zdefiniowany w `.dark` — nie hardkodować hexów w komponentach,
zawsze klasy tokenowe (`bg-card`, `text-muted-foreground`, `border-border-strong`…).

## Geometria

- Promienie: inputy/przyciski `rounded-lg`–`rounded-xl` (14px), karty `rounded-2xl` (~18–20px),
  chipy/tagi/CTA w pigułce `rounded-full`, rama telefonu 44px.
- Wyróżnienie karty = obrys `border-[1.5px] border-border-strong`, NIE cień.
  Karty zwykłe: `border border-border`.
- Cienie tylko dla elementów pływających (dialog, popover, dropdown).
- Odstępy: sekcje 20–28px, wewnątrz kart 13–16px.

## Przepisy komponentów (z prototypu)

- **Przycisk primary**: `bg-primary text-primary-foreground rounded-full font-semibold text-[13px] px-4 py-2`.
  Wariant outline: `border-[1.5px] border-border-strong bg-card rounded-full`.
  Wariant disabled/ghost: `border-border text-muted-foreground`.
- **Chip filtra**: pigułka; aktywny `bg-primary text-primary-foreground`,
  nieaktywny `bg-card border border-border text-foreground/80`; tekst 12px semibold.
- **Tag „NAJCZĘŚCIEJ"**: DM Mono 9px, `bg-primary text-primary-foreground px-1.5 py-0.5 rounded`, tracking .06em.
- **Pastylka dostępności**: `bg-success-soft border border-success-soft-border rounded-lg px-2.5 py-1.5`,
  kropka 6px `bg-success` z animacją `pulse-dot`, tekst 12px semibold `text-primary`.
- **Wiersz usługi (cennik)**: nazwa 15px semibold; niżej DM Mono 12px muted „30 min · 70 zł";
  po prawej pigułka „Wybierz". Separatory `border-t border-[#eae5db]` (token `muted`).
  Wyróżniony wiersz: tło `bg-[#f7f4ef]` rozciągnięte na pełną szerokość.
- **Karta firmy (lista)**: `bg-card border-[1.5px] border-border-strong rounded-2xl overflow-hidden`
  (wynik promowany) lub `border border-border` (zwykły); zdjęcie `.photo-placeholder`;
  ocena w DM Mono „4,9 (312)".
- **Zakładki (profil/panel)**: tekst 13px; aktywna `font-bold border-b-[2.5px] border-foreground pb-2`,
  nieaktywna `font-medium text-[#8f8b81]`.
- **Top-bar aplikacji**: `bg-ink text-ink-foreground h-16`, logo w font-display 800,
  nawigacja pigułkami; meta po prawej w DM Mono 11px.
- **Ekrany stanu** (pusty / błąd / brak wyników): duży nagłówek display,
  opis muted 13px, jedno CTA; patrz sekcja „Stany brzegowe" prototypu (linie ~1297+).

## Responsywność

Każdy widok implementujemy OD RAZU na wszystkie rozmiary. Prototyp pokazuje zwykle jeden
breakpoint (klient = telefon, panele = desktop) — pozostałe wyprowadzamy z reguł poniżej.

Breakpointy = domyślne Tailwinda: `sm` 640 (duży telefon poziomo), `md` 768 (tablet),
`lg` 1024 (laptop), `xl` 1280 (desktop). Klasy pisane mobile-first (bazowe = telefon).

| Typ widoku | telefon (<640) | tablet (md) | laptop/desktop (lg/xl) |
|---|---|---|---|
| Marketplace: lista/wyszukiwarka | 1 kolumna kart, jak prototyp s1 | siatka kart 2 kolumny, `max-w-3xl` | siatka 3 kolumny `max-w-6xl`, nagłówek hero szerszy (h1 do 44–52px), chipy w jednej linii |
| Profil firmy | jak prototyp s2 | treść `max-w-3xl`, galeria wyższa | 2 kolumny `max-w-6xl`: treść (cennik/zespół) + prawa szpalta sticky (karta „Zarezerwuj": godziny, adres, CTA) |
| Flow rezerwacji | pełna szerokość, jak s3–s7 | wycentrowana kolumna `max-w-lg` | `max-w-4xl`: krok po lewej, sticky podsumowanie rezerwacji (usługa · pracownik · termin · cena) po prawej |
| Panel firmy | nawigacja: pigułki → przewijane poziomo lub menu w Sheet; kalendarz: przewijanie poziome z przyklejoną osią godzin (kolumna pracownika `min-w-[220px]`); tabele → karty | kalendarz 2–3 kolumny widoczne | jak prototyp (pełna siatka), treść `max-w-[1400px]` |
| Panel pracownika | lista wizyt 1 kolumna | `max-w-2xl` | `max-w-3xl` + statystyki dnia w wierszu 3 kart |
| Auth | pełna szerokość, padding 20px | `max-w-md` wycentrowane | `max-w-md` wycentrowane |
| Stany brzegowe | jak prototyp | wycentrowane `max-w-md` | wycentrowane `max-w-md` |

Zasady twarde:
- Cele dotykowe ≥44px na telefonie/tablecie (przyciski slotów, chipy, wiersze akcji).
- Szerokie elementy (kalendarz, tabele) przewijają się we własnym kontenerze `overflow-x-auto` —
  strona nigdy nie scrolluje poziomo.
- Dialogi: na telefonie pełnoekranowe lub jako Sheet od dołu, od `md` zwykły Dialog.
- Siatka slotów: 3 kolumny na telefonie, 4 na md, 5–6 na lg.
- Nic nie znika bez zamiennika: funkcja ukrywana na telefonie musi mieć dostęp alternatywny
  (menu, sheet, link).

## Zasady

1. Kwoty w groszach z bazy — formatowanie wyłącznie `Intl.NumberFormat("pl-PL", { style: "currency", currency })`.
2. Czasy i daty prezentowane w strefie lokalizacji (`Location.timezone`), nigdy w strefie przeglądarki.
3. Język UI: polski. Daty: „pt 31.07, 11:00" (dzień tygodnia skrócony, bez roku w obrębie miesiąca).
4. Komponenty shadcn w `src/components/ui/` — używać, nie forkować; odchylenia stylu przez `className`.
5. Współdzielone komponenty domenowe → `src/components/`, komponenty jednego ekranu → obok route'a.
