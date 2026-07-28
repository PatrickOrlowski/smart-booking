import * as Linking from "expo-linking";
import { Pressable, StyleSheet, View } from "react-native";

import type { BookingPayment, CreatedBooking } from "@/api/client";
import { formatDuration } from "@/components/booking-format";
import {
  formatDayFull,
  formatDayShort,
  formatPrice,
  formatTime,
} from "@/lib/format";
import { borderWidths, colors, radii, spacing } from "@/theme/tokens";
import { BodyText, DisplayText, MetaLabel, MonoText } from "@/theme/typography";

/**
 * Ekran sukcesu (prototyp s6): znacznik ✓, wielkie „Zarezerwowane.",
 * bilet z godziną w display 38, szczegółami wizyty i ceną w DM Mono,
 * CTA „Zobacz moje wizyty". Wizytę do AsyncStorage zapisuje rodzic
 * (flow) — tu tylko prezentacja.
 */

export function BookingSuccess({
  booking,
  payment,
  email,
  onGoToVisits,
}: {
  booking: CreatedBooking;
  /** Zadatek z POST /bookings — null, gdy usługa go nie wymaga. */
  payment: BookingPayment | null;
  email: string;
  onGoToVisits: () => void;
}) {
  const timezone = booking.timezone;

  return (
    <View style={styles.wrap}>
      <View style={styles.checkCircle}>
        <BodyText size={26} color={colors.primaryForeground}>
          ✓
        </BodyText>
      </View>
      <DisplayText size={32} weight={800} style={styles.title}>
        Zarezerwowane.
      </DisplayText>
      <BodyText size={14} color={colors.foreground} style={styles.subtitle}>
        Potwierdzenie poszło na {email}. Szczegóły wizyty znajdziesz też w
        zakładce Moje wizyty.
      </BodyText>

      <View style={styles.ticket}>
        <View style={styles.ticketTop}>
          <MetaLabel>{formatDayFull(booking.startAt, timezone)}</MetaLabel>
          <DisplayText size={38} weight={800} style={styles.time}>
            {formatTime(booking.startAt, timezone)}
          </DisplayText>
          <BodyText size={14} weight={600}>
            {booking.serviceName} · {formatDuration(booking.durationMin)}
          </BodyText>
          <BodyText
            size={13}
            color={colors.mutedForeground}
            style={styles.staffLine}>
            {booking.resourceName} · {booking.businessName}
          </BodyText>
        </View>
        <View style={styles.ticketBottom}>
          <View style={styles.ticketAddress}>
            <BodyText size={12} color={colors.mutedForeground}>
              {booking.address}
            </BodyText>
            <MonoText
              size={11}
              color={colors.mutedForegroundLight}
              style={styles.bookingId}>
              #{booking.id.slice(-8).toUpperCase()}
            </MonoText>
          </View>
          <MonoText size={16} weight={500}>
            {formatPrice(booking.priceCents, booking.currency)}
          </MonoText>
        </View>
      </View>

      {payment ? (
        <View style={styles.depositCard}>
          <BodyText size={12} weight={700} style={styles.depositTitle}>
            Zadatek {formatPrice(payment.amountCents, payment.currency)}
          </BodyText>
          <BodyText size={11.5} color={colors.mutedForeground}>
            {payment.redirectUrl
              ? "Usługa wymaga zadatku — opłać go online, żeby zachować termin."
              : "Usługa wymaga zadatku — zapłacisz go na miejscu w lokalu."}
          </BodyText>
          {payment.redirectUrl ? (
            <Pressable
              onPress={() => {
                Linking.openURL(payment.redirectUrl as string).catch(() => {});
              }}
              style={({ pressed }) => [
                styles.depositCta,
                pressed && styles.pressed,
              ]}>
              <BodyText
                size={13}
                weight={600}
                color={colors.primaryForeground}>
                Opłać zadatek
              </BodyText>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <Pressable
        onPress={onGoToVisits}
        style={({ pressed }) => [styles.cta, pressed && styles.pressed]}>
        <BodyText size={14} weight={700} color={colors.primaryForeground}>
          Zobacz moje wizyty
        </BodyText>
      </Pressable>

      <BodyText
        size={11.5}
        color={colors.mutedForegroundLight}
        style={styles.cancelNote}>
        Odwołanie bezpłatne do {booking.cancellationCutoffHours} h przed (do{" "}
        {formatDayShort(booking.cancellationDeadline, timezone)},{" "}
        {formatTime(booking.cancellationDeadline, timezone)}).
      </BodyText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: spacing.xxl,
  },
  checkCircle: {
    width: 58,
    height: 58,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xl,
  },
  title: {
    marginBottom: spacing.sm,
  },
  subtitle: {
    marginBottom: 22,
  },
  ticket: {
    backgroundColor: colors.card,
    borderWidth: borderWidths.strong,
    borderColor: colors.borderStrong,
    borderRadius: radii.card,
    overflow: "hidden",
  },
  ticketTop: {
    padding: spacing.lg,
    borderBottomWidth: borderWidths.hairline,
    borderBottomColor: colors.borderDashed,
    borderStyle: "dashed",
  },
  time: {
    marginTop: 2,
    marginBottom: 4,
  },
  staffLine: {
    marginTop: 2,
  },
  ticketBottom: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  ticketAddress: {
    flex: 1,
    minWidth: 0,
  },
  bookingId: {
    marginTop: 3,
  },
  depositCard: {
    backgroundColor: colors.warningSoft,
    borderWidth: borderWidths.hairline,
    borderColor: colors.warningSoftBorder,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  depositTitle: {
    marginBottom: 4,
  },
  depositCta: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radii.md + 1,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  cta: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radii.md + 1,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
  },
  cancelNote: {
    marginTop: spacing.lg,
    textAlign: "center",
  },
  pressed: {
    opacity: 0.85,
  },
});
