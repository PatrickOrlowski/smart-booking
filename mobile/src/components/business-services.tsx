import { Fragment } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { BusinessDetail, BusinessService } from "@/api/client";
import { formatDuration, priceLabel } from "@/components/booking-format";
import { borderWidths, colors, radii, spacing } from "@/theme/tokens";
import { BodyText, MetaLabel, MonoText } from "@/theme/typography";

/**
 * Cennik profilu firmy (prototyp s2): usługi pogrupowane kategoriami,
 * wiersz = nazwa + DM Mono „45 min · 90 zł" + pigułka „Wybierz".
 * Usługi bez rezerwacji online dostają wyszarzoną pigułkę „Zapytaj".
 */

type ServiceGroup = { key: string; label: string | null; services: BusinessService[] };

function groupServices(business: BusinessDetail): ServiceGroup[] {
  const groups: ServiceGroup[] = business.categories.map((category) => ({
    key: category.id,
    label: category.name,
    services: business.services.filter(
      (service) => service.categoryId === category.id,
    ),
  }));
  const categoryIds = new Set(business.categories.map((c) => c.id));
  const rest = business.services.filter(
    (service) =>
      service.categoryId === null || !categoryIds.has(service.categoryId),
  );
  if (rest.length > 0) {
    groups.push({
      key: "__rest",
      label: groups.length > 0 ? "Pozostałe" : null,
      services: rest,
    });
  }
  return groups.filter((group) => group.services.length > 0);
}

export function BusinessServices({
  business,
  onPick,
}: {
  business: BusinessDetail;
  /** „Wybierz" — nawigacja do flow rezerwacji (slug + serviceId). */
  onPick: (service: BusinessService) => void;
}) {
  const groups = groupServices(business);

  if (groups.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <BodyText size={13} weight={700}>
          Brak cennika
        </BodyText>
        <BodyText
          size={12}
          color={colors.mutedForeground}
          style={styles.emptyText}>
          Ta firma nie opublikowała jeszcze usług do rezerwacji online.
        </BodyText>
      </View>
    );
  }

  return (
    <View>
      {groups.map((group, groupIndex) => (
        <Fragment key={group.key}>
          {group.label ? (
            <MetaLabel
              style={[
                styles.groupLabel,
                groupIndex === 0 && styles.groupLabelFirst,
              ]}>
              {group.label}
            </MetaLabel>
          ) : (
            <View style={styles.groupSpacer} />
          )}
          {group.services.map((service) => (
            <ServiceRow
              key={service.id}
              service={service}
              onPick={() => onPick(service)}
            />
          ))}
        </Fragment>
      ))}
      <View style={styles.bottomRule} />
    </View>
  );
}

function ServiceRow({
  service,
  onPick,
}: {
  service: BusinessService;
  onPick: () => void;
}) {
  const bookable = service.onlineBookable;
  return (
    <View style={styles.row}>
      <View style={styles.rowBody}>
        <BodyText size={15} weight={600}>
          {service.name}
        </BodyText>
        <MonoText
          size={12}
          color={colors.mutedForeground}
          style={styles.rowMeta}>
          {formatDuration(service.durationMin)} ·{" "}
          {priceLabel(service.priceCents, service.priceType, service.currency)}
        </MonoText>
      </View>
      <Pressable
        onPress={bookable ? onPick : undefined}
        disabled={!bookable}
        accessibilityRole="button"
        accessibilityLabel={
          bookable ? `Wybierz: ${service.name}` : `Zapytaj o: ${service.name}`
        }
        hitSlop={6}
        style={({ pressed }) => [
          styles.pill,
          !bookable && styles.pillMuted,
          pressed && bookable && styles.pressed,
        ]}>
        <BodyText
          size={13}
          weight={600}
          color={bookable ? colors.foreground : colors.mutedForegroundLight}>
          {bookable ? "Wybierz" : "Zapytaj"}
        </BodyText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  groupLabel: {
    marginTop: spacing.xl + 4,
    marginBottom: spacing.sm,
  },
  groupLabelFirst: {
    marginTop: spacing.xl,
  },
  groupSpacer: {
    height: spacing.xl,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: borderWidths.hairline,
    borderTopColor: colors.separator,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowMeta: {
    marginTop: 3,
  },
  pill: {
    flexShrink: 0,
    borderWidth: borderWidths.strong,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
    borderRadius: radii.pill,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  pillMuted: {
    borderWidth: borderWidths.strong,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.8,
  },
  bottomRule: {
    height: borderWidths.hairline,
    backgroundColor: colors.separator,
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
  emptyText: {
    marginTop: spacing.xs,
  },
});
