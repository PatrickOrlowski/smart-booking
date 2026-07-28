import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getBooking, type BookingStatus } from "@/api/client";
import {
  BOOKING_STATUS_LABELS,
  formatDateNumeric,
  formatDayShort,
  formatPrice,
  formatTime,
  isCancelledStatus,
  relativeDayLabel,
} from "@/lib/format";
import { listVisits, type StoredVisit } from "@/storage/visits";
import { borderWidths, colors, radii, spacing } from "@/theme/tokens";
import { BodyText, DisplayText, MetaLabel, MonoText } from "@/theme/typography";

/**
 * Lista „Moje wizyty" (prototyp s7): zakładki Nadchodzące/Minione po
 * `startAt`, karty wizyt z lokalnej listy (AsyncStorage). Pociągnięcie
 * w dół odświeża statusy przez GET /api/v1/bookings/[id]?email= —
 * anulowana wizyta dostaje badge; minionych nie odpytujemy.
 */

const TABS = [
  { key: "upcoming", label: "Nadchodzące" },
  { key: "past", label: "Minione" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function VisitsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [visits, setVisits] = useState<StoredVisit[] | null>(null);
  // „Teraz" z chwili odczytu listy z dysku — podział na nadchodzące/minione
  // musi być czysty w renderze, a każde wejście na zakładkę czyta dysk na nowo.
  const [listedAtMs, setListedAtMs] = useState(0);
  const [statuses, setStatuses] = useState<Record<string, BookingStatus>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabKey>("upcoming");

  const refreshStatuses = useCallback(async (all: StoredVisit[]) => {
    const now = Date.now();
    const upcoming = all.filter((v) => new Date(v.startAt).getTime() >= now);
    if (upcoming.length === 0) return;
    const results = await Promise.allSettled(
      upcoming.map((v) => getBooking(v.bookingId, v.email)),
    );
    const next: Record<string, BookingStatus> = {};
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        next[upcoming[index].bookingId] = result.value.booking.status;
      }
    });
    // Pojedynczy błąd (offline, 404) nie kasuje wcześniej znanych statusów.
    setStatuses((prev) => ({ ...prev, ...next }));
  }, []);

  // Powrót na zakładkę = świeża lista z dysku + ciche odświeżenie statusów.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const stored = await listVisits();
        if (!alive) return;
        setVisits(stored);
        setListedAtMs(Date.now());
        refreshStatuses(stored);
      })();
      return () => {
        alive = false;
      };
    }, [refreshStatuses]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const stored = await listVisits();
      setVisits(stored);
      setListedAtMs(Date.now());
      await refreshStatuses(stored);
    } finally {
      setRefreshing(false);
    }
  }, [refreshStatuses]);

  const { upcoming, past } = useMemo(() => {
    const all = visits ?? [];
    return {
      upcoming: all
        .filter((v) => new Date(v.startAt).getTime() >= listedAtMs)
        .sort((a, b) => a.startAt.localeCompare(b.startAt)),
      past: all
        .filter((v) => new Date(v.startAt).getTime() < listedAtMs)
        .sort((a, b) => b.startAt.localeCompare(a.startAt)),
    };
  }, [visits, listedAtMs]);

  const active = tab === "upcoming" ? upcoming : past;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }>
      <DisplayText size={29} weight={800} style={styles.title}>
        Moje wizyty
      </DisplayText>

      {visits !== null && visits.length === 0 ? (
        <EmptyAll onSearch={() => router.push("/")} />
      ) : (
        <>
          <View style={styles.tabsRow}>
            {TABS.map((item) => {
              const isActive = item.key === tab;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => setTab(item.key)}
                  style={[styles.tabItem, isActive && styles.tabItemActive]}>
                  <BodyText
                    size={13}
                    weight={isActive ? 700 : 500}
                    color={
                      isActive ? colors.foreground : colors.mutedForegroundLight
                    }>
                    {item.label}
                  </BodyText>
                </Pressable>
              );
            })}
          </View>

          {active.length === 0 ? (
            <View style={styles.emptyTab}>
              <BodyText size={13} weight={700}>
                {tab === "upcoming"
                  ? "Brak nadchodzących wizyt"
                  : "Brak minionych wizyt"}
              </BodyText>
              <BodyText
                size={12}
                color={colors.mutedForeground}
                style={styles.emptyTabText}>
                {tab === "upcoming"
                  ? "Zarezerwuj termin w zakładce Szukaj — wizyta pojawi się tutaj."
                  : "Odbyte wizyty zostają na liście — wrócisz tu po historię."}
              </BodyText>
            </View>
          ) : tab === "upcoming" ? (
            <View style={styles.cards}>
              {active.map((visit) => (
                <UpcomingCard
                  key={visit.bookingId}
                  visit={visit}
                  status={statuses[visit.bookingId]}
                  onPress={() => router.push(`/wizyty/${visit.bookingId}`)}
                />
              ))}
            </View>
          ) : (
            <View style={styles.cards}>
              {active.map((visit) => (
                <PastCard
                  key={visit.bookingId}
                  visit={visit}
                  onPress={() => router.push(`/wizyty/${visit.bookingId}`)}
                />
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

/** Karta nadchodzącej wizyty — obrys 1.5px, status w mono, godzina po prawej. */
function UpcomingCard({
  visit,
  status,
  onPress,
}: {
  visit: StoredVisit;
  status?: BookingStatus;
  onPress: () => void;
}) {
  const cancelled = status !== undefined && isCancelledStatus(status);
  // Formatowanie w strefie lokalu z zapisu wizyty (undefined = stary wpis
  // sprzed pola `timezone` — formatery użyją wtedy DEFAULT_TIMEZONE).
  const relative = relativeDayLabel(visit.startAt, visit.timezone);
  const statusLabel = status ? BOOKING_STATUS_LABELS[status] : "Potwierdzona";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.upcomingCard,
        cancelled && styles.upcomingCardCancelled,
        pressed && styles.pressed,
      ]}>
      <View style={styles.upcomingTop}>
        <View style={styles.upcomingInfo}>
          {cancelled ? (
            <View style={styles.cancelBadge}>
              <MetaLabel size={9} color={colors.destructive}>
                {statusLabel}
              </MetaLabel>
            </View>
          ) : (
            <MetaLabel size={10} color={colors.success}>
              {statusLabel}
              {relative ? ` · ${relative}` : ""}
            </MetaLabel>
          )}
          <DisplayText size={18} weight={700} style={styles.upcomingService}>
            {visit.serviceName}
          </DisplayText>
          <BodyText size={12.5} color={colors.mutedForeground}>
            {visit.businessName}
          </BodyText>
        </View>
        <View style={styles.upcomingWhen}>
          <MonoText size={18} weight={500}>
            {formatTime(visit.startAt, visit.timezone)}
          </MonoText>
          <BodyText size={11} color={colors.mutedForeground}>
            {formatDayShort(visit.startAt, visit.timezone)}
          </BodyText>
          <MonoText
            size={12}
            color={colors.mutedForeground}
            style={styles.upcomingPrice}>
            {formatPrice(visit.priceCents)}
          </MonoText>
        </View>
      </View>
    </Pressable>
  );
}

/** Karta minionej wizyty — mniejsza, z miniaturą i datą w mono. */
function PastCard({
  visit,
  onPress,
}: {
  visit: StoredVisit;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.pastCard, pressed && styles.pressed]}>
      <View style={styles.pastThumb}>
        <DisplayText size={17} weight={700} color={colors.mutedForeground}>
          {visit.businessName.slice(0, 1).toUpperCase()}
        </DisplayText>
      </View>
      <View style={styles.pastInfo}>
        <MonoText size={11} color={colors.mutedForegroundLight}>
          {formatDateNumeric(visit.startAt, visit.timezone)} ·{" "}
          {formatTime(visit.startAt, visit.timezone)}
        </MonoText>
        <BodyText size={14} weight={600} style={styles.pastTitle} numberOfLines={1}>
          {visit.serviceName}
        </BodyText>
        <BodyText size={12} color={colors.mutedForeground} numberOfLines={1}>
          {visit.businessName}
        </BodyText>
      </View>
      <MonoText size={12} color={colors.mutedForeground}>
        {formatPrice(visit.priceCents)}
      </MonoText>
    </Pressable>
  );
}

