"use client";

/**
 * Wywołanie server action odporne na zerwane połączenie.
 *
 * Server action wywołana z klienta to zwykły fetch — przy braku sieci
 * `await action(...)` RZUCA, zamiast zwrócić `{ ok: false }`. Bez tego opakowania
 * kod po wywołaniu (cofnięcie optymistycznej zmiany, wyzerowanie stanu
 * „zapisywanie…", toast) nigdy się nie wykonywał: kafel zostawał w nowym
 * miejscu i pulsował w nieskończoność, a manager był przekonany, że zapisał.
 *
 * Zwraca ten sam kształt co akcja, więc wywołania nie zmieniają struktury:
 * `const result = await runAction(() => saveTableAction(input))`.
 */
export async function runAction<T extends { ok: boolean }>(
  action: () => Promise<T>,
): Promise<T | { ok: false; error: string }> {
  try {
    return await action();
  } catch (error) {
    console.error("Server action nie doszła do serwera", error);
    return {
      ok: false,
      error: "Brak połączenia — zmiana nie została zapisana. Spróbuj ponownie.",
    };
  }
}
