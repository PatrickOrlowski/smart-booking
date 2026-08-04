import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/authz";

/**
 * POST /api/push/unsubscribe — usunięcie subskrypcji web push po `endpoint`.
 *
 * Warunek na `userId` siedzi w zapytaniu (deleteMany), nie w sprawdzeniu po
 * fakcie: użytkownik może skasować wyłącznie własne subskrypcje, a podwójne
 * kliknięcie „Wyłącz" nie kończy się wyjątkiem o nieistniejącym wierszu.
 */

const unsubscribeSchema = z.object({
  endpoint: z.url(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Wymagane zalogowanie" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "Nieprawidłowe body żądania" },
      { status: 400 },
    );
  }

  const parsed = unsubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION", message: "Nieprawidłowy endpoint subskrypcji" },
      { status: 422 },
    );
  }

  await prisma.pushSubscription.deleteMany({
    where: { endpoint: parsed.data.endpoint, userId: user.id },
  });

  return NextResponse.json({ ok: true });
}
