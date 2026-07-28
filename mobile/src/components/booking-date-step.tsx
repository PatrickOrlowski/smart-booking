import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { getAvailability, type BusinessService } from "@/api/client";
import {
  flowDayHeading,
  flowDayShort,
  formatDuration,
  groupSlotsByDaypart,
  type FlowDay,
} from "@/components/booking-format";
import { useAvailability } from "@/components/booking-hooks";
import { BackCircle, SkeletonBlock, StepHeading } from "@/components/booking-ui";
import { formatTime } from "@/lib/format";
import { borderWidths, colors, radii, spacing } from "@/theme/tokens";
import { BodyText, DisplayText, MetaLabel, MonoText } from "@/theme/typography";

/**
 * Krok 2/3 — termin (prototyp s4): poziomy pasek 14 dni + siatka slotów
 * w 3 kolumnach pogrupowana na Rano / Po południu / Wieczorem. Pusty dzień
 * sonduje kolejne dni (do 7) i podpowiada najbliższy z wolnymi godzinami —
 * API nie zwraca takiej podpowiedzi wprost, więc liczymy ją po stronie
 * klienta jak w webowym flow.
 */

export function BookingDateStep({
  slug,
  service,
  resourceId,
  staffLabel,
  days,
  selectedDate,
  refreshKey,
  onBack,
  onPickDay,
  onPickSlot,
}: {
  slug: string;
  service: BusinessService;
  resourceId: string;
  staffLabel: string;
  days: FlowDay[];
  selectedDate: string;
  /** Bump po powrocie z kroku „dane" — lista musi być świeża. */
  refreshKey: number;
  onBack: () => void;
  onPickDay: (iso: string) => void;
  onPickSlot: (startAtIso: string) => void;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const availability = useAvailability(
    slug,
    service.id,
    selectedDate,
    resourceId,
    reloadKey + refreshKey,
  );

  const timezone = availability.data?.timezone ?? "Europe/Warsaw";

  // Pusty dzień → sondowanie kolejnych dni. Wynik przypięty do klucza dnia,
  // żeby zmiana dnia unieważniała go bez setState w sprzątaniu efektu.
  const emptyDayKey =
    !availability.loading &&
    availability.data &&
    availability.data.slots.length === 0
      ? `${selectedDate}|${resourceId}`
      : null;
  const [probeResult, setProbeResult] = useState<{
    key: string;
    iso: string;
    firstSlots: string[];
  } | null>(null);

  useEffect(() => {
    if (!emptyDayKey) return;
    let cancelled = false;
    const probe = async () => {
      const startIndex = days.findIndex((day) => day.iso === selectedDate);
      for (const day of days.slice(startIndex + 1, startIndex + 8)) {
        try {
          const json = await getAvailability(slug, {
            serviceId: service.id,
            date: day.iso,
            resourceId: resourceId !== "any" ? resourceId : undefined,
          });
          if (cancelled) return;
          if (json.slots.length > 0) {
            setProbeResult({
              key: emptyDayKey,
              iso: day.iso,
              firstSlots: json.slots
                .slice(0, 3)
                .map((slot) => formatTime(slot.startAt, json.timezone)),
            });
            return;
          }
        } catch {
          return;
        }
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, [emptyDayKey, days, selectedDate, resourceId, slug, service.id]);

  const nearest =
    probeResult && probeResult.key === emptyDayKey ? probeResult : null;

  const groups = availability.data
    ? groupSlotsByDaypart(availability.data.slots, timezone)
    : [];

  return (
    <View>
      <View style={styles.padded}>
        <BackCircle onPress={onBack} />
        <StepHeading
          meta="Krok 2 / 3 · Termin"
          title="Kiedy pasuje?"
          subtitle={`${service.name} · ${staffLabel} · ${formatDuration(service.durationMin)}`}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.daysScroll}
        contentContainerStyle={styles.daysRow}>
        {days.map((day) => {
          const selected = day.iso === selectedDate;
          return (
            <Pressable
              key={day.iso}
              onPress={() => onPickDay(day.iso)}
              style={[styles.dayCell, selected && styles.dayCellSelected]}>
              <BodyText
                size={11}
                color={
                  selected
                    ? colors.primaryForegroundMuted
                    : colors.mutedForegroundLight
                }>
                {day.weekdayLabel}
              </BodyText>
              <MonoText
                size={17}
                weight={500}
                color={selected ? colors.primaryForeground : colors.foreground}
                style={styles.dayNumber}>
                {day.dayNumber}
              </MonoText>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.padded}>
        <View style={styles.dayHeader}>
          <MetaLabel>{flowDayHeading(selectedDate)}</MetaLabel>
          {availability.data ? (
            <MonoText size={10} color={colors.mutedForegroundLight}>
              siatka {availability.data.slotGranularityMin} min
            </MonoText>
          ) : null}
        </View>

        {availability.loading ? (
          <View style={styles.grid}>
            {Array.from({ length: 9 }, (_, index) => (
              <SkeletonBlock
                key={index}
                height={44}
                radius={10}
                style={styles.slotSkeleton}
              />
            ))}
          </View>
        ) : availability.error ? (
          <View style={styles.errorCard}>
            <BodyText
              size={13}
              color={colors.mutedForeground}
              style={styles.errorText}>
              {availability.error}
            </BodyText>
            <Pressable
              onPress={() => setReloadKey((key) => key + 1)}
              style={({ pressed }) => [
                styles.retryButton,
                pressed && styles.pressed,
              ]}>
              <BodyText size={13} weight={600}>
                Spróbuj ponownie
              </BodyText>
            </Pressable>
          </View>
        ) : groups.length === 0 ? (
          <View style={styles.emptyWrap}>
            <DisplayText size={20} weight={800} style={styles.emptyTitle}>
              Brak wolnych godzin
            </DisplayText>
            {nearest ? (
              <Pressable
                onPress={() => onPickDay(nearest.iso)}
                style={({ pressed }) => [
                  styles.nearestCard,
                  pressed && styles.pressed,
                ]}>
                <View style={styles.nearestInfo}>
                  <BodyText size={12.5} weight={700}>
                    Najbliżej: {flowDayShort(nearest.iso)}
                  </BodyText>
                  <BodyText size={11} color={colors.mutedForeground}>
                    {nearest.firstSlots.join(", ")}
                  </BodyText>
                </View>
                <BodyText size={14}>›</BodyText>
              </Pressable>
            ) : (
              <BodyText size={13} color={colors.mutedForeground}>
                Sprawdź inny dzień na pasku powyżej — w najbliższym tygodniu
                nie widzimy wolnych godzin.
              </BodyText>
            )}
          </View>
        ) : (
          groups.map((group) => (
            <View key={group.label}>
              <BodyText size={12} weight={700} style={styles.groupLabel}>
                {group.label}
              </BodyText>
              <View style={styles.grid}>
                {group.slots.map((slot) => (
                  <Pressable
                    key={slot.startAt}
                    onPress={() => onPickSlot(slot.startAt)}
                    style={({ pressed }) => [
                      styles.slot,
                      pressed && styles.pressed,
                    ]}>
                    <MonoText size={13} weight={500}>
                      {formatTime(slot.startAt, timezone)}
                    </MonoText>
                  </Pressable>
                ))}
              </View>
            </View>
          ))
        )}

        <BodyText
          size={11}
          color={colors.mutedForegroundLight}
          style={styles.footnote}>
          Godziny w strefie lokalu ({timezone}). Pokazujemy wyłącznie wolne
          terminy.
        </BodyText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  padded: {
    paddingHorizontal: spacing.xl,
  },
  daysScroll: {
    marginTop: -spacing.xs,
  },
  daysRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingBottom: 6,
  },
  dayCell: {
    width: 56,
    paddingVertical: 10,
    borderRadius: radii.input,
    alignItems: "center",
    backgroundColor: colors.card,
    borderWidth: borderWidths.hairline,
    borderColor: colors.border,
  },
  dayCellSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dayNumber: {
    marginTop: 2,
  },
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg - 2,
    marginBottom: 10,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  slot: {
    flexBasis: "31%",
    flexGrow: 1,
    maxWidth: "32.5%",
    minHeight: 44,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: borderWidths.strong,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  slotSkeleton: {
    flexBasis: "31%",
    flexGrow: 1,
    maxWidth: "32.5%",
  },
  groupLabel: {
    marginTop: spacing.lg - 2,
    marginBottom: spacing.sm,
  },
  errorCard: {
    backgroundColor: colors.card,
    borderWidth: borderWidths.hairline,
    borderColor: colors.border,
    borderRadius: radii.card,
    padding: spacing.lg,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  errorText: {
    textAlign: "center",
    marginBottom: spacing.md,
  },
  retryButton: {
    borderWidth: borderWidths.strong,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
    borderRadius: radii.pill,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyWrap: {
    marginTop: spacing.sm,
  },
  emptyTitle: {
    marginBottom: spacing.md,
  },
  nearestCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    backgroundColor: colors.highlight,
    borderWidth: borderWidths.strong,
    borderColor: colors.borderStrong,
    borderRadius: radii.md + 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
  },
  nearestInfo: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  footnote: {
    marginTop: spacing.lg + 2,
  },
  pressed: {
    opacity: 0.85,
  },
});
