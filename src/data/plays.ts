// Saving and loading plays. A play is one summary row plus one detail row of typed-array columns.

import { pbFlags } from '../analytics/bests';
import { allRatings, newTierEvents, recordTierEvents } from '../analytics/ratings';
import { summarizePlay } from '../analytics/summary';
import type { HitRecord, ModeId, PlayResult } from '../shared/types';
import { packRecords, unpackRecords } from './columns';
import { getAll, req, withTx } from './db';
import { applyPlayToProgress } from './progress';
import { DETAIL_VERSION, SUMMARY_VERSION } from './schema';
import type { MetaRow, PlayData, PlayDetail, PlaySummary, ProgressRow, TierHistory } from './schema';
import { getDeviceId, requestPersistence } from './meta';
import type { ModuleId } from '../shared/types';

/** A quit play with fewer judged objects than this isn't saved. */
export const MIN_QUIT_OBJECTS = 20;

export function shouldSave(result: PlayResult): boolean {
  return result.status !== 'quit' || result.records.length >= MIN_QUIT_OBJECTS;
}

/* Older stored shapes are lifted one version at a time. There is only version 1 so far. */
const SUMMARY_UPGRADES: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};
const DETAIL_UPGRADES: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

function lift<T>(raw: unknown, target: number, steps: typeof SUMMARY_UPGRADES, what: string): T {
  if (!raw || typeof raw !== 'object') throw new Error(`A ${what} in the data is not an object.`);
  let cur = raw as Record<string, unknown>;
  let v = typeof cur.v === 'number' ? cur.v : 1;
  while (v < target) {
    const step = steps[v];
    if (!step) throw new Error(`No upgrade from ${what} version ${v}.`);
    cur = { ...step(cur), v: v + 1 };
    v++;
  }
  if (v > target) throw new Error(`This ${what} was written by a newer Flickwise (version ${v}).`);
  return cur as T;
}

export const upgradeSummary = (raw: unknown): PlaySummary => lift<PlaySummary>(raw, SUMMARY_VERSION, SUMMARY_UPGRADES, 'play summary');
export const upgradeDetail = (raw: unknown): PlayDetail => lift<PlayDetail>(raw, DETAIL_VERSION, DETAIL_UPGRADES, 'play detail');

export interface SaveOutcome {
  summary: PlaySummary;
  progress: ProgressRow[];
}

/** Saves a finished play, its detail, module progress and any new tiers in one transaction. */
export async function savePlay(result: PlayResult, now = Date.now()): Promise<SaveOutcome | null> {
  if (!shouldSave(result)) return null;
  const deviceId = await getDeviceId();
  const summary = summarizePlay(result, { deviceId, now });
  const packed = packRecords(result.records);
  let progress: ProgressRow[] = [];
  await withTx(['plays', 'playDetails', 'progress', 'meta'], 'readwrite', async (tx) => {
    const existing = await getAll<PlaySummary>(tx, 'plays');
    const progressRows = await getAll<ProgressRow>(tx, 'progress');
    const tierRow = await req<MetaRow | undefined>(tx.objectStore('meta').get('tiers'));
    const history = (tierRow?.value as TierHistory | undefined) ?? {};

    summary.pb = pbFlags(summary, existing);
    const ratings = allRatings([...existing, summary], now);
    summary.tiers = newTierEvents(history, ratings);

    tx.objectStore('plays').put(summary);
    if (result.records.length > 0) {
      const detail: PlayDetail = { playId: summary.id, v: DETAIL_VERSION, startedAt: summary.startedAt, ...packed };
      tx.objectStore('playDetails').put(detail);
    }
    const byModule: Partial<Record<ModuleId, ProgressRow>> = {};
    for (const r of progressRows) byModule[r.moduleId] = r;
    progress = applyPlayToProgress(byModule, result);
    for (const row of progress) tx.objectStore('progress').put(row);
    if (summary.tiers.length > 0) {
      tx.objectStore('meta').put({ key: 'tiers', value: recordTierEvents(history, summary.tiers, now) } satisfies MetaRow);
    }
  });
  // Best effort. The browser may ignore it.
  requestPersistence(now).catch(() => undefined);
  return { summary, progress };
}

