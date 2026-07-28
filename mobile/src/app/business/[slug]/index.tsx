import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ApiError,
  getBusiness,
  type BusinessDetail,
  type BusinessService,
} from "@/api/client";
import { SkeletonBlock } from "@/components/booking-ui";
import { openStatus, ratingValueLabel } from "@/components/business-format";
import { BusinessInfo } from "@/components/business-info";
import { BusinessPhoto } from "@/components/business-photo";
import { BusinessReviews } from "@/components/business-reviews";
import { BusinessServices } from "@/components/business-services";
import { BusinessTabs } from "@/components/business-tabs";
import { borderWidths, colors, radii, spacing } from "@/theme/tokens";
import { BodyText, DisplayText, MonoText } from "@/theme/typography";

/**
 * Profil firmy /business/[slug] (prototyp s2): galeria-placeholder ze
 * strzałką wstecz, nazwa + ocena + adres + status otwarcia, zakładki
 * Usługi / Opinie / Info. „Wybierz" przy usłudze prowadzi do flow
 * rezerwacji /business/[slug]/book?serviceId= (bez importu ekranów).
 */

const TABS = [
  { key: "uslugi", label: "Usługi" },
  { key: "opinie", label: "Opinie" },
  { key: "info", label: "Info" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

type LoadState =
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "error"; message: string }
  | { kind: "ready"; business: BusinessDetail };

export default function BusinessProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const [tab, setTab] = useState<TabKey>("uslugi");
  const [reloadKey, setReloadKey] = useState(0);

  // Wynik przypięty do klucza żądania: efekt nie kasuje stanu synchronicznie
  // (to kaskada renderów), a „Spróbuj ponownie" bumpuje klucz — poprzednia
  // odpowiedź przestaje pasować, więc ekran sam wraca do szkieletu.
  const requestKey = `${slug ?? ""}|${reloadKey}`;
  const [result, setResult] = useState<{
    key: string;
    state: LoadState;
  } | null>(null);

  useEffect(() => {
    if (!slug) return;
    let stale = false;
    (async () => {
      try {
        const { business } = await getBusiness(slug);
        if (!stale) {
          setResult({ key: requestKey, state: { kind: "ready", business } });
        }
      } catch (error) {
        if (stale) return;
        if (error instanceof ApiError && error.code === "NOT_FOUND") {
          setResult({ key: requestKey, state: { kind: "not-found" } });
          return;
        }
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
    })();
    return () => {
      stale = true;
    };
  }, [slug, requestKey]);

  const state: LoadState = !slug
    ? { kind: "not-found" }
    : result && result.key === requestKey
      ? result.state
      : { kind: "loading" };

  const reload = () => setReloadKey((key) => key + 1);

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  };

  const pickService = (service: BusinessService) => {
    if (!slug) return;
    router.push({
      pathname: "/business/[slug]/book",
      params: { slug, serviceId: service.id },
    });
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View>
        <BusinessPhoto label="Galeria · zdjęcia" style={styles.gallery} />
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Wstecz"
          hitSlop={8}
          style={({ pressed }) => [
            styles.backCircle,
            { top: insets.top + spacing.sm },
            pressed && styles.pressed,
          ]}>
          <BodyText size={14}>←</BodyText>
        </Pressable>
      </View>

      {state.kind === "loading" ? <ProfileSkeleton /> : null}

      {state.kind === "not-found" ? (
        <StatePanel
          title="Nie znaleźliśmy tej firmy."
          message="Profil mógł zostać wyłączony albo adres jest nieaktualny."
          cta="Wróć do szukania"
          onCta={goBack}
        />
      ) : null}

      {state.kind === "error" ? (
        <StatePanel
          title="Coś nie zagrało."
          message={state.message}
          cta="Spróbuj ponownie"
          onCta={reload}
        />
      ) : null}

      {state.kind === "ready" ? (
        <ProfileBody
          business={state.business}
          tab={tab}
          onTabChange={setTab}
          onPickService={pickService}
        />
      ) : null}
    </ScrollView>
  );
}

