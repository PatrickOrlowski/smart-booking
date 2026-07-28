import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ApiError,
  getBusinesses,
  type BusinessListItem,
} from "@/api/client";
import { BusinessCard } from "@/components/business-card";
import { resultsCountLabel } from "@/components/business-format";
import { SkeletonBlock } from "@/components/booking-ui";
import { borderWidths, colors, fonts, radii, spacing } from "@/theme/tokens";
import {
  BodyText,
  DisplayText,
  MetaLabel,
  MonoText,
} from "@/theme/typography";

/**
 * Tab „Szukaj" (prototyp s1): nagłówek lokalizacji, tytuł „Zarezerwuj na
 * dziś.", pole szukania z debounce 300 ms → GET /api/v1/businesses?q=,
 * karty firm (pierwsza wyróżniona obrysem 1.5px), pull-to-refresh i pusty
 * stan z CTA czyszczącym wyszukiwanie. Chipy filtrów są dekoracją z
 * prototypu — filtry poza zakresem MVP.
 */

const FILTER_CHIPS = ["Wolne dziś", "Ocena 4,5+", "do 100 zł", "< 2 km"];

type ResultsState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; businesses: BusinessListItem[] };

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [state, setState] = useState<ResultsState>({ kind: "loading" });
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const requestId = useRef(0);
  const hasLoaded = useRef(false);

  const load = useCallback(
    async (q: string, mode: "initial" | "search" | "refresh") => {
      const id = ++requestId.current;
      if (mode === "initial") setState({ kind: "loading" });
      if (mode === "search") setSearching(true);
      if (mode === "refresh") setRefreshing(true);
      try {
        const { businesses } = await getBusinesses(q || undefined);
        if (id !== requestId.current) return;
        setState({ kind: "ready", businesses });
      } catch (error) {
        if (id !== requestId.current) return;
        setState({
          kind: "error",
          message:
            error instanceof ApiError
              ? error.message
              : "Coś poszło nie tak. Spróbuj ponownie.",
        });
      } finally {
        if (id === requestId.current) {
          setSearching(false);
          setRefreshing(false);
        }
      }
    },
    [],
  );

  // Debounce 300 ms przy wpisywaniu; pierwsze ładowanie bez zwłoki.
  useEffect(() => {
    const q = query.trim();
    if (!hasLoaded.current) {
      hasLoaded.current = true;
      load(q, "initial");
      return;
    }
    const timer = setTimeout(() => load(q, "search"), 300);
    return () => clearTimeout(timer);
  }, [query, load]);

  const businesses = state.kind === "ready" ? state.businesses : [];
  const trimmedQuery = query.trim();

  return (
    <FlatList
      style={styles.screen}
      data={businesses}
      keyExtractor={(business) => business.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load(trimmedQuery, "refresh")}
          tintColor={colors.primary}
        />
      }
      ItemSeparatorComponent={ItemSeparator}
      renderItem={({ item, index }) => (
        <BusinessCard
          business={item}
          featured={index === 0}
          onPress={() => router.push(`/business/${item.slug}`)}
        />
      )}
      ListHeaderComponent={
        <ListHeader
          query={query}
          onQueryChange={setQuery}
          searching={searching}
          resultsCount={state.kind === "ready" ? businesses.length : null}
        />
      }
      ListEmptyComponent={
        <ListEmpty
          state={state}
          hasQuery={trimmedQuery.length > 0}
          onClear={() => setQuery("")}
          onRetry={() => load(trimmedQuery, "initial")}
        />
      }
    />
  );
}

function ItemSeparator() {
  return <View style={styles.separator} />;
}

