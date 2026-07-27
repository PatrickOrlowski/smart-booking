import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Toaster } from "@/components/ui/sonner";

/**
 * Zewnętrzny layout panelu — pilnuje wyłącznie sesji.
 *
 * Sprawdzenie "czy użytkownik ma firmę" mieszka w layoutcie grupy
 * (dashboard); tu nie może go być, bo /panel/nowa (onboarding) również
 * renderuje się w tym layoutcie i przekierowanie zapętliłoby się.
 */
export default async function PanelLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      {children}
      <Toaster position="bottom-right" />
    </div>
  );
}
