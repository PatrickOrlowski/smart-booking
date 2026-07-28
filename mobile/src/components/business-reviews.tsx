import { StyleSheet, View } from "react-native";

import type { BusinessDetail } from "@/api/client";
import {
  ratingValueLabel,
  reviewsCountLabel,
} from "@/components/business-format";
import { borderWidths, colors, radii, spacing } from "@/theme/tokens";
import { BodyText, DisplayText } from "@/theme/typography";

/**
 * Zakładka „Opinie" profilu firmy.
 *
 * Publiczne API zwraca wyłącznie zagregowaną ocenę (średnia + liczba) —
 * bez treści pojedynczych opinii i odpowiedzi lokalu. Pokazujemy więc
 * duże podsumowanie i uczciwą zapowiedź listy zamiast atrap.
 */
export function BusinessReviews({
  rating,
}: {
  rating: BusinessDetail["rating"];
}) {
  if (rating.count === 0 || rating.average === null) {
    return (
      <View style={styles.emptyCard}>
        <BodyText size={13} weight={700}>
          Jeszcze bez ocen
        </BodyText>
        <BodyText
          size={12}
          color={colors.mutedForeground}
          style={styles.cardText}>
          Opinię można wystawić tylko po zakończonej wizycie — ta firma nie
          zebrała jeszcze żadnej.
        </BodyText>
      </View>
    );
  }

  const filledStars = Math.min(5, Math.max(0, Math.round(rating.average)));

  return (
    <View style={styles.wrap}>
      <View style={styles.summaryCard}>
        <DisplayText size={38} weight={800}>
          {ratingValueLabel(rating.average)}
        </DisplayText>
        <View style={styles.summaryBody}>
          <BodyText size={16}>
            <BodyText size={16} color={colors.foreground}>
              {"★".repeat(filledStars)}
            </BodyText>
            <BodyText size={16} color={colors.border}>
              {"★".repeat(5 - filledStars)}
            </BodyText>
          </BodyText>
          <BodyText
            size={12}
            color={colors.mutedForeground}
            style={styles.summaryMeta}>
            {reviewsCountLabel(rating.count)} · wyłącznie po zakończonych
            wizytach
          </BodyText>
        </View>
      </View>

      <View style={styles.noteCard}>
        <BodyText size={13} weight={700}>
          Treści opinii wkrótce
        </BodyText>
        <BodyText
          size={12}
          color={colors.mutedForeground}
          style={styles.cardText}>
          Pracujemy nad listą pojedynczych opinii wraz z odpowiedziami lokalu.
          Na razie widzisz łączną ocenę klientów.
        </BodyText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    backgroundColor: colors.card,
    borderWidth: borderWidths.hairline,
    borderColor: colors.border,
    borderRadius: radii.card,
    padding: spacing.lg,
  },
  summaryBody: {
    flex: 1,
    minWidth: 0,
  },
  summaryMeta: {
    marginTop: 3,
  },
  noteCard: {
    backgroundColor: colors.highlight,
    borderWidth: borderWidths.hairline,
    borderColor: colors.borderDashed,
    borderStyle: "dashed",
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  emptyCard: {
    marginTop: spacing.xl,
    backgroundColor: colors.highlight,
    borderWidth: borderWidths.hairline,
    borderColor: colors.borderDashed,
    borderStyle: "dashed",
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  cardText: {
    marginTop: spacing.xs,
  },
});
