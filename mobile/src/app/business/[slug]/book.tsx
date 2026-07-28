import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getBusiness,
  type BookingPayment,
  type BusinessDetail,
  type CreatedBooking,
} from "@/api/client";
import { buildFlowDays, priceLabel } from "@/components/booking-format";
import { useSlotHold } from "@/components/booking-hooks";
import { BookingDateStep } from "@/components/booking-date-step";
import {
  BookingDetailsStep,
  type GuestDetails,
} from "@/components/booking-details-step";
import { BookingStaffStep } from "@/components/booking-staff-step";
import { BookingSuccess } from "@/components/booking-success";
import { BackCircle, PrimaryButton } from "@/components/booking-ui";
import { addVisit } from "@/storage/visits";
import { DEFAULT_TIMEZONE } from "@/lib/format";
import { colors, spacing } from "@/theme/tokens";
import { BodyText, DisplayText } from "@/theme/typography";

/**
 * Flow rezerwacji /business/[slug]/book?serviceId= (prototyp s3–s6):
 * pracownik → termin → dane → sukces. Kroki żyją w lokalnym stanie ekranu;
 * hold slotu na poziomie flow (useSlotHold zwalnia go przy każdym zejściu
 * z kroku „dane" — także przy porzuceniu całego ekranu). Dane gościa też
 * na poziomie flow: po 409 wracają do kroku danych nietknięte.
 */

type Step = "staff" | "termin" | "dane" | "sukces";

