// Local calendar helpers. They return day numbers (whole local days since 1970-01-01), local midnights and
// Monday-based weekdays, and they stay correct across daylight saving changes and month ends.

const DAY = 86_400_000;

/** The local calendar day of an epoch time, as a whole number. Consecutive days differ by exactly 1. */
export function localDayNumber(t: number): number {
  const d = new Date(t);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

/** Local midnight at the start of a day number. */
export function dayNumberStart(day: number): number {
  const u = new Date(day * DAY);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()).getTime();
}

/** YYYY-MM-DD of a day number. */
export function dayNumberKey(day: number): string {
  const u = new Date(day * DAY);
  const pad = (n: number, w: number): string => String(n).padStart(w, '0');
  return `${pad(u.getUTCFullYear(), 4)}-${pad(u.getUTCMonth() + 1, 2)}-${pad(u.getUTCDate(), 2)}`;
}

/** The day number of a YYYY-MM-DD key, or null when the key is not a real date. */
export function keyDayNumber(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const day = Math.round(ms / DAY);
  return dayNumberKey(day) === key ? day : null;
}

/** 0 for Monday up to 6 for Sunday. 1970-01-01 was a Thursday. */
export const weekdayOf = (day: number): number => (((day + 3) % 7) + 7) % 7;

/** The Monday of the week that holds `day`. */
export const mondayOf = (day: number): number => day - weekdayOf(day);

/** Consecutive days ending at `end` that are all in `days`. */
export function runEndingAt(days: ReadonlySet<number>, end: number): number {
  let n = 0;
  while (days.has(end - n)) n++;
  return n;
}

/** The longest run of consecutive days in the set. */
export function longestRun(days: ReadonlySet<number>): number {
  let best = 0;
  for (const d of days) {
    if (days.has(d - 1)) continue;
    let n = 1;
    while (days.has(d + n)) n++;
    best = Math.max(best, n);
  }
  return best;
}
