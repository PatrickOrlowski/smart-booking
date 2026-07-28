import { Pressable, StyleSheet, View } from "react-native";

import { borderWidths, colors, radii, spacing } from "@/theme/tokens";
import { BodyText, DisplayText, MetaLabel } from "@/theme/typography";

/**
 * Drobne klocki wspólne dla kroków flow rezerwacji (prototyp s3–s6):
 * okrągły przycisk „wstecz", nagłówek kroku i CTA pełnej szerokości.
 * Kolory wyłącznie z tokenów — zero hexów.
 */

/** Okrągłe „←" z obrysem 1.5px atramentu (prototyp s3–s5). */
export function BackCircle({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel="Wstecz"
      hitSlop={8}
      style={({ pressed }) => [styles.backCircle, pressed && styles.pressed]}>
      <BodyText size={14}>←</BodyText>
    </Pressable>
  );
}

/** Meta „KROK X / 3 · NAZWA" + duży tytuł display + opcjonalny podtytuł. */
export function StepHeading({
  meta,
  title,
  subtitle,
}: {
  meta: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.heading}>
      <MetaLabel>{meta}</MetaLabel>
      <DisplayText size={29} weight={800} style={styles.headingTitle}>
        {title}
      </DisplayText>
      {subtitle ? (
        <BodyText size={13} color={colors.mutedForeground}>
          {subtitle}
        </BodyText>
      ) : null}
    </View>
  );
}

/** CTA pełnej szerokości: bg primary, radius 14, tekst 15/700. */
export function PrimaryButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.primaryButton,
        disabled && styles.primaryButtonDisabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <BodyText size={15} weight={700} color={colors.primaryForeground}>
        {label}
      </BodyText>
    </Pressable>
  );
}

/** Karta stanu brzegowego (konflikt / wygasła blokada / blokada klienta). */
export function StateCard({
  badge,
  title,
  message,
  cta,
  onCta,
}: {
  /** Znak w kółku nad tytułem, np. „!" albo „⏱". */
  badge: { symbol: string; color: string; background: string; border: string };
  title: string;
  message: string;
  cta?: string;
  onCta?: () => void;
}) {
  return (
    <View style={styles.stateCard}>
      <View
        style={[
          styles.stateBadge,
          { backgroundColor: badge.background, borderColor: badge.border },
        ]}>
        <BodyText size={17} color={badge.color}>
          {badge.symbol}
        </BodyText>
      </View>
      <DisplayText size={21} weight={800} style={styles.stateTitle}>
        {title}
      </DisplayText>
      <BodyText size={12.5} color={colors.foreground} style={styles.stateText}>
        {message}
      </BodyText>
      {cta && onCta ? (
        <Pressable
          onPress={onCta}
          style={({ pressed }) => [styles.stateCta, pressed && styles.pressed]}>
          <BodyText size={13} weight={700} color={colors.primaryForeground}>
            {cta}
          </BodyText>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Wiersz sekcji „szkieletu" ładowania — spokojny prostokąt bez animacji. */
export function SkeletonBlock({
  height,
  radius = radii.sm,
  style,
}: {
  height: number;
  radius?: number;
  style?: object;
}) {
  return (
    <View
      style={[
        { height, borderRadius: radius, backgroundColor: colors.muted },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  backCircle: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    borderWidth: borderWidths.strong,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  heading: {
    marginBottom: spacing.xl,
  },
  headingTitle: {
    marginTop: 6,
    marginBottom: 4,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.input,
    paddingVertical: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.85,
  },
  stateCard: {
    backgroundColor: colors.card,
    borderWidth: borderWidths.strong,
    borderColor: colors.borderStrong,
    borderRadius: radii.card,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  stateBadge: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    borderWidth: borderWidths.hairline,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  stateTitle: {
    marginBottom: 6,
  },
  stateText: {
    marginBottom: spacing.md + 1,
  },
  stateCta: {
    backgroundColor: colors.primary,
    borderRadius: radii.sm + 1,
    paddingVertical: spacing.md,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
});
