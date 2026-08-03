"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { runAction } from "@/components/panel/run-action";
import { USER_ROLE_LABELS, USER_ROLE_ORDER } from "@/components/admin/format";
import { changeUserRoleAction } from "@/app/admin/uzytkownicy/actions";
import type { UserRole } from "@/generated/prisma/enums";

/**
 * Zmiana roli konta. Gdy admin ogląda własną kartę, formularz jest zablokowany
 * i mówi dlaczego — walidacja i tak stoi na serwerze, ale użytkownik ma
 * dowiedzieć się o regule przed kliknięciem, a nie po.
 */
export function UserRoleForm({
  userId,
  currentRole,
  isSelf,
  ownedBusinesses,
}: {
  userId: string;
  currentRole: UserRole;
  isSelf: boolean;
  ownedBusinesses: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [role, setRole] = useState<UserRole>(currentRole);

  const submit = () => {
    if (role === currentRole) return;
    startTransition(async () => {
      const result = await runAction(() => changeUserRoleAction({ userId, role }));
      if (result.ok) {
        toast.success(`Rola zmieniona na „${USER_ROLE_LABELS[role]}"`);
        router.refresh();
      } else {
        toast.error(result.error);
        setRole(currentRole);
      }
    });
  };

  return (
    <section className="rounded-2xl border-[1.5px] border-border-strong bg-card px-4 py-4 sm:px-5">
      <h2 className="text-[14px] font-bold tracking-tight">Rola konta</h2>

      {isSelf ? (
        <p className="mt-2 rounded-lg bg-warning-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-warning-strong">
          To twoje konto. Własnej roli nie da się zmienić — inaczej jedno
          kliknięcie mogłoby zamknąć panel administracji od środka.
        </p>
      ) : (
        <>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            Rola decyduje o dostępie do paneli. Zmiana działa od następnego
            zalogowania konta.
          </p>
          {ownedBusinesses > 0 && role !== "BUSINESS_OWNER" && role !== "PLATFORM_ADMIN" ? (
            <p className="mt-2 rounded-lg bg-warning-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-warning-strong">
              To konto jest właścicielem firmy. Po zmianie roli straci dostęp do
              panelu firmy, a sama firma zostanie bez opiekuna.
            </p>
          ) : null}

          <div className="mt-3 flex flex-col gap-1.5">
            <Label htmlFor="user-role">Nowa rola</Label>
            <select
              id="user-role"
              value={role}
              onChange={(event) => setRole(event.target.value as UserRole)}
              disabled={isPending}
              className="h-11 rounded-full border border-border bg-card px-4 text-[13px] lg:h-9"
            >
              {USER_ROLE_ORDER.map((value) => (
                <option key={value} value={value}>
                  {USER_ROLE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <Button
            className="mt-3 h-11 w-full rounded-full font-semibold lg:h-9"
            disabled={role === currentRole || isPending}
            onClick={submit}
          >
            {isPending ? "Zapisywanie…" : "Zapisz rolę"}
          </Button>
        </>
      )}
    </section>
  );
}
