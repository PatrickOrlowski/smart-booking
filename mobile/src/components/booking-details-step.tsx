import { useState } from "react";
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";

import {
  ApiError,
  createBooking,
  type BookingPayment,
  type BusinessService,
  type CreatedBooking,
} from "@/api/client";
import { formatCountdown, formatDuration } from "@/components/booking-format";
import type { SlotHold } from "@/components/booking-hooks";
import {
  BackCircle,
  PrimaryButton,
  StateCard,
  StepHeading,
} from "@/components/booking-ui";
import { formatDayShort, formatTime } from "@/lib/format";
import { borderWidths, colors, fonts, radii, spacing } from "@/theme/tokens";
import { BodyText, MonoText } from "@/theme/typography";

/** Dane rezerwującego gościa — stan żyje na poziomie flow (przetrwa 409). */
export type GuestDetails = { name: string; phone: string; email: string };

/**
 * Krok 3/3 — dane i potwierdzenie (prototyp s5): pasek blokady terminu
 * z licznikiem mm:ss, podsumowanie z ceną (DM Mono), formularz gościa
 * z lokalną walidacją i CTA. Stany brzegowe wg prototypu: 409 → karta
 * „Termin przepadł" (dane klienta zostają), wygaśnięcie blokady → karta
 * z powrotem do slotów, 403 → „Rezerwacja online niedostępna".
 */

