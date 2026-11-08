// Saving and loading plays. A play is one summary row plus one detail row of typed-array columns.

import { pbFlags } from '../analytics/bests';
import { msg, t } from '../shared/i18n';
import { newMilestones, recordMilestones } from '../analytics/milestones';
import { allRatings, newTierEvents, recordTierEvents } from '../analytics/ratings';
import { summarizePlay } from '../analytics/summary';
import type { HitRecord, ModeId, PlayResult } from '../shared/types';
import { packRecords, unpackRecords } from './columns';
import { getAll, req, withTx } from './db';
import { applyReplayRetention, makeReplayRows, prepareReplay } from './replays';
import { applyPlayToProgress } from './progress';
import { DETAIL_VERSION, SUMMARY_VERSION } from './schema';
import type { MetaRow, PlayData, PlayDetail, PlaySummary, ProgressRow, TierHistory } from './schema';
import { cleanMilestones, getDeviceId, planKeyRange, requestPersistence } from './meta';
import type { ModuleId } from '../shared/types';

/** A quit play with fewer judged objects than this isn't saved. */
export const MIN_QUIT_OBJECTS = 20;

export function shouldSave(result: PlayResult): boolean {
  return result.status !== 'quit' || result.records.length >= MIN_QUIT_OBJECTS;
}

/* Older stored shapes are lifted one version at a time. Stored rows are never rewritten by the lift. */
export const SUMMARY_UPGRADES: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  1: (raw) => ({
    ...raw,
    hasReplay: false,
    sections: null,
    movement: null,
    throughput: null,
    scoringVersion: 1,
    milestones: [],
  }),
};
const DETAIL_UPGRADES: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

function lift<T>(raw: unknown, target: number, steps: typeof SUMMARY_UPGRADES, what: string): T {
  if (!raw || typeof raw !== 'object') throw new Error(t('A {what} in the data is not an object.', { what: t(what) }));
  let cur = raw as Record<string, unknown>;
  let v = typeof cur.v === 'number' ? cur.v : 1;
  while (v < target) {
    const step = steps[v];
    if (!step) throw new Error(t('No upgrade from {what} version {version}.', { what: t(what), version: v }));
    cur = { ...step(cur), v: v + 1 };
    v++;
  }
  if (v > target) throw new Error(t('This {what} was written by a newer Heartbeat (version {version}).', { what: t(what), version: v }));
  return cur as T;
}

export const upgradeSummary = (raw: unknown): PlaySummary => lift<PlaySummary>(raw, SUMMARY_VERSION, SUMMARY_UPGRADES, msg('play summary'));
export const upgradeDetail = (raw: unknown): PlayDetail => lift<PlayDetail>(raw, DETAIL_VERSION, DETAIL_UPGRADES, msg('play detail'));

export interface SaveOutcome {
  summary: PlaySummary;
  progress: ProgressRow[];
}

/** Lifts stored summaries. A row that can't be lifted (a newer version) is left out of the comparisons. */
function liftAll(rows: unknown[]): PlaySummary[] {
  const out: PlaySummary[] = [];
  for (const row of rows) {
    try {
      out.push(upgradeSummary(row));
    } catch {
      // Not comparable. It stays in the database untouched.
    }
  }
  return out;
}

/**
 * Saves a finished play, its detail, module progress, any new tiers and any new milestones. The replay is encoded and gzipped
 * first, because awaiting other work inside a transaction would commit it early. Transaction A writes the play.
 * Transaction B writes the replay once A has committed, and a failure there leaves the play saved.
 */
export async function savePlay(result: PlayResult, now = Date.now()): Promise<SaveOutcome | null> {
  if (!shouldSave(result)) return null;
  const deviceId = await getDeviceId();
  const summary = summarizePlay(result, { deviceId, now });
  const packed = packRecords(result.records);
  const prepared = await prepareReplay(result.replay);
  let progress: ProgressRow[] = [];
  await withTx(['plays', 'playDetails', 'progress', 'meta'], 'readwrite', async (tx) => {
    const existing = liftAll(await getAll<unknown>(tx, 'plays'));
    const progressRows = await getAll<ProgressRow>(tx, 'progress');
    const tierRow = await req<MetaRow | undefined>(tx.objectStore('meta').get('tiers'));
    const history = (tierRow?.value as TierHistory | undefined) ?? {};

    summary.pb = pbFlags(summary, existing);
    const ratings = allRatings([...existing, summary], now);
    summary.tiers = newTierEvents(history, ratings);
    const milestoneRow = await req<MetaRow | undefined>(tx.objectStore('meta').get('milestones'));
    const milestones = cleanMilestones(milestoneRow?.value);
    summary.milestones = newMilestones(milestones, summary, [...existing, summary]);

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
    if (summary.milestones.length > 0) {
      tx.objectStore('meta').put({
        key: 'milestones',
        value: recordMilestones(milestones, summary.milestones, now, summary.id),
      } satisfies MetaRow);
    }
  });
  if (prepared) {
    try {
      const keep = summary.pb.score === true || summary.pb.level === true;
      const rows = makeReplayRows(summary.id, summary.startedAt, keep, prepared);
      const withReplay: PlaySummary = { ...summary, hasReplay: true };
      await withTx(['replays', 'replayBytes', 'plays'], 'readwrite', (tx) => {
        tx.objectStore('replays').put(rows.row);
        tx.objectStore('replayBytes').put(rows.bytes);
        tx.objectStore('plays').put(withReplay);
      });
      summary.hasReplay = true;
      await applyReplayRetention();
    } catch {
      // The play is saved. Only its replay is lost.
    }
  }
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
  const rows = await withTx('plays', 'readonly', (tx) => getAll<PlaySummary>(tx, 'plays', IDBKeyRange.lowerBound(since), 'startedAt'));
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
  await withTx(['plays', 'playDetails', 'tombstones', 'replays', 'replayBytes'], 'readwrite', (tx) => {
    tx.objectStore('plays').delete(id);
    tx.objectStore('playDetails').delete(id);
    tx.objectStore('replays').delete(id);
    tx.objectStore('replayBytes').delete(id);
    tx.objectStore('tombstones').put({ id, deletedAt: now });
  });
}

/**
 * Removes plays, replays, progress, drills, tier history, milestones, insight snoozes and daily plans.
 * Settings, the device id and the onboarding state stay. Every deleted
 * play leaves a tombstone, so a later sync or an old export can't bring it back.
 */
export async function deleteAllData(now = Date.now()): Promise<void> {
  await withTx(['plays', 'playDetails', 'progress', 'drills', 'tombstones', 'meta', 'replays', 'replayBytes'], 'readwrite', async (tx) => {
    const ids = await req(tx.objectStore('plays').getAllKeys());
    for (const id of ids) tx.objectStore('tombstones').put({ id: String(id), deletedAt: now });
    for (const name of ['plays', 'playDetails', 'progress', 'drills', 'replays', 'replayBytes'] as const) tx.objectStore(name).clear();
    const meta = tx.objectStore('meta');
    for (const key of ['tiers', 'lastExport', 'milestones', 'insightSnooze']) meta.delete(key);
    for (const key of await req(meta.getAllKeys(planKeyRange()))) meta.delete(key);
  });
}

export async function countPlays(): Promise<number> {
  return withTx('plays', 'readonly', (tx) => req(tx.objectStore('plays').count()));
}
