import { Pressable, StyleSheet, View } from "react-native";

import type { BusinessListItem } from "@/api/client";
import { BUSINESS_TYPE_LABELS } from "@/components/business-format";
import { BusinessPhoto } from "@/components/business-photo";
import { formatPrice } from "@/lib/format";
import { borderWidths, colors, radii, spacing } from "@/theme/tokens";
import { BodyText, DisplayText, MonoText } from "@/theme/typography";

/**
 * Karta firmy na liście wyników (prototyp s1).
 *
 * - `featured` (pierwszy wynik): obrys 1.5px atramentu, zdjęcie 16:9
 *   na górze, opis pod adresem.
 * - zwykła: wiersz z miniaturą 62px i cienkim obrysem.
 *
 * API listy nie zwraca oceny — w slocie DM Mono (u prototypu „4,9 (312)")
 * pokazujemy typ firmy.
 */
export function BusinessCard({
  business,
  featured = false,
  onPress,
}: {
  business: BusinessListItem;
  featured?: boolean;
  onPress: () => void;
}) {
  const location = business.locations[0];
  const address = location
    ? `${location.addressLine1} · ${location.city}`
    : null;
  // 0 gr = najtańsza usługa jest gratisowa (np. konsultacja) — „od 0 zł"
  // wprowadzałoby w błąd, więc cenę chowamy.
  const priceFrom =
    business.priceFromCents !== null && business.priceFromCents > 0
      ? `od ${formatPrice(business.priceFromCents, business.currency)}`
      : null;
  const typeLabel = BUSINESS_TYPE_LABELS[business.type];

  if (!featured) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={business.name}
        style={({ pressed }) => [styles.rowCard, pressed && styles.pressed]}>
        <BusinessPhoto style={styles.thumb} />
        <View style={styles.rowBody}>
          <DisplayText size={16} weight={700} numberOfLines={1}>
            {business.name}
          </DisplayText>
          <BodyText
            size={12}
            color={colors.mutedForeground}
            numberOfLines={1}
            style={styles.rowMeta}>
            {typeLabel}
            {address ? ` · ${address}` : ""}
          </BodyText>
          {priceFrom ? (
            <MonoText size={12} weight={500} style={styles.rowPrice}>
              {priceFrom}
            </MonoText>
          ) : null}
        </View>
        <BodyText size={14} color={colors.mutedForegroundLight}>
          ›
        </BodyText>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={business.name}
      style={({ pressed }) => [styles.featuredCard, pressed && styles.pressed]}>
      <BusinessPhoto label="Zdjęcie lokalu 16:9" style={styles.featuredPhoto} />
      <View style={styles.featuredBody}>
        <View style={styles.featuredTitleRow}>
          <DisplayText
            size={17}
            weight={700}
            numberOfLines={2}
            style={styles.featuredName}>
            {business.name}
          </DisplayText>
          <MonoText size={12} weight={500} color={colors.mutedForeground}>
            {typeLabel}
          </MonoText>
        </View>
        <BodyText
          size={12}
          color={colors.mutedForeground}
          numberOfLines={1}
          style={styles.featuredMeta}>
          {address ?? ""}
          {address && priceFrom ? " · " : ""}
          {priceFrom ? (
            <MonoText size={12} weight={500}>
              {priceFrom}
            </MonoText>
          ) : null}
        </BodyText>
        {business.description ? (
          <BodyText
            size={12}
            color={colors.mutedForeground}
            numberOfLines={2}
            style={styles.featuredDescription}>
            {business.description}
          </BodyText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.85,
  },
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.card,
    borderWidth: borderWidths.hairline,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingVertical: spacing.md,
    paddingHorizontal: 15,
  },
  thumb: {
    width: 62,
    height: 62,
    borderRadius: 12,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowMeta: {
    marginTop: 2,
  },
  rowPrice: {
    marginTop: 6,
  },
  featuredCard: {
    backgroundColor: colors.card,
    borderWidth: borderWidths.strong,
    borderColor: colors.borderStrong,
    borderRadius: radii.card,
    overflow: "hidden",
  },
  featuredPhoto: {
    height: 112,
  },
  featuredBody: {
    paddingTop: spacing.md,
    paddingHorizontal: 15,
    paddingBottom: 15,
  },
  featuredTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  featuredName: {
    flex: 1,
    minWidth: 0,
  },
  featuredMeta: {
    marginTop: 3,
  },
  featuredDescription: {
    marginTop: 7,
  },
});