export function BookingDetailsStep({
  slug,
  service,
  resourceId,
  staffLabel,
  timezone,
  cancellationCutoffHours,
  priceText,
  startAtIso,
  hold,
  guest,
  onGuestChange,
  onBack,
  onBackToSlots,
  onSuccess,
}: {
  slug: string;
  service: BusinessService;
  resourceId: string;
  staffLabel: string;
  timezone: string;
  cancellationCutoffHours: number;
  priceText: string;
  startAtIso: string;
  hold: SlotHold;
  guest: GuestDetails;
  onGuestChange: (patch: Partial<GuestDetails>) => void;
  onBack: () => void;
  /** Powrót do listy godzin ze świeżym pobraniem slotów. */
  onBackToSlots: () => void;
  onSuccess: (booking: CreatedBooking, payment: BookingPayment | null) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  // Fokus po marce: obrys 1.5px atramentu zamiast systemowej niebieskiej
  // obwódki (RNW rysuje outline — zerujemy go stylem web-align w RN 0.86).
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const fieldStyle = (
    field: string,
    extra?: StyleProp<TextStyle>,
  ): StyleProp<TextStyle> => [
    styles.input,
    extra,
    focusedField === field && styles.inputStrong,
  ];

  const timeLabel = formatTime(startAtIso, timezone);

  // Konflikt przychodzi dwiema drogami: przy zakładaniu blokady (zaraz po
  // wejściu w krok) albo dopiero przy POST /bookings. Blokada klienta (403)
  // analogicznie.
  const activeConflict =
    conflict ?? (hold.status === "conflict" ? hold.message : null);
  const activeBlocked =
    blocked ?? (hold.status === "blocked" ? hold.message : null);
  const holdExpired = hold.status === "expired";

  const submit = async () => {
    setError(null);
    if (guest.name.trim().length < 2) {
      setError("Podaj imię i nazwisko.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(guest.email.trim())) {
      setError("Podaj poprawny adres e-mail.");
      return;
    }
    if (guest.phone.trim().replace(/[^\d]/g, "").length < 7) {
      setError("Podaj poprawny numer telefonu.");
      return;
    }
    setSubmitting(true);
    try {
      const { booking, payment } = await createBooking({
        businessSlug: slug,
        serviceId: service.id,
        resourceId: resourceId !== "any" ? resourceId : undefined,
        startAt: startAtIso,
        holdToken: hold.token ?? undefined,
        guest: {
          name: guest.name.trim(),
          email: guest.email.trim(),
          phone: guest.phone.trim(),
        },
      });
      onSuccess(booking, payment ?? null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        // SLOT_TAKEN / SLOT_HELD / HOLD_EXPIRED — termin przepadł.
        setConflict(caught.message);
      } else if (caught instanceof ApiError && caught.status === 403) {
        setBlocked(caught.message);
      } else if (caught instanceof ApiError) {
        setError(caught.message);
      } else {
        setError("Nie udało się utworzyć rezerwacji. Spróbuj ponownie.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const stateVisible = Boolean(activeConflict) || holdExpired || activeBlocked;

  return (
    <View>
      <BackCircle onPress={onBack} />

      {activeConflict ? (
        <StateCard
          badge={{
            symbol: "!",
            color: colors.destructive,
            background: colors.destructiveSoft,
            border: colors.destructiveSoftBorder,
          }}
          title={`Termin ${timeLabel} przepadł`}
          message={`${activeConflict} Twoje dane zostają — nie wpisujesz ich drugi raz.`}
          cta="Pokaż wolne terminy"
          onCta={onBackToSlots}
        />
      ) : null}

      {holdExpired && !activeConflict ? (
        <StateCard
          badge={{
            symbol: "⏱",
            color: colors.warningStrong,
            background: colors.warningSoft,
            border: colors.warningSoftBorder,
          }}
          title="Blokada terminu wygasła"
          message={`Godzinę ${timeLabel} trzymaliśmy dla Ciebie 10 minut. Wróć do listy — pokażemy odświeżoną dostępność.`}
          cta="Pokaż wolne terminy"
          onCta={onBackToSlots}
        />
      ) : null}

      {activeBlocked ? (
        <StateCard
          badge={{
            symbol: "✕",
            color: colors.destructive,
            background: colors.destructiveSoft,
            border: colors.destructiveSoftBorder,
          }}
          title="Rezerwacja online niedostępna"
          message={activeBlocked}
        />
      ) : null}

      {!stateVisible ? (
        <View style={styles.holdBanner}>
          <View style={styles.holdDot} />
          <BodyText
            size={12}
            weight={600}
            color={colors.warningStrong}
            style={styles.holdText}>
            {hold.status === "error"
              ? "Blokady nie udało się założyć — rezerwuj dalej, termin może zająć ktoś inny."
              : "Termin zablokowany dla Ciebie"}
          </BodyText>
          {hold.status !== "error" ? (
            <MonoText
              size={17}
              weight={500}
              color={
                hold.remainingMs !== null && hold.remainingMs < 120_000
                  ? colors.destructive
                  : colors.warningStrong
              }>
              {hold.status === "active" && hold.remainingMs !== null
                ? formatCountdown(hold.remainingMs)
                : "--:--"}
            </MonoText>
          ) : null}
        </View>
      ) : null}

      <StepHeading meta="Krok 3 / 3 · Dane" title="Prawie gotowe." />

      <View style={styles.summaryCard}>
        <View style={styles.summaryTop}>
          <BodyText size={14} weight={600} style={styles.summaryService}>
            {service.name}
          </BodyText>
          <MonoText size={14} weight={500}>
            {priceText}
          </MonoText>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryRow}>
          <BodyText size={13} color={colors.mutedForeground}>
            Termin
          </BodyText>
          <MonoText size={13} weight={500}>
            {formatDayShort(startAtIso, timezone)} · {timeLabel}
          </MonoText>
        </View>
        <View style={styles.summaryRow}>
          <BodyText size={13} color={colors.mutedForeground}>
            Pracownik
          </BodyText>
          <BodyText size={13} weight={600}>
            {resourceId === "any" ? "Przypisany przy potwierdzeniu" : staffLabel}
          </BodyText>
        </View>
        <View style={styles.summaryRow}>
          <BodyText size={13} color={colors.mutedForeground}>
            Czas trwania
          </BodyText>
          <MonoText size={13}>{formatDuration(service.durationMin)}</MonoText>
        </View>
      </View>

      <View style={styles.form}>
        <View>
          <BodyText size={11} weight={600} color={colors.mutedForeground}>
            Imię i nazwisko
          </BodyText>
          <TextInput
            value={guest.name}
            onChangeText={(value) => onGuestChange({ name: value })}
            autoComplete="name"
            onFocus={() => setFocusedField("name")}
            onBlur={() => setFocusedField(null)}
            style={[styles.input, styles.inputStrong]}
          />
        </View>
        <View>
          <BodyText size={11} weight={600} color={colors.mutedForeground}>
            Telefon{" "}
            <BodyText size={11} color={colors.mutedForegroundLight}>
              · na SMS z przypomnieniem
            </BodyText>
          </BodyText>
          <TextInput
            value={guest.phone}
            onChangeText={(value) => onGuestChange({ phone: value })}
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholder="+48 600 000 000"
            placeholderTextColor={colors.mutedForegroundLight}
            onFocus={() => setFocusedField("phone")}
            onBlur={() => setFocusedField(null)}
            style={fieldStyle("phone", styles.inputMono)}
          />
        </View>
        <View>
          <BodyText size={11} weight={600} color={colors.mutedForeground}>
            E-mail
          </BodyText>
          <TextInput
            value={guest.email}
            onChangeText={(value) => onGuestChange({ email: value })}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            placeholder="anna@example.com"
            placeholderTextColor={colors.mutedForegroundLight}
            onFocus={() => setFocusedField("email")}
            onBlur={() => setFocusedField(null)}
            style={fieldStyle("email")}
          />
        </View>
      </View>

      <View style={styles.policyCard}>
        <BodyText size={12} weight={700} style={styles.policyTitle}>
          Zasady odwołania
        </BodyText>
        <BodyText size={11.5} color={colors.foreground}>
          Bezpłatnie do{" "}
          <BodyText size={11.5} weight={700}>
            {cancellationCutoffHours} h
          </BodyText>{" "}
          przed wizytą. Później termin przepada.
        </BodyText>
      </View>

      {error ? (
        <BodyText
          size={13}
          weight={600}
          color={colors.destructive}
          style={styles.error}>
          {error}
        </BodyText>
      ) : null}

      <View style={styles.ctaWrap}>
        <PrimaryButton
          label={
            submitting ? "Rezerwuję…" : `Potwierdzam rezerwację · ${priceText}`
          }
          onPress={submit}
          disabled={
            submitting ||
            Boolean(activeConflict) ||
            Boolean(activeBlocked) ||
            holdExpired ||
            // Chwila na odpowiedź z /api/v1/holds — inaczej najszybsi
            // klienci rezerwowaliby z pominięciem blokady.
            hold.status === "creating"
          }
        />
      </View>
      {/* API profilu firmy nie zdradza `depositRequired` przed rezerwacją,
          więc nie obiecujemy „bez zadatku" — ewentualny zadatek pokazuje
          ekran sukcesu na bazie `payment` z POST /bookings. */}
      <BodyText
        size={11}
        color={colors.mutedForegroundLight}
        style={styles.ctaCaption}>
        Płatność w lokalu. Jeśli usługa wymaga zadatku, pokażemy go po
        potwierdzeniu.
      </BodyText>
    </View>
  );
}

const styles = StyleSheet.create({
  holdBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: colors.warningSoft,
    borderWidth: borderWidths.hairline,
    borderColor: colors.warningSoftBorder,
    borderRadius: radii.md + 1,
    paddingVertical: 10,
    paddingHorizontal: spacing.md - 1,
    marginBottom: spacing.lg + 2,
  },
  holdDot: {
    width: 7,
    height: 7,
    borderRadius: radii.pill,
    backgroundColor: colors.warning,
  },
  holdText: {
    flex: 1,
    minWidth: 0,
  },
  summaryCard: {
    backgroundColor: colors.highlight,
    borderWidth: borderWidths.hairline,
    borderColor: colors.separator,
    borderRadius: radii.lg,
    padding: 15,
    marginBottom: spacing.xl,
  },
  summaryTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  summaryService: {
    flex: 1,
    minWidth: 0,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: colors.separator,
    marginVertical: 11,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: spacing.md,
    marginTop: 6,
  },
  form: {
    gap: 11,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: borderWidths.hairline,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    fontSize: 14,
    fontFamily: fonts.sans,
    color: colors.foreground,
    marginTop: 5,
    minHeight: 44,
    // Fokus sygnalizuje obrys 1.5px atramentu (inputStrong), nie systemowa
    // obwódka przeglądarki.
    outlineWidth: 0,
  },
  inputStrong: {
    borderWidth: borderWidths.strong,
    borderColor: colors.borderStrong,
  },
  inputMono: {
    fontFamily: fonts.mono,
  },
  policyCard: {
    backgroundColor: colors.card,
    borderWidth: borderWidths.hairline,
    borderColor: colors.separator,
    borderRadius: radii.input,
    padding: spacing.md,
    marginTop: spacing.xl,
  },
  policyTitle: {
    marginBottom: 6,
  },
  error: {
    marginTop: spacing.md,
  },
  ctaWrap: {
    marginTop: spacing.lg + 2,
  },
  ctaCaption: {
    textAlign: "center",
    marginTop: 9,
  },
});
