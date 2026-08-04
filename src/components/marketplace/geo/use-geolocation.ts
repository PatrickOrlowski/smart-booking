"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { hasValidGeoParams } from "./coords";

/**
 * Pozycja użytkownika żyje w searchParams (?lat=&lng=), nie w stanie React —
 * dzięki temu wyniki liczy serwer, a back button i odświeżenie strony
 * zachowują tryb „w pobliżu".
 *
 * Prywatność: współrzędne zaokrąglamy do 3 miejsc po przecinku (~110 m) —
 * wystarcza do sortowania po odległości w promieniu 2–50 km, a URL (historia
 * przeglądarki, logi serwera, wklejony link) nie wskazuje konkretnego budynku.
 */

export type GeoErrorKind = "denied" | "unavailable" | "unsupported";

export function useGeolocation() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Ta sama walidacja co serwer (parseCoordinate) — samo ISTNIENIE lat/lng
  // ze śmieciową wartością (?lat=999) nie może pokazywać aktywnego trybu geo,
  // skoro serwer renderuje wtedy listę domyślną.
  const hasGeo = hasValidGeoParams(searchParams);
  const [locating, setLocating] = useState(false);
  const [errorKind, setErrorKind] = useState<GeoErrorKind | null>(null);

  const navigate = useCallback(
    (params: URLSearchParams) => {
      router.replace(params.size ? `/?${params.toString()}` : "/", {
        scroll: false,
      });
    },
    [router],
  );

  const request = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setErrorKind("unsupported");
      return;
    }
    setLocating(true);
    setErrorKind(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        // Pozycja przychodzi z opóźnieniem (dialog uprawnień + do 10 s
        // timeoutu) — bazą są AKTUALNE parametry z window.location, nie
        // snapshot searchParams z chwili kliknięcia, żeby nie cofnąć ?q=
        // wpisanego w międzyczasie.
        const params = new URLSearchParams(window.location.search);
        params.set("lat", position.coords.latitude.toFixed(3));
        params.set("lng", position.coords.longitude.toFixed(3));
        navigate(params);
      },
      (error) => {
        // Odmowa uprawnień / brak sygnału — czytelny komunikat i lista
        // domyślna, nigdy crash.
        setLocating(false);
        setErrorKind(
          error.code === error.PERMISSION_DENIED ? "denied" : "unavailable",
        );
      },
      { maximumAge: 60_000, timeout: 10_000 },
    );
  }, [navigate]);

  const clear = useCallback(() => {
    setErrorKind(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("lat");
    params.delete("lng");
    params.delete("maxKm");
    navigate(params);
  }, [navigate, searchParams]);

  return { hasGeo, locating, errorKind, request, clear };
}
