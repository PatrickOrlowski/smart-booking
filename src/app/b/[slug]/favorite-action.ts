"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/authz";

/**
 * Przełącza firmę w ulubionych zalogowanego użytkownika.
 * Niezalogowany ląduje na /login.
 */

const toggleSchema = z.object({ businessId: z.string().min(1).max(64) });

export async function toggleFavorite(businessId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = toggleSchema.safeParse({ businessId });
  if (!parsed.success) return;

  // Slug bierzemy z bazy — wartość z klienta trafiałaby prosto do
  // revalidatePath, pozwalając unieważniać cache dowolnych ścieżek.
  const business = await prisma.business.findFirst({
    where: { id: parsed.data.businessId, status: "ACTIVE" },
    select: { id: true, slug: true },
  });
  if (!business) return;

  // deleteMany zamiast delete: dwa równoległe kliknięcia „usuń" nie mogą
  // wysypać akcji błędem P2025 (rekord już usunięty).
  const removed = await prisma.favorite.deleteMany({
    where: { userId: user.id, businessId: business.id },
  });

  if (removed.count === 0) {
    // skipDuplicates — podwójny klik nie ma się wysypać na unikalności.
    await prisma.favorite.createMany({
      data: [{ userId: user.id, businessId: business.id }],
      skipDuplicates: true,
    });
  }

  revalidatePath(`/b/${business.slug}`);
}
