// Replay storage. Metadata lives in `replays` and the gzip bytes in `replayBytes`, so lists, retention and
// storage totals never load the bytes.

import { decodeReplay, encodeReplay, isTightBuffer, ReplayFormatError } from '../shared/replay';
import type { ReplayData } from '../shared/types';
import { getAll, req, withTx } from './db';
import { gunzipBytes, gzipBytes } from './gzip';
import type { PlaySummary, ReplayBytesRow, ReplayRow } from './schema';
import { loadSettings } from './settings';

export { ReplayFormatError };

/** A replay encoded and gzipped, ready to be written. */
export interface PreparedReplay {
  bytes: Uint8Array;
  rawBytes: number;
  events: number;
  engineVersion: number;
}

/** Encodes and gzips a replay. Returns null when that fails, so the play can be saved without it. */
export async function prepareReplay(data: ReplayData | undefined): Promise<PreparedReplay | null> {
  if (!data) return null;
  try {
    const raw = encodeReplay(data);
    const gz = await gzipBytes(raw);
    // Structured clone copies the whole buffer of a view, so the stored array must cover all of it.
    const bytes = isTightBuffer(gz) ? gz : gz.slice();
    return { bytes, rawBytes: raw.byteLength, events: data.trace.count, engineVersion: data.engineVersion };
  } catch {
    return null;
  }
}

export function makeReplayRows(playId: string, startedAt: number, keep: boolean, p: PreparedReplay): { row: ReplayRow; bytes: ReplayBytesRow } {
  return {
    row: {
      playId, v: 1, startedAt, keep: keep ? 1 : 0, size: p.bytes.byteLength, rawBytes: p.rawBytes, events: p.events, engineVersion: p.engineVersion,
    },
    bytes: { playId, bytes: p.bytes },
  };
}

/** Metadata only. */
export async function getReplayRow(playId: string): Promise<ReplayRow | undefined> {
  return withTx('replays', 'readonly', (tx) => req<ReplayRow | undefined>(tx.objectStore('replays').get(playId)));
}

/**
 * The decoded replay, or null when the play has none. Throws ReplayFormatError when the bytes are damaged
 * or were made by a newer Flickwise.
 */
export async function getReplay(playId: string): Promise<ReplayData | null> {
  const stored = await withTx(['replays', 'replayBytes'], 'readonly', async (tx) => {
    const [row, bytes] = await Promise.all([
      req<ReplayRow | undefined>(tx.objectStore('replays').get(playId)),
      req<ReplayBytesRow | undefined>(tx.objectStore('replayBytes').get(playId)),
    ]);
    return row && bytes ? bytes : null;
  });
  if (!stored) return null;
  let raw: Uint8Array;
  try {
    raw = await gunzipBytes(stored.bytes);
  } catch {
    throw new ReplayFormatError('damaged');
  }
  return decodeReplay(raw);
}

/** Kept replays are never removed by retention. Does nothing when the play has no replay. */
export async function setReplayKeep(playId: string, keep: boolean): Promise<void> {
  await withTx('replays', 'readwrite', async (tx) => {
    const store = tx.objectStore('replays');
    const row = await req<ReplayRow | undefined>(store.get(playId));
    if (row) store.put({ ...row, keep: keep ? 1 : 0 } satisfies ReplayRow);
  });
}

/** Count and total gzip bytes of all stored replays, from metadata only. */
export async function replayStorage(): Promise<{ count: number; bytes: number }> {
  const rows = await withTx('replays', 'readonly', (tx) => getAll<ReplayRow>(tx, 'replays'));
  return { count: rows.length, bytes: rows.reduce((sum, r) => sum + (Number.isFinite(r.size) ? r.size : 0), 0) };
}

/** How many replays runReplayRetention(limit) would remove right now. Reads metadata only. */
export async function countReplayRemovals(limit: number | null): Promise<number> {
  if (limit === null) return 0;
  const loose = await withTx('replays', 'readonly', (tx) =>
    req<number>(tx.objectStore('replays').index('keep_startedAt').count(IDBKeyRange.bound([0, -Infinity], [0, Infinity]))),
  );
  return Math.max(0, loose - Math.max(0, Math.floor(limit)));
}

/**
 * Keeps every replay with keep = 1 plus the newest `limit` of the others. The rest are deleted from both
 * stores and their summaries get hasReplay false. `limit` null keeps everything. Returns how many were removed.
 */
export async function runReplayRetention(limit: number | null): Promise<number> {
  if (limit === null) return 0;
  const max = Math.max(0, Math.floor(limit));
  return withTx(['replays', 'replayBytes', 'plays'], 'readwrite', async (tx) => {
    const replays = tx.objectStore('replays');
    // Oldest first.
    const loose = await req<ReplayRow[]>(replays.index('keep_startedAt').getAll(IDBKeyRange.bound([0, -Infinity], [0, Infinity])));
    const drop = loose.slice(0, Math.max(0, loose.length - max));
    const plays = tx.objectStore('plays');
    for (const row of drop) {
      replays.delete(row.playId);
      tx.objectStore('replayBytes').delete(row.playId);
      const summary = await req<PlaySummary | undefined>(plays.get(row.playId));
      if (summary) plays.put({ ...summary, hasReplay: false });
    }
    return drop.length;
  });
}

/** Runs retention with the replay limit from the settings. Never throws. */
export async function applyReplayRetention(): Promise<number> {
  try {
    return await runReplayRetention((await loadSettings()).data.replayLimit);
  } catch {
    return 0;
  }
}

/** Runs replay retention once the browser is idle after start-up. */
export function scheduleReplayRetention(onDone?: (removed: number) => void): void {
  const run = () => {
    applyReplayRetention().then((n) => onDone?.(n));
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 10_000 });
  else setTimeout(run, 3000);
}
