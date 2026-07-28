import { Pressable, StyleSheet, View } from "react-native";

import { borderWidths, colors, spacing } from "@/theme/tokens";
import { BodyText } from "@/theme/typography";

/**
 * Zakładki profilu firmy w stylu prototypu s2: tekst 13px, aktywna
 * pogrubiona z podkreśleniem 2.5px atramentu, nieaktywne wyszarzone.
 */
export function BusinessTabs<Key extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly { key: Key; label: string }[];
  active: Key;
  onChange: (key: Key) => void;
}) {
  return (
    <View style={styles.row}>
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            hitSlop={8}
            style={[styles.tab, isActive && styles.tabActive]}>
            <BodyText
              size={13}
              weight={isActive ? 700 : 500}
              color={isActive ? colors.foreground : colors.mutedForegroundLight}>
              {tab.label}
            </BodyText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.xl,
    borderBottomWidth: borderWidths.hairline,
    borderBottomColor: colors.separator,
  },
  tab: {
    paddingBottom: 9,
    marginBottom: -borderWidths.hairline,
  },
  tabActive: {
    borderBottomWidth: 2.5,
    borderBottomColor: colors.foreground,
  },
});
