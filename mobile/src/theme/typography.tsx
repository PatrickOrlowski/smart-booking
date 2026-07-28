import type { ReactNode } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { colors, fonts } from "./tokens";

/**
 * Komponenty tekstowe marki — zamiast surowego <Text> w ekranach.
 *
 * - DisplayText: Bricolage Grotesque 600–800, ciasny tracking (nagłówki,
 *   nazwy firm, duże liczby).
 * - BodyText: Instrument Sans 400–700 (cały pozostały tekst).
 * - MetaLabel: DM Mono 10px, uppercase, tracking .1em (etykiety sekcji).
 * - MonoText: DM Mono dla cen, czasów i liczników w treści.
 */

type BaseProps = {
  children: ReactNode;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
};

type DisplayWeight = 600 | 700 | 800;

const displayFontByWeight: Record<DisplayWeight, string> = {
  600: fonts.displaySemiBold,
  700: fonts.display,
  800: fonts.displayExtraBold,
};

export function DisplayText({
  children,
  size = 24,
  weight = 700,
  color = colors.foreground,
  style,
  numberOfLines,
}: BaseProps & { size?: number; weight?: DisplayWeight }) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          fontFamily: displayFontByWeight[weight],
          fontSize: size,
          // tracking-tight z DESIGN.md: ok. -.02em, mocniej dla dużych nagłówków
          letterSpacing: size * (size >= 28 ? -0.03 : -0.02),
          lineHeight: size * (size >= 28 ? 1.02 : 1.15),
          color,
        },
        style,
      ]}>
      {children}
    </Text>
  );
}

type SansWeight = 400 | 500 | 600 | 700;

const sansFontByWeight: Record<SansWeight, string> = {
  400: fonts.sans,
  500: fonts.sansMedium,
  600: fonts.sansSemiBold,
  700: fonts.sansBold,
};

export function BodyText({
  children,
  size = 14,
  weight = 400,
  color = colors.foreground,
  style,
  numberOfLines,
}: BaseProps & { size?: number; weight?: SansWeight }) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          fontFamily: sansFontByWeight[weight],
          fontSize: size,
          lineHeight: size * 1.45,
          color,
        },
        style,
      ]}>
      {children}
    </Text>
  );
}

/** Etykieta sekcji: „LOKALIZACJA", „KROK 1 / 3". Tekst podawaj bez uppercase — robimy go tutaj. */
export function MetaLabel({
  children,
  color = colors.mutedForeground,
  size = 10,
  style,
  numberOfLines,
}: BaseProps & { size?: number }) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          fontFamily: fonts.mono,
          fontSize: size,
          letterSpacing: size * 0.1,
          textTransform: "uppercase",
          color,
        },
        style,
      ]}>
      {children}
    </Text>
  );
}

/** Ceny, godziny, liczniki w treści: „30 min · 70 zł", „15:30". */
export function MonoText({
  children,
  size = 12,
  weight = 400,
  color = colors.foreground,
  style,
  numberOfLines,
}: BaseProps & { size?: number; weight?: 400 | 500 }) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          fontFamily: weight === 500 ? fonts.monoMedium : fonts.mono,
          fontSize: size,
          color,
        },
        style,
      ]}>
      {children}
    </Text>
  );
}
