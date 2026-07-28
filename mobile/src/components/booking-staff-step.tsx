import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { BusinessResource, BusinessService } from "@/api/client";
import { useAvailability } from "@/components/booking-hooks";
import {
  formatDuration,
  priceLabel,
  slotCountLabel,
} from "@/components/booking-format";
import { BackCircle, SkeletonBlock, StepHeading } from "@/components/booking-ui";
import { formatTime } from "@/lib/format";
import { borderWidths, colors, radii, spacing } from "@/theme/tokens";
import { BodyText, DisplayText, MonoText } from "@/theme/typography";

/**
 * Krok 1/3 — wybór pracownika (prototyp s3): karta „Dowolny dostępny"
 * na primary z licznikiem dzisiejszych terminów i chipami godzin, niżej
 * lista pracowników z dostępnością „dziś od…". Liczby zasila availability
 * dzisiejszego dnia (widok scalony + per zasób).
 */

export function BookingStaffStep({
  slug,
  service,
  resources,
  timezone,
  todayIso,
  onBack,
  onPick,
}: {
  slug: string;
  service: BusinessService;
  resources: BusinessResource[];
  timezone: string;
  todayIso: string;
  onBack: () => void;
  onPick: (resourceId: string) => void;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const today = useAvailability(slug, service.id, todayIso, null, reloadKey);
  // Błąd pobrania ≠ „zero terminów" — zamiast zer pokazujemy stan błędu
  // z ponowieniem, jak przy każdym innym fetchu we flow.
  const todayFailed = today.error !== null;
  const merged = today.data?.slots ?? [];
  const perResource = new Map(
    (today.data?.perResource ?? []).map((entry) => [
      entry.resourceId,
      entry.slots,
    ]),
  );

  return (
    <View>
      <BackCircle onPress={onBack} />
      <StepHeading
        meta="Krok 1 / 3 · Pracownik"
        title="Kto ma to zrobić?"
        subtitle={`${service.name} · ${formatDuration(service.durationMin)} · ${priceLabel(service.priceCents, service.priceType, service.currency)}`}
      />

      <Pressable
        onPress={() => onPick("any")}
        style={({ pressed }) => [styles.anyCard, pressed && styles.pressed]}>
        <View style={styles.anyTop}>
          <View style={styles.anyInfo}>
            <DisplayText
              size={18}
              weight={700}
              color={colors.primaryForeground}>
              Dowolny dostępny
            </DisplayText>
            <BodyText
              size={12}
              color={colors.primaryForegroundMuted}
              style={styles.anySubtitle}>
              Scalona dostępność całego zespołu
            </BodyText>
          </View>
          <View style={styles.anyCount}>
            <MonoText size={20} weight={500} color={colors.primaryForeground}>
              {today.loading || todayFailed ? "…" : merged.length}
            </MonoText>
            <BodyText size={10} color={colors.primaryForegroundMuted}>
              terminów dziś
            </BodyText>
          </View>
        </View>
        {merged.length > 0 ? (
          <View style={styles.anyChips}>
            {merged.slice(0, 3).map((slot) => (
              <View key={slot.startAt} style={styles.anyChip}>
                <MonoText size={11} color={colors.primaryForeground}>
                  {formatTime(slot.startAt, timezone)}
                </MonoText>
              </View>
            ))}
            {merged.length > 3 ? (
              <View style={styles.anyChip}>
                <MonoText size={11} color={colors.primaryForeground}>
                  +{merged.length - 3}
                </MonoText>
              </View>
            ) : null}
          </View>
        ) : null}
      </Pressable>

      {todayFailed ? (
        <View style={styles.errorRow}>
          <BodyText size={12} color={colors.mutedForeground} style={styles.errorText}>
            Nie udało się pobrać dzisiejszej dostępności.
          </BodyText>
          <Pressable
            onPress={() => setReloadKey((key) => key + 1)}
            style={({ pressed }) => pressed && styles.pressed}>
            <BodyText size={12} weight={700} color={colors.foreground}>
              Spróbuj ponownie
            </BodyText>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.staffList}>
        {resources.map((resource) => {
          const slots = perResource.get(resource.id) ?? [];
          return (
            <Pressable
              key={resource.id}
              onPress={() => onPick(resource.id)}
              style={({ pressed }) => [
                styles.staffCard,
                pressed && styles.pressed,
              ]}>
              <View style={styles.avatar}>
                <DisplayText
                  size={18}
                  weight={700}
                  color={colors.mutedForeground}>
                  {resource.name.slice(0, 1).toUpperCase()}
                </DisplayText>
              </View>
              <View style={styles.staffInfo}>
                <BodyText size={15} weight={700}>
                  {resource.name}
                </BodyText>
                <BodyText
                  size={12}
                  color={colors.mutedForeground}
                  style={styles.staffTitle}>
                  {resource.staffProfile?.title ?? "Specjalista"}
                </BodyText>
                {today.loading ? (
                  <SkeletonBlock height={14} style={styles.staffSkeleton} />
                ) : todayFailed ? (
                  <BodyText
                    size={11}
                    color={colors.mutedForegroundLight}
                    style={styles.staffAvailability}>
                    Dostępność chwilowo nieznana
                  </BodyText>
                ) : slots.length > 0 ? (
                  <MonoText
                    size={11}
                    weight={500}
                    color={colors.success}
                    style={styles.staffAvailability}>
                    Dziś od {formatTime(slots[0].startAt, timezone)} ·{" "}
                    {slotCountLabel(slots.length)}
                  </MonoText>
                ) : (
                  <MonoText
                    size={11}
                    weight={500}
                    color={colors.warning}
                    style={styles.staffAvailability}>
                    Brak terminów dziś
                  </MonoText>
                )}
              </View>
              <BodyText size={16} color={colors.mutedForegroundLight}>
                ›
              </BodyText>
            </Pressable>
          );
        })}
      </View>

      <BodyText
        size={12}
        color={colors.mutedForeground}
        style={styles.footnote}>
        {/* &quot; = ta sama prosta cudzysłów-domykająca co w reszcie UI (JSX
            dekoduje encję do znaku ") — reguła no-unescaped-entities zabrania
            surowego " w treści. */}
        Wybór „dowolny&quot; daje najwięcej terminów — pracownika przypisujemy
        przy potwierdzeniu i pokazujemy go w e-mailu.
      </BodyText>
    </View>
  );
}

const styles = StyleSheet.create({
  anyCard: {
    backgroundColor: colors.primary,
    borderRadius: radii.card,
    padding: spacing.lg,
    marginBottom: spacing.md + 1,
  },
  anyTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  anyInfo: {
    flex: 1,
    minWidth: 0,
  },
  anySubtitle: {
    marginTop: 3,
  },
  anyCount: {
    alignItems: "flex-end",
  },
  anyChips: {
    flexDirection: "row",
    gap: 5,
    marginTop: spacing.lg - 2,
  },
  anyChip: {
    backgroundColor: colors.primaryTint,
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 9,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    backgroundColor: colors.highlight,
    borderWidth: borderWidths.hairline,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: {
    flex: 1,
    minWidth: 0,
  },
  staffList: {
    gap: 10,
  },
  staffCard: {
    backgroundColor: colors.card,
    borderWidth: borderWidths.hairline,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radii.pill,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  staffInfo: {
    flex: 1,
    minWidth: 0,
  },
  staffTitle: {
    marginTop: 2,
  },
  staffAvailability: {
    marginTop: 5,
  },
  staffSkeleton: {
    marginTop: 5,
    width: 130,
  },
  footnote: {
    marginTop: spacing.lg + 2,
  },
  pressed: {
    opacity: 0.85,
  },
});
