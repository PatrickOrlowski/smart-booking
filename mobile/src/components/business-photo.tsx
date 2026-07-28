import { memo } from "react";
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { colors } from "@/theme/tokens";
import { MetaLabel } from "@/theme/typography";

/**
 * Placeholder zdjęcia lokalu — ukośne pasy jak
 * `repeating-linear-gradient(135deg, #ece7dd 0 9px, #f5f1e9 9px 18px)`
 * z prototypu, złożone z obróconych pasków View (działa na native i web).
 * Rozmiar/promień nadaje rodzic przez `style` (np. wysokość 112 karty listy).
 */

const STRIPE_WIDTH = 9;
/** Kwadrat pasów obrócony o 45° musi przykryć największy placeholder (390×180). */
const CANVAS = 600;
const STRIPE_COUNT = Math.ceil(CANVAS / STRIPE_WIDTH);

function BusinessPhotoBase({
  label,
  style,
}: {
  /** Napis DM Mono na środku, np. „ZDJĘCIE LOKALU 16:9". */
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.container, style]}>
      <View pointerEvents="none" style={styles.stripes}>
        {Array.from({ length: STRIPE_COUNT }, (_, index) => (
          <View
            key={index}
            style={[styles.stripe, index % 2 === 1 && styles.stripeAlt]}
          />
        ))}
      </View>
      {label ? (
        <MetaLabel color={colors.mutedForegroundLight}>{label}</MetaLabel>
      ) : null}
    </View>
  );
}

export const BusinessPhoto = memo(BusinessPhotoBase);

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.photoStripe,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  stripes: {
    position: "absolute",
    width: CANVAS,
    height: CANVAS,
    top: "50%",
    left: "50%",
    marginTop: -CANVAS / 2,
    marginLeft: -CANVAS / 2,
    flexDirection: "row",
    // 45° daje pasy „/" — jak repeating-linear-gradient(135deg) w prototypie.
    transform: [{ rotate: "45deg" }],
  },
  stripe: {
    width: STRIPE_WIDTH,
    height: "100%",
    backgroundColor: colors.muted,
  },
  stripeAlt: {
    backgroundColor: colors.photoStripe,
  },
});
