import { NextResponse } from "next/server";
import { releaseHold } from "@/lib/hold";
import { forgetHold } from "@/lib/hold-guard";

/**
 * DELETE /api/v1/holds/[token] — zwolnienie blokady slotu.
 *
 * Woła to klient przy porzuceniu kroku „dane" (powrót do listy terminów).
 * Operacja jest idempotentna: nieistniejący albo już wygasły token to nadal
 * 200 — z punktu widzenia klienta slot jest wolny.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (!token) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "Brak tokenu blokady" },
      { status: 400 },
    );
  }

  const released = await releaseHold(token);
  // Zwolniony hold przestaje zajmować limit aktywnych blokad klienta.
  forgetHold(token);
  return NextResponse.json({ released });
}
