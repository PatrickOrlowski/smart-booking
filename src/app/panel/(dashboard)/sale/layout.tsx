import { redirect } from "next/navigation";
import { getPanelBusiness } from "@/app/panel/data";
import { SaleTabs } from "./sale-tabs";

/**
 * Sekcja restauracyjna panelu. Sale, stoliki i reguły turn time/pacing mają
 * sens wyłącznie dla firm typu RESTAURANT — salon trafia z powrotem na
 * kalendarz zamiast oglądać puste ekrany.
 */
export default async function SaleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const panel = await getPanelBusiness();
  if (!panel) redirect("/panel/nowa");
  if (panel.business.type !== "RESTAURANT") redirect("/panel");

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
      <div className="mb-4">
        <h1 className="font-display text-[22px] leading-tight font-extrabold tracking-tight sm:text-[27px]">
          Sale i stoliki
        </h1>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          Plan sali, pojemności i reguły, z których korzysta dobór stolika przy
          rezerwacji online.
        </p>
      </div>
      <SaleTabs />
      {children}
    </div>
  );
}
