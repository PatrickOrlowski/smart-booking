"use client";

import { useEffect, useState } from "react";

import { useTranslations } from "@/i18n/client";

/**
 * Sekcja „Powiadomienia" na /konto: przełącznik web push dla tego urządzenia.
 *
 * Stany:
 * - `configured=false` (serwer bez kluczy VAPID) → dopisek „wkrótce", bez przycisku;
 * - przeglądarka bez SW/PushManager/Notification → komunikat „nieobsługiwane";
 * - uprawnienia zablokowane → instrukcja odblokowania w przeglądarce;
 * - włączone/wyłączone → przycisk przeciwnego działania.
 *
 * Subskrypcja żyje per urządzenie+przeglądarka; serwer trzyma ją w tabeli
 * push_subscriptions (upsert po endpoint w /api/push/subscribe).
 */

type PushState = "loading" | "unsupported" | "denied" | "on" | "off";

/** Klucz VAPID (base64url) → Uint8Array dla PushManager.subscribe. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

function isPushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function PushToggle({
  configured,
  vapidPublicKey,
}: {
  /** isPushEnabled() z serwera — komplet kluczy VAPID w env. */
  configured: boolean;
  vapidPublicKey: string | null;
}) {
  const { t } = useTranslations();
  const [state, setState] = useState<PushState>("loading");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured || !vapidPublicKey) return;

    let cancelled = false;
    const detect = async (): Promise<PushState> => {
      if (!isPushSupported()) return "unsupported";
      if (Notification.permission === "denied") return "denied";
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = registration
          ? await registration.pushManager.getSubscription()
          : null;
        return subscription ? "on" : "off";
      } catch {
        return "off";
      }
    };
    void detect().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [configured, vapidPublicKey]);

  const enable = async () => {
    if (!vapidPublicKey || pending) return;
    setPending(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const keys = subscription.toJSON().keys ?? {};
      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: { p256dh: keys.p256dh, auth: keys.auth },
        }),
      });
      if (!response.ok) {
        // Serwer nie przyjął subskrypcji — nie zostawiamy jej wiszącej
        // w przeglądarce, bo nikt by na nią nie wysyłał.
        await subscription.unsubscribe().catch(() => undefined);
        throw new Error(`subscribe HTTP ${response.status}`);
      }
      setState("on");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "NotAllowedError") {
        setState("denied");
      } else {
        console.error("push enable:", cause);
        setError(t("konto.notif.error"));
      }
    } finally {
      setPending(false);
    }
  };

  const disable = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setState("off");
    } catch (cause) {
      console.error("push disable:", cause);
      setError(t("konto.notif.error"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4 md:p-5">
      <div className="md:flex md:items-start md:justify-between md:gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <h2 className="font-display text-[17px] leading-tight font-bold tracking-tight">
              {t("konto.notif.title")}
            </h2>
            {configured && state === "on" ? (
              <span className="inline-flex flex-none items-center rounded-md bg-success-soft px-2 py-1 font-mono text-[10px] tracking-wide text-success">
                {t("konto.notif.on")}
              </span>
            ) : null}
            {!configured ? (
              <span className="inline-flex flex-none items-center rounded-md bg-muted px-2 py-1 font-mono text-[10px] tracking-wide text-muted-foreground">
                {t("konto.notif.soon")}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {!configured
              ? t("konto.notif.soonText")
              : state === "unsupported"
                ? t("konto.notif.unsupported")
                : state === "denied"
                  ? t("konto.notif.denied")
                  : t("konto.notif.text")}
          </p>
        </div>

        {configured && (state === "on" || state === "off" || state === "loading") ? (
          <div className="mt-3 md:mt-0 md:flex-none">
            {state === "on" ? (
              <button
                type="button"
                onClick={disable}
                disabled={pending}
                className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-full border-[1.5px] border-border-strong bg-card px-4 text-[13px] font-semibold transition-colors hover:bg-muted disabled:opacity-60 md:w-auto"
              >
                {pending ? t("konto.notif.pending") : t("konto.notif.disable")}
              </button>
            ) : (
              <button
                type="button"
                onClick={enable}
                disabled={pending || state === "loading"}
                className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-60 md:w-auto"
              >
                {pending ? t("konto.notif.pending") : t("konto.notif.enable")}
              </button>
            )}
          </div>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] font-medium text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
