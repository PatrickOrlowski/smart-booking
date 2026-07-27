"use client";

import { DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Responsywne opakowania dialogów panelu firmy.
 *
 * Od `sm` w górę zachowują się jak zwykły `DialogContent`; na telefonie
 * (<640px) dialog zajmuje pełny ekran (h-dvh), nagłówek i stopka są
 * przyklejone, a przewija się wyłącznie treść (`PanelDialogBody`).
 */
export function PanelDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      className={cn(
        "max-sm:top-0 max-sm:left-0 max-sm:flex max-sm:h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:flex-col max-sm:overflow-y-hidden max-sm:rounded-none",
        className,
      )}
      {...props}
    />
  );
}

/** Przewijana treść dialogu — na telefonie wypełnia przestrzeń między nagłówkiem a stopką. */
export function PanelDialogBody({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 max-sm:-mx-4 max-sm:min-h-0 max-sm:flex-1 max-sm:overflow-y-auto max-sm:px-4",
        className,
      )}
      {...props}
    />
  );
}