/** Pusty stan całej zakładki — nagłówek display, opis muted, jedno CTA. */
function EmptyAll({ onSearch }: { onSearch: () => void }) {
  return (
    <View style={styles.emptyState}>
      <DisplayText size={24} weight={700} style={styles.emptyTitle}>
        Nie masz jeszcze wizyt
      </DisplayText>
      <BodyText size={13} color={colors.mutedForeground} style={styles.emptyText}>
        Zarezerwuj pierwszy termin — wizyta pojawi się tutaj z godziną,
        adresem i możliwością odwołania.
      </BodyText>
      <Pressable
        onPress={onSearch}
        style={({ pressed }) => [styles.cta, pressed && styles.pressed]}>
        <BodyText size={13} weight={600} color={colors.primaryForeground}>
          Znajdź wolny termin
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
  title: {
    marginBottom: spacing.lg,
  },
  tabsRow: {
    flexDirection: "row",
    gap: 18,
    borderBottomWidth: borderWidths.hairline,
    borderBottomColor: colors.separator,
    marginBottom: spacing.xl,
  },
  tabItem: {
    paddingBottom: 9,
  },
  tabItemActive: {
    borderBottomWidth: 2.5,
    borderBottomColor: colors.foreground,
    marginBottom: -borderWidths.hairline,
  },
  cards: {
    gap: spacing.md + 1,
  },
  upcomingCard: {
    backgroundColor: colors.card,
    borderWidth: borderWidths.strong,
    borderColor: colors.borderStrong,
    borderRadius: radii.card,
    padding: spacing.lg,
  },
  upcomingCardCancelled: {
    borderWidth: borderWidths.hairline,
    borderColor: colors.border,
  },
  upcomingTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  upcomingInfo: {
    flex: 1,
    minWidth: 0,
    alignItems: "flex-start",
  },
  upcomingService: {
    marginTop: 5,
    marginBottom: 3,
  },
  upcomingWhen: {
    alignItems: "flex-end",
  },
  upcomingPrice: {
    marginTop: 7,
  },
  cancelBadge: {
    borderWidth: borderWidths.hairline,
    borderColor: colors.destructive,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  pastCard: {
    backgroundColor: colors.card,
    borderWidth: borderWidths.hairline,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md + 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md - 1,
  },
  pastThumb: {
    width: 46,
    height: 46,
    borderRadius: radii.md,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  pastInfo: {
    flex: 1,
    minWidth: 0,
  },
  pastTitle: {
    marginTop: 2,
  },
  emptyTab: {
    backgroundColor: colors.highlight,
    borderWidth: borderWidths.hairline,
    borderColor: colors.borderDashed,
    borderStyle: "dashed",
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  emptyTabText: {
    marginTop: spacing.xs,
  },
  emptyState: {
    backgroundColor: colors.card,
    borderWidth: borderWidths.hairline,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    marginTop: spacing.xl,
  },
  emptyTitle: {
    textAlign: "center",
  },
  emptyText: {
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    maxWidth: 280,
  },
  cta: {
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
