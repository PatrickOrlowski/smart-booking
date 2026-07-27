import { redirect } from "next/navigation";
import { getPanelBusiness } from "@/app/panel/data";
import { OnboardingForm } from "./onboarding-form";

/**
 * Onboarding — kreator pierwszej firmy. Użytkownik, który już ma firmę,
 * wraca do panelu.
 */
export default async function OnboardingPage() {
  const panel = await getPanelBusiness();
  if (panel) {
    redirect("/panel");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-4 bg-ink px-6 text-ink-foreground">
        <span className="font-display text-lg font-extrabold tracking-tight">
          Planner
        </span>
        <span className="font-mono text-[11px] text-ink-foreground/60">
          KONFIGURACJA FIRMY
        </span>
      </header>
      <main className="flex-1">
        <OnboardingForm />
      </main>
    </div>
  );
}