export default function BookingFlowScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ slug: string; serviceId?: string }>();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const serviceId = typeof params.serviceId === "string" ? params.serviceId : "";

  /* --------------------------- dane firmy --------------------------- */

  const [reloadKey, setReloadKey] = useState(0);
  // Wynik przypięty do klucza żądania (ten sam wzorzec co useAvailability):
  // zmiana slug/reloadKey sama unieważnia poprzednią odpowiedź, więc efekt
  // nie musi kasować stanu synchronicznie — spinner wraca bez kaskady renderów.
  const businessKey = `${slug}|${reloadKey}`;
  const [businessResult, setBusinessResult] = useState<{
    key: string;
    business: BusinessDetail | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!slug) return;
    let stale = false;
    getBusiness(slug)
      .then((response) => {
        if (!stale) {
          setBusinessResult({
            key: businessKey,
            business: response.business,
            error: null,
          });
        }
      })
      .catch(() => {
        if (!stale) {
          setBusinessResult({
            key: businessKey,
            business: null,
            error: "Nie udało się pobrać danych salonu. Spróbuj ponownie.",
          });
        }
      });
    return () => {
      stale = true;
    };
  }, [slug, businessKey]);

  const currentBusiness =
    businessResult && businessResult.key === businessKey
      ? businessResult
      : null;
  const business = currentBusiness?.business ?? null;
  const loadError = currentBusiness?.error ?? null;

  const location = business?.locations[0] ?? null;
  const service = business?.services.find((item) => item.id === serviceId);
  const timezone = location?.timezone ?? DEFAULT_TIMEZONE;

  /* --------------------------- stan flow ---------------------------- */

  const [step, setStep] = useState<Step>("staff");
  const [resourceId, setResourceId] = useState("any");
  const [date, setDate] = useState<string | null>(null);
  const [startAt, setStartAt] = useState<string | null>(null);
  const [booking, setBooking] = useState<CreatedBooking | null>(null);
  // Zadatek z POST /bookings — ekran sukcesu pokazuje kwotę i link płatności.
  const [payment, setPayment] = useState<BookingPayment | null>(null);
  // Bump wymusza świeże sloty po powrocie z kroku „dane" (konflikt/wygaśnięcie).
  const [slotsRefreshKey, setSlotsRefreshKey] = useState(0);

  // Dane gościa na poziomie flow — komunikat konfliktu obiecuje
  // „Twoje dane zostają", a powrót do slotów odmontowuje krok „dane".
  const [guest, setGuest] = useState<GuestDetails>({
    name: "",
    phone: "",
    email: "",
  });
  const updateGuest = useCallback(
    (patch: Partial<GuestDetails>) =>
      setGuest((current) => ({ ...current, ...patch })),
    [],
  );

  // Hold żyje na poziomie flow: zwalnia się przy każdym zejściu z kroku
  // „dane" — również gdy użytkownik porzuci cały ekran (cleanup efektu).
  const hold = useSlotHold({
    enabled: step === "dane",
    businessSlug: slug,
    serviceId: service?.id ?? "",
    resourceId,
    startAtIso: step === "dane" ? startAt : null,
  });

  const days = useMemo(() => buildFlowDays(timezone), [timezone]);
  const todayIso = days[0].iso;

  // Zmiana kroku = nowy „ekran" — przewijamy na górę.
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [step]);

  const leaveFlow = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [router]);

  // Bez useCallback: React Compiler (app.json → experiments.reactCompiler)
  // memoizuje te handlery sam, a ręczna memoizacja z pustą/niepełną listą
  // zależności blokowała mu optymalizację CAŁEGO ekranu. Żadne z dzieci nie
  // trzyma ich w zależnościach efektu, więc tożsamość i tak nie jest nośna.
  const backToSlots = () => {
    setSlotsRefreshKey((key) => key + 1);
    setStartAt(null);
    setStep("termin");
  };

  const handleSuccess = async (
    created: CreatedBooking,
    createdPayment: BookingPayment | null,
  ) => {
    // Zapis lokalnej wizyty best-effort — awaria dysku nie może zabrać
    // użytkownikowi ekranu potwierdzenia.
    try {
      await addVisit({
        bookingId: created.id,
        businessSlug: slug,
        businessName: created.businessName,
        serviceName: created.serviceName,
        startAt: created.startAt,
        timezone: created.timezone,
        priceCents: created.priceCents,
        email: guest.email.trim(),
      });
    } catch {
      // brak zapisu = wizyta zniknie z listy, ale rezerwacja jest ważna
    }
    setBooking(created);
    setPayment(createdPayment);
    setStep("sukces");
  };

  /* ------------------------- stany brzegowe -------------------------- */

  if (!slug || !serviceId) {
    return (
      <FlowMessage
        paddingTop={insets.top + spacing.lg}
        title="Czegoś tu brakuje"
        message="Nie wiemy, jaką usługę chcesz zarezerwować. Wróć i wybierz ją z cennika."
        cta="Wróć"
        onCta={leaveFlow}
      />
    );
  }

  if (loadError) {
    return (
      <FlowMessage
        paddingTop={insets.top + spacing.lg}
        title="Nie udało się wczytać"
        message={loadError}
        cta="Spróbuj ponownie"
        onCta={() => setReloadKey((key) => key + 1)}
        onBack={leaveFlow}
      />
    );
  }

  if (!business) {
    return (
      <View style={[styles.loading, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!service || !location) {
    return (
      <FlowMessage
        paddingTop={insets.top + spacing.lg}
        title="Nie znaleziono usługi"
        message="Ta usługa nie istnieje albo została wycofana z cennika. Wybierz inną z profilu salonu."
        cta="Wróć"
        onCta={leaveFlow}
      />
    );
  }

  if (!service.onlineBookable || service.priceType === "ON_REQUEST") {
    return (
      <FlowMessage
        paddingTop={insets.top + spacing.lg}
        title="Tylko na zapytanie"
        message="Tej usługi nie zarezerwujesz online. Skontaktuj się z salonem telefonicznie."
        cta="Wróć"
        onCta={leaveFlow}
      />
    );
  }

  const staffLabel =
    resourceId === "any"
      ? "Dowolny pracownik"
      : (location.resources.find((resource) => resource.id === resourceId)
          ?.name ?? "Dowolny pracownik");
  const priceText = priceLabel(
    service.priceCents,
    service.priceType,
    service.currency,
  );

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.screen}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg },
      ]}>
      {step === "staff" ? (
        <View style={styles.padded}>
          <BookingStaffStep
            slug={slug}
            service={service}
            resources={location.resources}
            timezone={timezone}
            todayIso={todayIso}
            onBack={leaveFlow}
            onPick={(picked) => {
              setResourceId(picked);
              setDate(todayIso);
              setStartAt(null);
              setStep("termin");
            }}
          />
        </View>
      ) : null}

      {step === "termin" ? (
        <BookingDateStep
          slug={slug}
          service={service}
          resourceId={resourceId}
          staffLabel={staffLabel}
          days={days}
          selectedDate={date ?? todayIso}
          refreshKey={slotsRefreshKey}
          onBack={() => setStep("staff")}
          onPickDay={setDate}
          onPickSlot={(picked) => {
            setStartAt(picked);
            setStep("dane");
          }}
        />
      ) : null}

      {step === "dane" && startAt ? (
        <View style={styles.padded}>
          <BookingDetailsStep
            slug={slug}
            service={service}
            resourceId={resourceId}
            staffLabel={staffLabel}
            timezone={timezone}
            cancellationCutoffHours={location.cancellationCutoffHours}
            priceText={priceText}
            startAtIso={startAt}
            hold={hold}
            guest={guest}
            onGuestChange={updateGuest}
            onBack={() => {
              setStartAt(null);
              setStep("termin");
            }}
            onBackToSlots={backToSlots}
            onSuccess={handleSuccess}
          />
        </View>
      ) : null}

      {step === "sukces" && booking ? (
        <View style={styles.padded}>
          <BookingSuccess
            booking={booking}
            payment={payment}
            email={guest.email.trim()}
            onGoToVisits={() => router.replace("/wizyty")}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

/** Pełnoekranowy stan (błąd / brak usługi): nagłówek display, opis, CTA. */
function FlowMessage({
  paddingTop,
  title,
  message,
  cta,
  onCta,
  onBack,
}: {
  paddingTop: number;
  title: string;
  message: string;
  cta: string;
  onCta: () => void;
  onBack?: () => void;
}) {
  return (
    <View style={[styles.screen, styles.padded, { paddingTop }]}>
      {onBack ? <BackCircle onPress={onBack} /> : null}
      <DisplayText size={27} weight={800} style={styles.messageTitle}>
        {title}
      </DisplayText>
      <BodyText
        size={13}
        color={colors.mutedForeground}
        style={styles.messageText}>
        {message}
      </BodyText>
      <PrimaryButton label={cta} onPress={onCta} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: spacing.xxl + spacing.lg,
  },
  padded: {
    paddingHorizontal: spacing.xl,
  },
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  messageTitle: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  messageText: {
    marginBottom: spacing.xl,
  },
});
