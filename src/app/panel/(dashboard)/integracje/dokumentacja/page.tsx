import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { getPanelBusiness } from "@/app/panel/data";
import { RATE_LIMIT_PER_MINUTE } from "@/lib/api-keys";

export const metadata: Metadata = {
  title: "Dokumentacja API — panel firmy",
};

/** Blok kodu w stylu design systemu — przewija się we własnym kontenerze. */
function CodeBlock({ children }: { children: string }) {
  return (
    <div className="overflow-x-auto rounded-xl bg-ink p-3.5">
      <pre className="font-mono text-[11.5px] leading-relaxed whitespace-pre text-ink-foreground">
        {children}
      </pre>
    </div>
  );
}

function Endpoint({
  method,
  path,
  children,
}: {
  method: string;
  path: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-primary px-2 py-1 font-mono text-[10px] font-medium tracking-wide text-primary-foreground">
          {method}
        </span>
        <code className="min-w-0 font-mono text-[13px] font-medium break-all">
          {path}
        </code>
      </div>
      <div className="mt-2.5 flex flex-col gap-2.5 text-[12.5px] text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

/**
 * Dokumentacja publicznego API dla integratorów — statyczna ściąga
 * z przykładami curl na danych zalogowanej firmy.
 */
export default async function DokumentacjaPage() {
  const panel = await getPanelBusiness();
  if (!panel) redirect("/panel/nowa");

  const base = `${env.NEXT_PUBLIC_APP_URL}/api/public/v1`;

  return (
    <div className="px-4 py-6 sm:px-6">
      <div className="mb-5">
        <Link
          href="/panel/integracje"
          className="text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
        >
          ← Integracje
        </Link>
        <div className="meta-label mt-3">Dokumentacja</div>
        <h1 className="mt-1 font-display text-[22px] leading-tight font-extrabold tracking-tight sm:text-[27px]">
          Publiczne API — v1
        </h1>
        <p className="mt-0.5 max-w-2xl text-[12.5px] text-muted-foreground">
          Wszystkie zapytania są ograniczone do firmy, do której należy klucz.
          Czasy zwracamy w UTC (ISO 8601), ceny w groszach.
        </p>
      </div>

      <div className="flex max-w-3xl flex-col gap-4">
        <section className="rounded-2xl border-[1.5px] border-border-strong bg-card p-4">
          <div className="meta-label mb-2">UWIERZYTELNIANIE</div>
          <p className="mb-2.5 text-[12.5px] text-muted-foreground">
            Klucz z zakładki „Klucze API” podajesz w nagłówku każdego
            żądania. Brak albo zły klucz → <code className="font-mono">401</code>,
            zasób innej firmy → <code className="font-mono">403</code>. Limit:{" "}
            {RATE_LIMIT_PER_MINUTE} żądań na minutę na klucz (powyżej →{" "}
            <code className="font-mono">429</code>).
          </p>
          <CodeBlock>{`curl ${base}/services \\
  -H "Authorization: Bearer pk_live_xxxx_TWOJ_KLUCZ"`}</CodeBlock>
          <p className="mt-2.5 text-[12.5px] text-muted-foreground">
            Błędy mają zawsze jeden format:
          </p>
          <CodeBlock>{`{ "error": { "code": "SLOT_TAKEN", "message": "Ten termin właśnie został zajęty. …" } }`}</CodeBlock>
        </section>

        <Endpoint method="GET" path="/api/public/v1/services">
          <p>
            Cennik firmy: identyfikatory usług, czasy trwania, ceny
            (grosze), kategoria. Rezerwować przez API można usługi z{" "}
            <code className="font-mono">onlineBookable: true</code>.
          </p>
        </Endpoint>

        <Endpoint method="GET" path="/api/public/v1/staff">
          <p>
            Aktywni pracownicy z listą <code className="font-mono">serviceIds</code>{" "}
            usług, które wykonują.
          </p>
        </Endpoint>

        <Endpoint
          method="GET"
          path="/api/public/v1/availability?serviceId=&date=YYYY-MM-DD"
        >
          <p>
            Wolne sloty jednego dnia. Opcjonalnie{" "}
            <code className="font-mono">resourceId</code> zawęża do jednego
            pracownika. Pole <code className="font-mono">slots</code> to widok
            scalony („dowolny pracownik”),{" "}
            <code className="font-mono">perResource</code> — rozbicie na osoby.
          </p>
        </Endpoint>

        <Endpoint method="POST" path="/api/public/v1/bookings">
          <p>
            Utworzenie rezerwacji na wolny slot (start ze{" "}
            <code className="font-mono">slots[].startAt</code>). Zajęty termin →{" "}
            <code className="font-mono">409 SLOT_TAKEN</code>. Rezerwacja
            dostaje status CONFIRMED i źródło „ręczne” (kanał firmy).
          </p>
          <CodeBlock>{`curl -X POST ${base}/bookings \\
  -H "Authorization: Bearer pk_live_xxxx_TWOJ_KLUCZ" \\
  -H "Content-Type: application/json" \\
  -d '{
    "serviceId": "…",
    "resourceId": "…",        // opcjonalnie — bez niego „dowolny pracownik"
    "startAt": "2026-08-10T09:00:00.000Z",
    "customer": { "name": "Jan Kowalski", "email": "jan@example.com", "phone": "+48 600 700 800" },
    "note": "Prośba o krótsze boki"
  }'`}</CodeBlock>
        </Endpoint>

        <Endpoint method="GET" path="/api/public/v1/bookings?from=&to=">
          <p>
            Lista rezerwacji firmy w zakresie dat (data{" "}
            <code className="font-mono">YYYY-MM-DD</code> albo pełne ISO;
            maks. 92 dni). Zawiera status, źródło, pozycje i dane klienta.
          </p>
        </Endpoint>

        <Endpoint method="POST" path="/api/public/v1/bookings/{id}/cancel">
          <p>
            Anulowanie w imieniu firmy (status CANCELLED_BY_BUSINESS, bez
            klienckiego limitu godzin). Body opcjonalne:{" "}
            <code className="font-mono">{`{ "reason": "…" }`}</code>. Zadatek
            rozliczany jak przy odwołaniu z panelu.
          </p>
        </Endpoint>

        <section className="rounded-2xl border-[1.5px] border-border-strong bg-card p-4">
          <div className="meta-label mb-2">WEBHOOKI</div>
          <p className="mb-2.5 text-[12.5px] text-muted-foreground">
            Zdarzenia <code className="font-mono">booking.created</code> i{" "}
            <code className="font-mono">booking.cancelled</code> wysyłamy jako
            POST z nagłówkami <code className="font-mono">X-Planner-Event</code>,{" "}
            <code className="font-mono">X-Planner-Delivery</code> oraz{" "}
            <code className="font-mono">X-Planner-Signature</code>. Podpis to
            HMAC SHA-256 surowego body sekretem webhooka:
          </p>
          <CodeBlock>{`X-Planner-Signature: sha256=HEX( HMAC_SHA256(sekret, surowe_body) )

// Node.js
const expected = "sha256=" + crypto
  .createHmac("sha256", process.env.PLANNER_WEBHOOK_SECRET)
  .update(rawBody)
  .digest("hex");
const valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header));`}</CodeBlock>
          <p className="mt-2.5 text-[12.5px] text-muted-foreground">
            Odpowiedz kodem 2xx w ciągu 5 sekund. Nieudane dostawy ponawiamy
            z rosnącym odstępem: po 1 min, 5 min, 30 min i 2 h (maks. 5
            prób) — status każdej dostawy widzisz w zakładce „Webhooki”.
          </p>
        </section>
      </div>
    </div>
  );
}
