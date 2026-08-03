"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, UnauthorizedError } from "@/lib/authz";
import { BusinessType } from "@/generated/prisma/enums";

type ActionResult = { ok: true } | { ok: false; error: string };

const openingHoursBlockSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((block) => block.startMinute < block.endMinute, {
    message: "Godzina zamknięcia musi być po godzinie otwarcia",
  });

const createBusinessSchema = z.object({
  name: z.string().trim().min(2, "Podaj nazwę firmy").max(80),
  type: z.enum(BusinessType),
  addressLine1: z.string().trim().min(3, "Podaj adres").max(120),
  city: z.string().trim().min(2, "Podaj miasto").max(60),
  postalCode: z.string().trim().min(3, "Podaj kod pocztowy").max(12),
  timezone: z
    .string()
    .refine(
      (tz) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      },
      { message: "Nieprawidłowa strefa czasowa" },
    )
    .default("Europe/Warsaw"),
  openingHours: z
    .array(openingHoursBlockSchema)
    .min(1, "Zaznacz przynajmniej jeden dzień otwarcia")
    .max(14),
});

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replaceAll("ł", "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "firma";
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  for (let suffix = 2; ; suffix += 1) {
    const existing = await prisma.business.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
    candidate = `${base}-${suffix}`;
  }
}

/**
 * Kreator firmy: tworzy Business (ACTIVE) + Location + OpeningHours
 * + Subscription FREE/ACTIVE (bez trialu) i awansuje użytkownika
 * CUSTOMER → BUSINESS_OWNER.
 *
 * Jedyna akcja panelu bez requireBusinessManager — firma jeszcze nie
 * istnieje, więc wystarczy zalogowanie.
 */
export async function createBusinessAction(
  input: unknown,
): Promise<ActionResult> {
  let userId: string;
  try {
    const user = await requireUser();
    userId = user.id;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }

  const parsed = createBusinessSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane formularza",
    };
  }
  const data = parsed.data;

  try {
    const slug = await uniqueSlug(data.name);

    await prisma.$transaction(async (tx) => {
      await tx.business.create({
        data: {
          slug,
          name: data.name,
          type: data.type,
          status: "ACTIVE",
          ownerId: userId,
          // Restauracja nie ma cennika usług — rezerwację stolika niesie
          // syntetyczna usługa `TABLE_RESERVATION`. Bez niej publiczny profil,
          // silnik dostępności i akcje hosta nie mają czego zapisać.
          ...(data.type === "RESTAURANT"
            ? {
                services: {
                  create: {
                    name: "Rezerwacja stolika",
                    kind: "TABLE_RESERVATION" as const,
                    // Właściwy czas przy stole liczy TurnTimeRule/
                    // Location.defaultTurnTimeMin — tu tylko wartość domyślna.
                    durationMin: 90,
                    priceCents: 0,
                    priceType: "FREE" as const,
                    onlineBookable: true,
                  },
                },
              }
            : {}),
          locations: {
            create: {
              name: data.name,
              addressLine1: data.addressLine1,
              city: data.city,
              postalCode: data.postalCode,
              timezone: data.timezone,
              openingHours: {
                create: data.openingHours.map((block) => ({
                  weekday: block.weekday,
                  startMinute: block.startMinute,
                  endMinute: block.endMinute,
                })),
              },
            },
          },
          // Każda nowa firma startuje na darmowym planie — bez trialu,
          // upgrade przez /panel/plan.
          subscription: {
            create: { plan: "FREE", status: "ACTIVE", provider: "MANUAL" },
          },
        },
      });

      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (current?.role === "CUSTOMER") {
        await tx.user.update({
          where: { id: userId },
          data: { role: "BUSINESS_OWNER" },
        });
      }
    });
  } catch (error) {
    console.error("createBusinessAction", error);
    return { ok: false, error: "Nie udało się utworzyć firmy. Spróbuj ponownie." };
  }

  revalidatePath("/panel", "layout");
  return { ok: true };
}
