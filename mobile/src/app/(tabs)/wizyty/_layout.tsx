import { Stack } from "expo-router";

import { colors } from "@/theme/tokens";

/** Stos zakładki „Moje wizyty": lista + szczegóły wizyty. */
export default function VisitsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
