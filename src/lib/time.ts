/**
 * Konwersje czasu lokalnego lokalizacji ↔ UTC.
 *
 * W bazie każdy znacznik czasu jest instantem w UTC (timestamptz). Grafiki
 * pracowników i godziny otwarcia są natomiast zapisane jako czas ścienny
 * ("od 9:00 do 17:00 w strefie lokalu") — te dwa światy trzeba przeliczać
 * świadomie, bo w dobie zmiany czasu doba ma 23 albo 25 godzin.
 *
 * Implementacja opiera się na Intl, bez zewnętrznej biblioteki.
 */

export type WallClock = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
};

const partsFormatter = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatter.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatter.set(timeZone, formatter);
  }
  return formatter;
}

/** Przesunięcie strefy względem UTC (w ms) obowiązujące w danym instancie. */
export function getTimeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = getFormatter(timeZone).formatToParts(instant);
  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  const asIfUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour % 24,
    values.minute,
    values.second,
  );
  return asIfUtc - instant.getTime();
}

/**
 * Czas ścienny w danej strefie → instant UTC.
 *
 * Druga iteracja obsługuje przejścia DST: pierwsze przybliżenie offsetu może
 * pochodzić sprzed zmiany czasu.
 */
export function zonedTimeToUtc(wall: WallClock, timeZone: string): Date {
  const naive = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
  );
  const firstOffset = getTimeZoneOffsetMs(new Date(naive), timeZone);
  const firstGuess = new Date(naive - firstOffset);
  const secondOffset = getTimeZoneOffsetMs(firstGuess, timeZone);
  return secondOffset === firstOffset
    ? firstGuess
    : new Date(naive - secondOffset);
}

/** Instant UTC → czas ścienny w danej strefie. */
export function utcToZonedWallClock(
  instant: Date,
  timeZone: string,
): WallClock & { weekday: number } {
  const offset = getTimeZoneOffsetMs(instant, timeZone);
  const shifted = new Date(instant.getTime() + offset);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    // 0 = poniedziałek ... 6 = niedziela (odwrotnie niż getUTCDay)
    weekday: (shifted.getUTCDay() + 6) % 7,
  };
}

/** Minuty od północy czasu lokalnego → instant UTC dla podanego dnia. */
export function localDayMinutesToUtc(
  day: { year: number; month: number; day: number },
  minutesFromMidnight: number,
  timeZone: string,
): Date {
  return zonedTimeToUtc(
    {
      ...day,
      hour: Math.floor(minutesFromMidnight / 60),
      minute: minutesFromMidnight % 60,
    },
    timeZone,
  );
}

export const addMinutes = (date: Date, minutes: number): Date =>
  new Date(date.getTime() + minutes * 60_000);
