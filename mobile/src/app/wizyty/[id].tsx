import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ApiError,
  cancelBooking,
  getBooking,
  type BookingDetail,
} from "@/api/client";
import {
  BOOKING_STATUS_LABELS,
  formatDayFull,
  formatDayShort,
  formatPrice,
  formatTime,
  isCancelledStatus,
} from "@/lib/format";
import { listVisits, type StoredVisit } from "@/storage/visits";
import { borderWidths, colors, radii, spacing } from "@/theme/tokens";
import { BodyText, DisplayText, MetaLabel, MonoText } from "@/theme/typography";

/**
 * Szczegóły wizyty. E-mail (przepustkę do API) bierzemy z lokalnego wpisu
 * w AsyncStorage, pełne dane z GET /api/v1/bookings/[id]?email=. Anulowanie
 * po potwierdzeniu w dialogu; wpis lokalny zostaje po anulowaniu — lista
 * pokazuje badge „Odwołana", a ten ekran dalej ma e-mail do odczytu.
 * 422 po cutoffie pokazuje komunikat z API w dialogu.
 */

type LoadState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      booking: BookingDetail;
      email: string;
      /** „Teraz" z chwili odbioru danych — render musi być czysty. */
      checkedAtMs: number;
    };

export default function VisitDetailsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [justCancelled, setJustCancelled] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  // Wynik przypięty do klucza żądania: efekt nie ustawia stanu „loading"
  // synchronicznie (to kaskada renderów), a „Spróbuj ponownie" bumpuje klucz —
  // stara odpowiedź przestaje pasować, więc ekran sam wraca do spinnera.
  const requestKey = `${id ?? ""}|${reloadKey}`;
  const [result, setResult] = useState<{
    key: string;
    state: LoadState;
  } | null>(null);

  useEffect(() => {
    if (!id) return;
    let stale = false;
    (async () => {
      const stored: StoredVisit | undefined = (await listVisits()).find(
        (v) => v.bookingId === id,
      );
      if (stale) return;
      if (!stored) {
        setResult({ key: requestKey, state: { kind: "missing" } });
        return;
      }
      try {
        const { booking } = await getBooking(stored.bookingId, stored.email);
        if (!stale) {
          setResult({
            key: requestKey,
            state: {
              kind: "ready",
              booking,
              email: stored.email,
              checkedAtMs: Date.now(),
            },
          });
        }
      } catch (error) {
        if (!stale) {
          setResult({
            key: requestKey,
            state: {
              kind: "error",
              message:
                error instanceof ApiError
                  ? error.message
                  : "Coś poszło nie tak. Spróbuj ponownie.",
            },
          });
        }
      }
    })();
    return () => {
      stale = true;
    };
  }, [id, requestKey]);

  const state: LoadState = !id
    ? { kind: "missing" }
    : result && result.key === requestKey
      ? result.state
      : { kind: "loading" };

  const reload = () => setReloadKey((key) => key + 1);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/wizyty");
  }, [router]);

  const openMaps = useCallback((booking: BookingDetail) => {
    const query = encodeURIComponent(`${booking.businessName}, ${booking.address}`);
    const url = Platform.select({
      ios: `maps:0,0?q=${query}`,
      android: `geo:0,0?q=${query}`,
      default: `https://www.google.com/maps/search/?api=1&query=${query}`,
    });
    Linking.openURL(url).catch(() => {});
  }, []);

  const callPhone = useCallback((phone: string) => {
    Linking.openURL(`tel:${phone.replace(/[\s-]/g, "")}`).catch(() => {});
  }, []);

  // Bez useCallback: `state` jest wyprowadzany w renderze, więc lista
  // zależności i tak zmieniałaby się co render. React Compiler
  // (app.json → experiments.reactCompiler) memoizuje handler sam.
  const confirmCancel = async () => {
    if (state.kind !== "ready" || cancelling) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelBooking(state.booking.id, state.email);
      // Wpisu lokalnego NIE usuwamy: bez niego znika e-mail-przepustka do
      // GET /bookings/[id] (reload pokazywałby „nie zapisana na urządzeniu"),
      // a lista traci historię — badge „Odwołana" nadaje status z API.
      setDialogOpen(false);
      setJustCancelled(true);
      setResult({
        key: requestKey,
        state: {
          kind: "ready",
          email: state.email,
          checkedAtMs: state.checkedAtMs,
          booking: {
            ...state.booking,
            status: "CANCELLED_BY_CUSTOMER",
            cancelledAt: new Date().toISOString(),
          },
        },
      });
    } catch (error) {
      // 422 CUTOFF_PASSED / INVALID_STATE i 403 przychodzą z API z gotowym
      // polskim komunikatem — pokazujemy go wprost w dialogu.
      setCancelError(
        error instanceof ApiError
          ? error.message
          : "Nie udało się odwołać wizyty. Spróbuj ponownie.",
      );
    } finally {
      setCancelling(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg },
      ]}>
      <Pressable
        onPress={goBack}
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
        <Feather name="arrow-left" size={16} color={colors.foreground} />
      </Pressable>

      {state.kind === "loading" && (
        <View style={styles.centerBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {state.kind === "missing" && (
        <StateCard
          title="Nie znaleziono wizyty"
          text="Ta wizyta nie jest zapisana na tym urządzeniu."
          actionLabel="Wróć do listy"
          onAction={goBack}
        />
      )}

      {state.kind === "error" && (
        <StateCard
          title="Nie udało się pobrać wizyty"
          text={state.message}
          actionLabel="Spróbuj ponownie"
          onAction={reload}
        />
      )}

      {state.kind === "ready" && (
        <VisitDetails
          booking={state.booking}
          checkedAtMs={state.checkedAtMs}
          justCancelled={justCancelled}
          onNavigate={() => openMaps(state.booking)}
          onCall={
            state.booking.phone
              ? () => callPhone(state.booking.phone as string)
              : undefined
          }
          onCancelPress={() => {
            setCancelError(null);
            setDialogOpen(true);
          }}
        />
      )}

      {/* Dialog potwierdzenia odwołania — Modal działa też na webie. */}
      <Modal
        visible={dialogOpen}
        transparent
        animationType="fade"
        onRequestClose={() => !cancelling && setDialogOpen(false)}>
        <View style={styles.dialogOverlay}>
          <View style={styles.dialogCard}>
            <DisplayText size={21} weight={700}>
              Odwołać wizytę?
            </DisplayText>
            {state.kind === "ready" && (
              <BodyText
                size={13}
                color={colors.mutedForeground}
                style={styles.dialogText}>
                {state.booking.serviceName ?? "Wizyta"} ·{" "}
                {formatDayShort(state.booking.startAt, state.booking.timezone)},{" "}
                {formatTime(state.booking.startAt, state.booking.timezone)}.
                Termin wróci do puli i przepadnie.
              </BodyText>
            )}
            {cancelError && (
              <View style={styles.dialogError}>
                <BodyText size={12.5} color={colors.destructive}>
                  {cancelError}
                </BodyText>
              </View>
            )}
            <View style={styles.dialogButtons}>
              <Pressable
                disabled={cancelling}
                onPress={() => setDialogOpen(false)}
                style={({ pressed }) => [
                  styles.dialogKeep,
                  pressed && styles.pressed,
                ]}>
                <BodyText size={13} weight={600}>
                  Zachowaj
                </BodyText>
              </Pressable>
              <Pressable
                disabled={cancelling}
                onPress={confirmCancel}
                style={({ pressed }) => [
                  styles.dialogConfirm,
                  (pressed || cancelling) && styles.pressed,
                ]}>
                {cancelling ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.primaryForeground}
                  />
                ) : (
                  <BodyText
                    size={13}
                    weight={600}
                    color={colors.primaryForeground}>
                    Odwołaj wizytę
                  </BodyText>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function VisitDetails({
  booking,
  checkedAtMs,
  justCancelled,
  onNavigate,
  onCall,
  onCancelPress,
}: {
  booking: BookingDetail;
  /** Znacznik „teraz" z chwili pobrania wizyty — render zostaje czysty. */
  checkedAtMs: number;
  justCancelled: boolean;
  onNavigate: () => void;
  onCall?: () => void;
  onCancelPress: () => void;
}) {
  const tz = booking.timezone;
  const cancelled = isCancelledStatus(booking.status);
  const upcoming = new Date(booking.startAt).getTime() > checkedAtMs;
  const cancellable =
    (booking.status === "PENDING" || booking.status === "CONFIRMED") && upcoming;

  return (
    <View>
      <View style={styles.statusRow}>
        {cancelled ? (
          <View style={styles.cancelBadge}>
            <MetaLabel size={10} color={colors.destructive}>
              {BOOKING_STATUS_LABELS[booking.status]}
            </MetaLabel>
          </View>
        ) : (
          <View style={styles.statusBadge}>
            <View style={styles.statusDot} />
            <MetaLabel size={10} color={colors.success}>
              {BOOKING_STATUS_LABELS[booking.status]}
            </MetaLabel>
          </View>
        )}
      </View>

      {justCancelled && (
        <View style={styles.cancelledNote}>
          <BodyText size={13} weight={600} color={colors.primary}>
            Wizyta została odwołana. Termin wrócił do puli.
          </BodyText>
        </View>
      )}

      <View style={[styles.card, cancelled && styles.cardCancelled]}>
        <View style={styles.cardTop}>
          <MetaLabel size={10}>{formatDayFull(booking.startAt, tz)}</MetaLabel>
          <DisplayText size={38} weight={800} style={styles.time}>
            {formatTime(booking.startAt, tz)}
          </DisplayText>
          <BodyText size={14} weight={600}>
            {booking.serviceName ?? "Usługa"}
            {booking.durationMin ? ` · ${booking.durationMin} min` : ""}
          </BodyText>
          <BodyText
            size={13}
            color={colors.mutedForeground}
            style={styles.staffLine}>
            {booking.resourceName ? `${booking.resourceName} · ` : ""}
            {booking.businessName}
          </BodyText>
        </View>
        <View style={styles.cardBottom}>
          <View style={styles.addressBox}>
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

      <View style={styles.actionsRow}>
        <Pressable
          onPress={onNavigate}
          style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}>
          <Feather name="map-pin" size={14} color={colors.foreground} />
          <BodyText size={13} weight={600}>
            Nawiguj
          </BodyText>
        </Pressable>
        {onCall && (
          <Pressable
            onPress={onCall}
            style={({ pressed }) => [
              styles.actionButton,
              pressed && styles.pressed,
            ]}>
            <Feather name="phone" size={14} color={colors.foreground} />
            <BodyText size={13} weight={600}>
              Zadzwoń
            </BodyText>
          </Pressable>
        )}
      </View>

      {booking.phone && (
        <View style={styles.contactRow}>
          <BodyText size={12} color={colors.mutedForeground}>
            Telefon do lokalu:{" "}
          </BodyText>
          <MonoText size={12} color={colors.foreground}>
            {booking.phone}
          </MonoText>
        </View>
      )}

      {cancellable && (
        <>
          <Pressable
            onPress={onCancelPress}
            style={({ pressed }) => [
              styles.cancelButton,
              pressed && styles.pressed,
            ]}>
            <BodyText size={14} weight={700} color={colors.destructive}>
              Odwołaj wizytę
            </BodyText>
          </Pressable>
          <BodyText size={11.5} color={colors.mutedForegroundLight} style={styles.cutoffNote}>
            Bezpłatne odwołanie do{" "}
            {formatDayShort(booking.cancellationDeadline, tz)},{" "}
            {formatTime(booking.cancellationDeadline, tz)} (
            {booking.cancellationCutoffHours} h przed wizytą) — potem termin
            przepada.
          </BodyText>
        </>
      )}
    </View>
  );
}

/** Karta stanu (brak wpisu / błąd sieci) — nagłówek, opis, jedno CTA. */
function StateCard({
  title,
  text,
  actionLabel,
  onAction,
}: {
  title: string;
  text: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <View style={styles.stateCard}>
      <DisplayText size={21} weight={700} style={styles.stateTitle}>
        {title}
      </DisplayText>
      <BodyText size={13} color={colors.mutedForeground} style={styles.stateText}>
        {text}
      </BodyText>
      <Pressable
        onPress={onAction}
        style={({ pressed }) => [styles.stateCta, pressed && styles.pressed]}>
        <BodyText size={13} weight={600} color={colors.primaryForeground}>
          {actionLabel}
        </BodyText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    borderWidth: borderWidths.strong,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  centerBox: {
    paddingVertical: 80,
    alignItems: "center",
  },
  statusRow: {
    flexDirection: "row",
    marginBottom: spacing.md,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: colors.successSoft,
    borderWidth: borderWidths.hairline,
    borderColor: colors.successSoftBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md - 3,
    paddingVertical: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.success,
  },
  cancelBadge: {
    borderWidth: borderWidths.hairline,
    borderColor: colors.destructive,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md - 3,
    paddingVertical: 6,
  },
  cancelledNote: {
    backgroundColor: colors.accent,
    borderWidth: borderWidths.hairline,
    borderColor: colors.successSoftBorder,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: borderWidths.strong,
    borderColor: colors.borderStrong,
    borderRadius: radii.card,
    overflow: "hidden",
  },
  cardCancelled: {
    borderWidth: borderWidths.hairline,
    borderColor: colors.border,
  },
  cardTop: {
    padding: spacing.lg,
    borderBottomWidth: borderWidths.hairline,
    borderBottomColor: colors.borderDashed,
    borderStyle: "dashed",
  },
  time: {
    marginTop: 2,
    marginBottom: spacing.xs,
  },
  staffLine: {
    marginTop: 2,
  },
  cardBottom: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
  },
  addressBox: {
    flex: 1,
    minWidth: 0,
  },
  bookingId: {
    marginTop: 3,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 9,
    marginTop: spacing.lg,
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderWidth: borderWidths.strong,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
    borderRadius: radii.md + 1,
    paddingVertical: spacing.md,
    minHeight: 44,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md,
  },
  cancelButton: {
    marginTop: spacing.xl,
    borderWidth: borderWidths.hairline,
    borderColor: colors.destructiveMutedBorder,
    backgroundColor: colors.card,
    borderRadius: radii.md + 1,
    paddingVertical: spacing.md + 2,
    alignItems: "center",
    minHeight: 48,
  },
  cutoffNote: {
    marginTop: 9,
    textAlign: "center",
  },
  dialogOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  dialogCard: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: colors.card,
    borderWidth: borderWidths.strong,
    borderColor: colors.borderStrong,
    borderRadius: radii.card,
    padding: spacing.xl,
  },
  dialogText: {
    marginTop: spacing.sm,
  },
  dialogError: {
    marginTop: spacing.md,
    backgroundColor: colors.warningSoft,
    borderWidth: borderWidths.hairline,
    borderColor: colors.warningSoftBorder,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  dialogButtons: {
    flexDirection: "row",
    gap: 9,
    marginTop: spacing.xl,
  },
  dialogKeep: {
    flex: 1,
    borderWidth: borderWidths.strong,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  dialogConfirm: {
    flex: 1,
    backgroundColor: colors.destructive,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  stateCard: {
    backgroundColor: colors.card,
    borderWidth: borderWidths.hairline,
    borderColor: colors.border,
    borderRadius: radii.card,
    padding: spacing.xl,
    alignItems: "center",
    marginTop: spacing.xl,
  },
  stateTitle: {
    textAlign: "center",
  },
  stateText: {
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    maxWidth: 280,
  },
  stateCta: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: 10,
    paddingHorizontal: spacing.xl,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.85,
  },
});