/** Newest first. */
export async function listSummaries(): Promise<PlaySummary[]> {
  const rows = await withTx('plays', 'readonly', (tx) => getAll<PlaySummary>(tx, 'plays', undefined, 'startedAt'));
  return rows.map(upgradeSummary).reverse();
}

/** Plays that started at or after `since`, newest first. */
export async function listSummariesSince(since: number): Promise<PlaySummary[]> {
  const rows = await withTx('plays', 'readonly', (tx) =>
    getAll<PlaySummary>(tx, 'plays', IDBKeyRange.lowerBound(since), 'startedAt'),
  );
  return rows.map(upgradeSummary).reverse();
}

/** Plays of one mode, newest first. */
export async function listSummariesByMode(modeId: ModeId): Promise<PlaySummary[]> {
  const rows = await withTx('plays', 'readonly', (tx) =>
    getAll<PlaySummary>(tx, 'plays', IDBKeyRange.bound([modeId, 0], [modeId, Infinity]), 'mode_startedAt'),
  );
  return rows.map(upgradeSummary).reverse();
}

export async function getSummary(id: string): Promise<PlaySummary | undefined> {
  const row = await withTx('plays', 'readonly', (tx) => req<PlaySummary | undefined>(tx.objectStore('plays').get(id)));
  return row ? upgradeSummary(row) : undefined;
}

export async function getDetail(id: string): Promise<PlayDetail | undefined> {
  const row = await withTx('playDetails', 'readonly', (tx) => req<PlayDetail | undefined>(tx.objectStore('playDetails').get(id)));
  return row ? upgradeDetail(row) : undefined;
}

export async function getRecords(id: string): Promise<HitRecord[] | null> {
  const detail = await getDetail(id);
  return detail ? unpackRecords(detail) : null;
}

/** Summaries with their records. Plays whose detail was removed come back with no records. */
export async function loadPlayData(summaries: readonly PlaySummary[]): Promise<PlayData[]> {
  const details = await withTx('playDetails', 'readonly', async (tx) => {
    const store = tx.objectStore('playDetails');
    return Promise.all(summaries.map((s) => (s.hasDetail ? req<PlayDetail | undefined>(store.get(s.id)) : Promise.resolve(undefined))));
  });
  return summaries.map((summary, i) => {
    const d = details[i];
    return { summary, records: d ? unpackRecords(upgradeDetail(d)) : [] };
  });
}

export async function deletePlay(id: string, now = Date.now()): Promise<void> {
  await withTx(['plays', 'playDetails', 'tombstones'], 'readwrite', (tx) => {
    tx.objectStore('plays').delete(id);
    tx.objectStore('playDetails').delete(id);
    tx.objectStore('tombstones').put({ id, deletedAt: now });
  });
}

/**
 * Removes plays, progress, drills and tier history. Settings and the device id stay. Every deleted
 * play leaves a tombstone, so a later sync or an old export can't bring it back.
 */
export async function deleteAllData(now = Date.now()): Promise<void> {
  await withTx(['plays', 'playDetails', 'progress', 'drills', 'tombstones', 'meta'], 'readwrite', async (tx) => {
    const ids = await req(tx.objectStore('plays').getAllKeys());
    for (const id of ids) tx.objectStore('tombstones').put({ id: String(id), deletedAt: now });
    for (const name of ['plays', 'playDetails', 'progress', 'drills'] as const) tx.objectStore(name).clear();
    tx.objectStore('meta').delete('tiers');
    tx.objectStore('meta').delete('lastExport');
  });
}

export async function countPlays(): Promise<number> {
  return withTx('plays', 'readonly', (tx) => req(tx.objectStore('plays').count()));
}