function ListHeader({
  query,
  onQueryChange,
  searching,
  resultsCount,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  searching: boolean;
  resultsCount: number | null;
}) {
  return (
    <View>
      <View style={styles.header}>
        <View>
          <MetaLabel>Lokalizacja</MetaLabel>
          <View style={styles.locationRow}>
            <DisplayText size={19} weight={700}>
              Warszawa
            </DisplayText>
            <BodyText size={11} color={colors.mutedForeground}>
              ▾
            </BodyText>
          </View>
        </View>
      </View>

      <DisplayText size={34} weight={800} style={styles.title}>
        Zarezerwuj{"\n"}na dziś.
      </DisplayText>

      <View style={styles.searchBox}>
        <Feather name="search" size={15} color={colors.mutedForeground} />
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder="Barber, fryzjer, usługa…"
          placeholderTextColor={colors.mutedForegroundLight}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Szukaj firmy lub usługi"
          style={styles.searchInput}
        />
        {query.length > 0 ? (
          <Pressable
            onPress={() => onQueryChange("")}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Wyczyść wyszukiwanie">
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={FILTER_CHIPS}
        keyExtractor={(chip) => chip}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chipsRow}
        renderItem={({ item, index }) => (
          <View style={[styles.chip, index === 0 && styles.chipActive]}>
            <BodyText
              size={12}
              weight={600}
              color={
                index === 0 ? colors.primaryForeground : colors.foreground
              }>
              {item}
            </BodyText>
          </View>
        )}
      />

      <View style={styles.resultsHeader}>
        <DisplayText size={16} weight={700}>
          {query.trim() ? "Wyniki" : "W pobliżu"}
        </DisplayText>
        <MonoText size={11} color={colors.mutedForeground}>
          {searching
            ? "szukam…"
            : resultsCount !== null
              ? resultsCountLabel(resultsCount)
              : ""}
        </MonoText>
      </View>
    </View>
  );
}

function ListEmpty({
  state,
  hasQuery,
  onClear,
  onRetry,
}: {
  state: ResultsState;
  hasQuery: boolean;
  onClear: () => void;
  onRetry: () => void;
}) {
  if (state.kind === "loading") {
    return (
      <View style={styles.skeletons}>
        <SkeletonBlock height={190} radius={radii.card} />
        <SkeletonBlock height={90} radius={radii.card} />
        <SkeletonBlock height={90} radius={radii.card} />
      </View>
    );
  }

  if (state.kind === "error") {
    return (
      <View style={styles.stateWrap}>
        <DisplayText size={24} weight={800}>
          Coś nie zagrało.
        </DisplayText>
        <BodyText
          size={13}
          color={colors.mutedForeground}
          style={styles.stateText}>
          {state.message}
        </BodyText>
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}>
          <BodyText size={13} weight={700} color={colors.primaryForeground}>
            Spróbuj ponownie
          </BodyText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.stateWrap}>
      <DisplayText size={24} weight={800}>
        Nic nie znaleźliśmy.
      </DisplayText>
      <BodyText
        size={13}
        color={colors.mutedForeground}
        style={styles.stateText}>
        {hasQuery
          ? "Spróbuj innej nazwy, usługi albo miasta."
          : "Firmy właśnie dołączają — zajrzyj tu za chwilę."}
      </BodyText>
      {hasQuery ? (
        <Pressable
          onPress={onClear}
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}>
          <BodyText size={13} weight={700} color={colors.primaryForeground}>
            Wyczyść wyszukiwanie
          </BodyText>
        </Pressable>
      ) : null}
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  title: {
    marginBottom: spacing.lg,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderWidth: borderWidths.strong,
    borderColor: colors.borderStrong,
    borderRadius: radii.input,
    paddingVertical: spacing.md,
    paddingHorizontal: 15,
    marginBottom: spacing.md,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
    padding: 0,
    // Pole ma już obrys 1.5px atramentu — chowamy niebieski focus ring
    // przeglądarki (na native prop jest ignorowany). RN typuje tylko
    // solid/dotted/dashed, a react-native-web honoruje właśnie "none".
    outlineStyle: "none" as unknown as "solid",
  },
  chipsScroll: {
    marginHorizontal: -spacing.xl,
    marginBottom: spacing.xl,
    flexGrow: 0,
  },
  chipsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xs,
  },
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    borderWidth: borderWidths.hairline,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  resultsHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  separator: {
    height: 14,
  },
  skeletons: {
    gap: 14,
  },
  stateWrap: {
    backgroundColor: colors.highlight,
    borderWidth: borderWidths.hairline,
    borderColor: colors.borderDashed,
    borderStyle: "dashed",
    borderRadius: radii.card,
    padding: spacing.xl,
    alignItems: "flex-start",
  },
  stateText: {
    marginTop: spacing.xs,
  },
  cta: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.85,
  },
});
