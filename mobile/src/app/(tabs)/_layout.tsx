import { Feather } from "@expo/vector-icons";
import {
  TabList,
  TabSlot,
  TabTrigger,
  Tabs,
  type TabTriggerSlotProps,
} from "expo-router/ui";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BodyText } from "@/theme/typography";
import { borderWidths, colors, spacing } from "@/theme/tokens";

/** Zakładki klienta: Szukaj + Moje wizyty (headless Tabs, pasek marki). */
export default function TabsLayout() {
  return (
    <Tabs style={styles.root}>
      <TabSlot style={styles.slot} />
      <TabList asChild>
        <BrandTabBar>
          <TabTrigger name="index" href="/" asChild>
            <TabButton icon="search" label="Szukaj" />
          </TabTrigger>
          <TabTrigger name="wizyty" href="/wizyty" asChild>
            <TabButton icon="calendar" label="Moje wizyty" />
          </TabTrigger>
        </BrandTabBar>
      </TabList>
    </Tabs>
  );
}

/** Dolny pasek w stylu marki: karta + kreska border, zero cieni. */
function BrandTabBar({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.tabBar, { paddingBottom: insets.bottom }]}>
      {children}
    </View>
  );
}

function TabButton({
  icon,
  label,
  isFocused,
  ...props
}: TabTriggerSlotProps & {
  icon: keyof typeof Feather.glyphMap;
  label: string;
}) {
  const tint = isFocused ? colors.foreground : colors.mutedForegroundLight;
  return (
    <Pressable
      {...props}
      style={({ pressed }) => [styles.tabButton, pressed && styles.pressed]}>
      <View style={[styles.iconPill, isFocused && styles.iconPillActive]}>
        <Feather name={icon} size={18} color={tint} />
      </View>
      <BodyText size={11} weight={isFocused ? 700 : 500} color={tint}>
        {label}
      </BodyText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  slot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: colors.card,
    borderTopWidth: borderWidths.hairline,
    borderTopColor: colors.border,
  },
  tabButton: {
    flex: 1,
    minHeight: 60,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
  iconPill: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 3,
    borderRadius: 999,
  },
  iconPillActive: {
    backgroundColor: colors.accent,
  },
});
