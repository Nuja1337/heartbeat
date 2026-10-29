// Removes per-object detail older than the retention setting. Play summaries stay, so trends,
// ratings and bests keep their history.

import { req, withTx } from './db';
import type { PlaySummary } from './schema';
import { loadSettings } from './settings';

const DAY = 86_400_000;

/** Returns how many detail rows were removed. `days` null keeps everything. */
export async function runRetention(now = Date.now(), days?: number | null): Promise<number> {
  const keepDays = days === undefined ? (await loadSettings()).data.detailRetentionDays : days;
  if (keepDays === null) return 0;
  const cutoff = now - keepDays * DAY;
  return withTx(['plays', 'playDetails'], 'readwrite', async (tx) => {
    const details = tx.objectStore('playDetails');
    const plays = tx.objectStore('plays');
    const old = await req(details.index('startedAt').getAllKeys(IDBKeyRange.upperBound(cutoff, true)));
    for (const id of old) {
      details.delete(id);
      const summary = await req<PlaySummary | undefined>(plays.get(id));
      if (summary) plays.put({ ...summary, hasDetail: false });
    }
    return old.length;
  });
}

/** Runs retention once the browser is idle after start-up. */
export function scheduleRetention(onDone?: (removed: number) => void): void {
  const run = () => {
    runRetention()
      .then((n) => onDone?.(n))
      .catch(() => undefined);
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 10_000 });
  else setTimeout(run, 3000);
}
