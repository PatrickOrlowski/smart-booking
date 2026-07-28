/**
 * Tokeny designu — jedyne źródło kolorów/fontów/geometrii w aplikacji.
 * Wartości 1:1 z design/DESIGN.md (paleta shadcn webu). Ekrany NIE hardkodują
 * hexów — zawsze importują stąd.
 */

export const colors = {
  /** Tło aplikacji (krem). */
  background: "#f2eee6",
  /** Karty, powierzchnie. */
  card: "#fffdf9",
  /** Tekst podstawowy (atrament). */
  foreground: "#131412",
  /** Akcje, CTA, aktywne stany (butelkowa zieleń). */
  primary: "#143d31",
  /** Tekst na primary. */
  primaryForeground: "#f7f4ef",
  /** Jaśniejszy klocek NA karcie primary — chipy godzin (prototyp s3). */
  primaryTint: "#1f5645",
  /** Tekst drugorzędny na primary (prototyp: #b8cbc0). */
  primaryForegroundMuted: "rgba(247,244,239,0.72)",
  /** Tła drugorzędne. */
  muted: "#ece7dd",
  secondary: "#eae5db",
  /** Tekst drugorzędny. */
  mutedForeground: "#6d6a63",
  /** Jaśniejszy wariant tekstu drugorzędnego. */
  mutedForegroundLight: "#8f8b81",
  /** Zielony tint — pola „wolny termin", potwierdzenia. */
  accent: "#eaf1ec",
  /** Jasny pas placeholdera zdjęcia (prototyp: repeating-linear-gradient 135deg z muted). */
  photoStripe: "#f5f1e9",
  /** Obramowania zwykłe (1px). */
  border: "#ddd7ca",
  /** Obrys wyróżnionych kart/inputów — zawsze 1.5px. */
  borderStrong: "#131412",
  /** Delikatniejszy separator (wiersze cennika, zakładki). */
  separator: "#eae5db",
  /** Tło wyróżnionego wiersza/pustego stanu (prototyp s2/s7). */
  highlight: "#f7f4ef",
  /** Kreskowany obrys kart pustego stanu (prototyp s7). */
  borderDashed: "#cfc8b8",
  /** Dostępność, statusy pozytywne. */
  success: "#14803f",
  successSoft: "#eaf1ec",
  successSoftBorder: "#cfe0d5",
  /** Oczekujące, ostrzeżenia (np. pasek holda). */
  warning: "#b4771f",
  warningStrong: "#7a5312",
  warningSoft: "#fdf3e3",
  warningSoftBorder: "#ecd7ab",
  /** Anulowania, no-show, błędy. */
  destructive: "#a83228",
  /** Tint i obrys plakietki błędu (webowe karty stanów brzegowych). */
  destructiveSoft: "#f4e3e0",
  destructiveSoftBorder: "#d9a9a1",
  /** Najdelikatniejszy obrys akcji destrukcyjnej (przycisk odwołania wizyty). */
  destructiveMutedBorder: "#e0c9c5",
  /** Przyciemnienie tła pod dialogami — atrament (ink) 45%. */
  overlay: "rgba(19, 20, 18, 0.45)",
  /** Ciemny top-bar, inwersje. */
  ink: "#131412",
  inkForeground: "#f7f4ef",
} as const;

/**
 * Nazwy fontów po załadowaniu przez expo-font (patrz src/app/_layout.tsx).
 * Display = Bricolage Grotesque, tekst = Instrument Sans, meta = DM Mono.
 */
export const fonts = {
  displaySemiBold: "BricolageGrotesque_600SemiBold",
  display: "BricolageGrotesque_700Bold",
  displayExtraBold: "BricolageGrotesque_800ExtraBold",
  sans: "InstrumentSans_400Regular",
  sansMedium: "InstrumentSans_500Medium",
  sansSemiBold: "InstrumentSans_600SemiBold",
  sansBold: "InstrumentSans_700Bold",
  mono: "DMMono_400Regular",
  monoMedium: "DMMono_500Medium",
} as const;

/** Odstępy: sekcje 20–28, wnętrza kart 13–16 (DESIGN.md „Geometria"). */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 13,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

/** Promienie: inputy 14, karty 18, pigułki 999. */
export const radii = {
  sm: 9,
  md: 11,
  input: 14,
  lg: 16,
  card: 18,
  pill: 999,
} as const;

/** Grubość obrysu wyróżnienia — zamiast cienia. */
export const borderWidths = {
  hairline: 1,
  strong: 1.5,
} as const;
