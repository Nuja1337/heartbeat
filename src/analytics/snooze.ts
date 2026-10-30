// Snoozing an insight. `snoozeUntil(days)` returns the "hidden until" time to store under the insight key, and
// `isSnoozed` reads the stored map. The write is `snoozeInsight(key, until)` in data/meta, because analytics does not
// import the data layer. Pass the stored map to `detectInsights(plays, now, { snoozed })` to drop snoozed insights.

import type { InsightSnooze } from '../data/schema';

export const DEFAULT_SNOOZE_DAYS = 7;
const DAY = 86_400_000;

/** When a snooze that starts now ends, in epoch ms. 7 days by default. */
export const snoozeUntil = (days = DEFAULT_SNOOZE_DAYS, now = Date.now()): number => now + days * DAY;

/** True while the key is hidden. */
export const isSnoozed = (snoozed: InsightSnooze, key: string, now: number): boolean => (snoozed[key] ?? 0) > now;
