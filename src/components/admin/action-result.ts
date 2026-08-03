/**
 * Wspólny kształt wyniku server actions panelu admina.
 *
 * Typ mieszka poza plikami `"use server"` celowo: taki moduł może eksportować
 * wyłącznie funkcje asynchroniczne, a ten typ importują też komponenty
 * klienckie, żeby zawężenie po `result.ok` działało bez rzutowań.
 */
export type ActionResult = { ok: true } | { ok: false; error: string };
