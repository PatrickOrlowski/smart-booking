import { Feather } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { Fragment } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { BusinessLocation } from "@/api/client";
import {
  WEEKDAYS_LONG,
  dayHoursLabel,
  zonedWeekdayMinutes,
} from "@/components/business-format";
import { borderWidths, colors, radii, spacing } from "@/theme/tokens";
import { BodyText, MetaLabel, MonoText } from "@/theme/typography";

/**
 * Zakładka „Info" profilu firmy: adres, telefon (tel:), godziny otwarcia
 * (weekday 0 = poniedziałek, dzisiejszy wiersz wyróżniony) i zasady
 * odwołania z cutoffu lokalizacji.
 */
export function BusinessInfo({ location }: { location: BusinessLocation }) {
  const { weekday: todayWeekday } = zonedWeekdayMinutes(location.timezone);
  const phoneHref = location.phone
    ? `tel:${location.phone.replace(/[\s-]/g, "")}`
    : null;

  return (
    <View style={styles.wrap}>
      <MetaLabel>Adres</MetaLabel>
      <View style={styles.card}>
        <BodyText size={14} weight={600}>
          {location.addressLine1}
        </BodyText>
        {location.addressLine2 ? (
          <BodyText size={13} style={styles.addressLine}>
            {location.addressLine2}
          </BodyText>
        ) : null}
        <BodyText
          size={12}
          color={colors.mutedForeground}
          style={styles.addressLine}>
          {location.postalCode ? `${location.postalCode} ` : ""}
          {location.city}
        </BodyText>
      </View>

      {location.phone && phoneHref ? (
        <>
          <MetaLabel style={styles.sectionLabel}>Kontakt</MetaLabel>
          <Pressable
            onPress={() => Linking.openURL(phoneHref)}
            accessibilityRole="button"
            accessibilityLabel={`Zadzwoń: ${location.phone}`}
            style={({ pressed }) => [
              styles.card,
              styles.phoneRow,
              pressed && styles.pressed,
            ]}>
            <View style={styles.phoneIcon}>
              <Feather name="phone" size={14} color={colors.primary} />
            </View>
            <MonoText size={14} weight={500} style={styles.phoneNumber}>
              {location.phone}
            </MonoText>
            <BodyText size={12} weight={600} color={colors.mutedForeground}>
              Zadzwoń
            </BodyText>
          </Pressable>
        </>
      ) : null}

      <MetaLabel style={styles.sectionLabel}>Godziny otwarcia</MetaLabel>
      <View style={styles.card}>
        {WEEKDAYS_LONG.map((dayName, weekday) => {
          const hours = dayHoursLabel(location.openingHours, weekday);
          const isToday = weekday === todayWeekday;
          return (
            <Fragment key={dayName}>
              {weekday > 0 ? <View style={styles.hoursRule} /> : null}
              <View style={styles.hoursRow}>
                <BodyText
                  size={13}
                  weight={isToday ? 700 : 400}
                  color={isToday ? colors.foreground : colors.mutedForeground}>
                  {dayName}
                </BodyText>
                <MonoText
                  size={12}
                  weight={isToday ? 500 : 400}
                  color={
                    hours ? colors.foreground : colors.mutedForegroundLight
                  }>
                  {hours ?? "nieczynne"}
                </MonoText>
              </View>
            </Fragment>
          );
        })}
      </View>

      <View style={styles.policyCard}>
        <BodyText size={12} weight={700}>
          Zasady odwołania
        </BodyText>
        <BodyText
          size={12}
          color={colors.mutedForeground}
          style={styles.policyText}>
          Bezpłatne odwołanie do {location.cancellationCutoffHours} h przed
          wizytą. Później termin przepada.
        </BodyText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.xl,
  },
  sectionLabel: {
    marginTop: spacing.xl,
  },
  card: {
    marginTop: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: borderWidths.hairline,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  addressLine: {
    marginTop: 2,
  },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 48,
  },
  phoneIcon: {
    width: 30,
    height: 30,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  phoneNumber: {
    flex: 1,
  },
  pressed: {
    opacity: 0.8,
  },
  hoursRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 7,
  },
  hoursRule: {
    height: borderWidths.hairline,
    backgroundColor: colors.separator,
  },
  policyCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.highlight,
    borderWidth: borderWidths.hairline,
    borderColor: colors.borderDashed,
    borderStyle: "dashed",
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  policyText: {
    marginTop: spacing.xs,
  },
});