function ProfileBody({
  business,
  tab,
  onTabChange,
  onPickService,
}: {
  business: BusinessDetail;
  tab: TabKey;
  onTabChange: (tab: TabKey) => void;
  onPickService: (service: BusinessService) => void;
}) {
  const location = business.locations[0];
  const status = location
    ? openStatus(location.openingHours, location.timezone)
    : null;

  return (
    <View style={styles.body}>
      <DisplayText size={27} weight={800}>
        {business.name}
      </DisplayText>

      <View style={styles.metaRow}>
        {business.rating.count > 0 && business.rating.average !== null ? (
          <MonoText size={12} weight={500}>
            {ratingValueLabel(business.rating.average)} ★ (
            {business.rating.count})
          </MonoText>
        ) : (
          <MonoText size={12} color={colors.mutedForeground}>
            Nowość
          </MonoText>
        )}
        {location ? (
          <>
            <Dot />
            <BodyText size={12} color={colors.mutedForeground}>
              {location.addressLine1}, {location.city}
            </BodyText>
          </>
        ) : null}
        {status ? (
          <>
            <Dot />
            <BodyText
              size={12}
              weight={600}
              color={status.isOpen ? colors.success : colors.mutedForeground}>
              {status.label}
            </BodyText>
          </>
        ) : null}
      </View>

      <View style={styles.tabs}>
        <BusinessTabs tabs={TABS} active={tab} onChange={onTabChange} />
      </View>

      {tab === "uslugi" ? (
        <BusinessServices business={business} onPick={onPickService} />
      ) : null}
      {tab === "opinie" ? <BusinessReviews rating={business.rating} /> : null}
      {tab === "info" ? (
        location ? (
          <BusinessInfo location={location} />
        ) : (
          <View style={styles.missingCard}>
            <BodyText size={13} weight={700}>
              Brak danych lokalizacji
            </BodyText>
            <BodyText
              size={12}
              color={colors.mutedForeground}
              style={styles.missingText}>
              Ta firma nie podała jeszcze adresu ani godzin otwarcia.
            </BodyText>
          </View>
        )
      ) : null}
    </View>
  );
}

function Dot() {
  return (
    <BodyText size={12} color={colors.mutedForeground}>
      ·
    </BodyText>
  );
}

function ProfileSkeleton() {
  return (
    <View style={styles.body}>
      <SkeletonBlock height={30} radius={radii.sm} style={styles.skeletonRow} />
      <SkeletonBlock
        height={14}
        radius={radii.sm}
        style={[styles.skeletonRow, styles.skeletonNarrow]}
      />
      <SkeletonBlock height={220} radius={radii.card} />
    </View>
  );
}

function StatePanel({
  title,
  message,
  cta,
  onCta,
}: {
  title: string;
  message: string;
  cta: string;
  onCta: () => void;
}) {
  return (
    <View style={[styles.body, styles.statePanel]}>
      <DisplayText size={24} weight={800}>
        {title}
      </DisplayText>
      <BodyText
        size={13}
        color={colors.mutedForeground}
        style={styles.stateText}>
        {message}
      </BodyText>
      <Pressable
        onPress={onCta}
        style={({ pressed }) => [styles.stateCta, pressed && styles.pressed]}>
        <BodyText size={13} weight={700} color={colors.primaryForeground}>
          {cta}
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
    paddingBottom: spacing.xxl,
  },
  gallery: {
    height: 180,
  },
  backCircle: {
    position: "absolute",
    left: 14,
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    borderWidth: borderWidths.strong,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.8,
  },
  body: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: 9,
  },
  tabs: {
    marginTop: spacing.lg + 2,
  },
  missingCard: {
    marginTop: spacing.xl,
    backgroundColor: colors.highlight,
    borderWidth: borderWidths.hairline,
    borderColor: colors.borderDashed,
    borderStyle: "dashed",
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  missingText: {
    marginTop: spacing.xs,
  },
  skeletonRow: {
    marginBottom: spacing.md,
  },
  skeletonNarrow: {
    width: "60%",
  },
  statePanel: {
    alignItems: "flex-start",
  },
  stateText: {
    marginTop: spacing.xs,
  },
  stateCta: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
