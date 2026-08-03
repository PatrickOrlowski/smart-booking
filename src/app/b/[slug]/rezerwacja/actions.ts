"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evaluateDiscountCode, normalizeDiscountCode } from "@/lib/discounts";
import { loadServiceContext } from "@/lib/availability-data";
import { findCustomerByContact } from "@/app/panel/(dashboard)/klienci/customer-match";
import { getTranslations } from "@/i18n/server";

/**
 * Podgląd rabatu w kroku „dane" flow rezerwacji.
 *
 * Wyłącznie odczyt — kod NIE jest tu rezerwowany ani zliczany. Ostateczna
 * walidacja i utrwalenie użycia dzieją się w POST /api/v1/bookings, w tej
 * samej transakcji co rezerwacja. Dzięki temu podgląd nigdy nie „zjada"
 * użycia kodu klientowi, który porzuci checkout.
 *
 * Kwota bazowa liczona jest NA SERWERZE z cennika (z nadpisaniem ceny dla
 * konkretnego pracownika) — klient nie podaje ceny, więc nie da się wyłudzić
 * większego rabatu podstawioną kwotą.
 */

const previewSchema = z.object({
  businessSlug: z.string().min(1),
  serviceId: z.string().min(1),
  resourceId: z.string().min(1).optional(),
  code: z.string().trim().min(1).max(64),
  /** Kontakt gościa — pozwala trafić w istniejący profil CRM przy limicie na klienta. */
  guestEmail: z.string().trim().max(160).optional(),
  guestPhone: z.string().trim().max(30).optional(),
});

export type DiscountPreview =
  | {
      ok: true;
      code: string;
      discountCents: number;
      subtotalCents: number;
      totalCents: number;
      currency: string;
    }
  | { ok: false; error: string };

export async function previewDiscountAction(
  input: unknown,
): Promise<DiscountPreview> {
  const { t } = await getTranslations();
  const parsed = previewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: t("disc.enterCode") };
  }
  const data = parsed.data;

  try {
    const context = await loadServiceContext(data.businessSlug, data.serviceId);
    if (!context) {
      return { ok: false, error: t("disc.serviceNotFound") };
    }

    // Ta sama cena, którą zobaczy silnik rezerwacji: nadpisanie z ServiceResource
    // dla wybranego pracownika, inaczej cena katalogowa usługi.
    const resource = data.resourceId
      ? context.resources.find((entry) => entry.id === data.resourceId)
      : undefined;
    const subtotalCents =
      resource?.priceCentsOverride ?? context.service.priceCents;

    // Kim jest rezerwujący: zalogowany po koncie, gość po kontakcie z formularza.
    // Bez tego limit „raz na klienta" ujawniłby się dopiero przy potwierdzeniu.
    let customerId: string | null = null;
    try {
      const session = await auth();
      if (session?.user?.id) {
        const customer = await prisma.customer.findFirst({
          where: { businessId: context.business.id, userId: session.user.id },
          select: { id: true },
        });
        customerId = customer?.id ?? null;
        if (!customerId && (session.user.email || session.user.name)) {
          const match = await findCustomerByContact(context.business.id, {
            email: session.user.email ?? null,
            phone: null,
          });
          customerId = match?.id ?? null;
        }
      } else if (data.guestEmail || data.guestPhone) {
        const match = await findCustomerByContact(context.business.id, {
          email: data.guestEmail || null,
          phone: data.guestPhone || null,
        });
        customerId = match?.id ?? null;
      }
    } catch {
      customerId = null;
    }

    const { calculation } = await evaluateDiscountCode(prisma, {
      businessId: context.business.id,
      enteredCode: data.code,
      subtotalCents,
      customerId,
      currency: context.service.currency,
    });

    if (!calculation.valid) {
      // Komunikat po stronie silnika jest polski — tłumaczymy po kodzie powodu.
      return { ok: false, error: t(`disc.${calculation.reason}`) };
    }

    return {
      ok: true,
      code: normalizeDiscountCode(data.code),
      discountCents: calculation.discountCents,
      subtotalCents,
      totalCents: subtotalCents - calculation.discountCents,
      currency: context.service.currency,
    };
  } catch (error) {
    console.error("previewDiscountAction", error);
    return { ok: false, error: t("bf.codeCheckFailed") };
  }
}
