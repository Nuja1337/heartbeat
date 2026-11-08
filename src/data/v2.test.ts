// 2.0 data layer: replays, retention, deletes, settings, meta helpers, export v2, blocked opens.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pbFlags } from '../analytics/bests';
import { makeFixture } from '../analytics/fixtures';
import { summarizePlay } from '../analytics/summary';
import { DEFAULT_SETTINGS, REPLAY_LIMIT_CHOICES, SCORING_VERSION, SETTING_RANGES } from '../shared/catalog';
import { decodeReplay, encodeReplay, isTightBuffer, ReplayFormatError } from '../shared/replay';
import type { PlayResult } from '../shared/types';
import { OBJECT_COLUMNS, PATTERNS, packRecords, tableToJson, unpackRecords } from './columns';
import { DB_BLOCKED_MESSAGE, DB_NEWER_MESSAGE, DB_VERSION, DbNewerError, deleteDatabase, onDbBlocked, openDb, req, withTx } from './db';
import { buildExport, ImportError, importExport } from './exportImport';
import type { ExportFile } from './exportImport';
import { makeReplayData } from './fixtures/replayData';
import { openV1 } from './fixtures/v1Migration';
import { base64ToBytes, bytesToBase64, gzipBytes } from './gzip';
import {
  getInsightSnooze,
  getMeta,
  getMilestones,
  getOnboarding,
  getPlan,
  getTierHistory,
  loadUiPrefs,
  mergeMilestones,
  planKey,
  prunePlans,
  savePlan,
  saveUiPrefs,
  setMeta,
  setMilestones,
  setOnboarding,
  snoozeInsight,
} from './meta';
import { countPlays, deleteAllData, deletePlay, getSummary, listSummaries, savePlay, upgradeSummary } from './plays';
import { countReplayRemovals, getReplay, getReplayRow, replayStorage, runReplayRetention, setReplayKeep } from './replays';
import type { DailyPlan, PlaySummary } from './schema';
import { sanitizeSettings, saveSettings } from './settings';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

/** savePlay asks for persistent storage in the background. Wait for that, so it can't reopen a deleted database. */
const settle = () => vi.waitFor(async () => expect(await getMeta('persist')).toBeDefined());

beforeEach(async () => {
  await deleteDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function count(store: 'replays' | 'replayBytes' | 'plays'): Promise<number> {
  return withTx(store, 'readonly', (tx) => req(tx.objectStore(store).count()));
}

function playWithReplay(seed: number, o: { score?: number; startedAt?: number } = {}): PlayResult {
  const fx = makeFixture({ seed, objects: 40, presetLevel: 3, lengthSec: 45, startedAt: o.startedAt ?? NOW - 1000 });
  return { ...fx.result, score: o.score ?? fx.result.score, replay: makeReplayData({ seed }) };
}

describe('summary v2', () => {
  it('emits the placeholder fields', () => {
    const s = summarizePlay(makeFixture({ seed: 1, objects: 30 }).result);
    expect(s.v).toBe(2);
    expect(s).toMatchObject({
      hasReplay: false,
      sections: null,
      movement: null,
      throughput: null,
      milestones: [],
      scoringVersion: SCORING_VERSION,
    });
  });

  it('lifts a 1.0 summary and refuses a newer one', () => {
    const v1 = { ...summarizePlay(makeFixture({ seed: 1, objects: 30 }).result), v: 1 } as Record<string, unknown>;
    for (const k of ['hasReplay', 'sections', 'movement', 'throughput', 'scoringVersion', 'milestones']) delete v1[k];
    const up = upgradeSummary(v1);
    expect(up).toMatchObject({
      v: 2,
      hasReplay: false,
      sections: null,
      movement: null,
      throughput: null,
      scoringVersion: 1,
      milestones: [],
    });
    expect(() => upgradeSummary({ ...up, v: 3 })).toThrow(/newer/);
  });

  it('compares a summary without scoringVersion as version 1', () => {
    const base = summarizePlay(makeFixture({ seed: 2, objects: 30, presetLevel: 3, lengthSec: 45 }).result);
    const old = { ...base, scoringVersion: undefined } as unknown as PlaySummary;
    const play = { ...base, score: base.score + 10, engineVersion: 7 };
    expect(pbFlags(play, [old]).score).toBe(true);
    expect(pbFlags({ ...play, scoringVersion: 2 }, [old])).toEqual({});
  });
});

describe('columns', () => {
  it('stores the new movement fields and reads old details without them', () => {
    const { records } = makeFixture({ seed: 4, objects: 20 });
    records[3]!.movement = {
      ...records[3]!.movement,
      leaveMs: 120,
      primaryAlong: -0.5,
      primaryLateral: 0.25,
      primaryEndMs: -40,
      correctionPath: 1.5,
    };
    const packed = packRecords(records);
    const back = unpackRecords(packed);
    expect(back[3]!.movement).toMatchObject({
      leaveMs: 120,
      primaryAlong: -0.5,
      primaryLateral: 0.25,
      primaryEndMs: -40,
      correctionPath: 1.5,
    });
    expect(back[4]!.movement).toMatchObject({
      leaveMs: null,
      primaryAlong: null,
      primaryLateral: null,
      primaryEndMs: null,
      correctionPath: null,
    });

    for (const name of ['leaveMs', 'primaryAlong', 'primaryLateral', 'primaryEndMs', 'correctionPath']) {
      expect(OBJECT_COLUMNS[name as 'leaveMs']).toBe('f32');
      delete packed.objects.columns[name];
    }
    const old = unpackRecords(packed);
    expect(old).toHaveLength(20);
    expect(old[3]!.movement.leaveMs).toBeNull();
    // They survive the JSON form too.
    const json = JSON.parse(JSON.stringify(tableToJson(packRecords(records).objects)));
    expect(json.columns.correctionPath[3]).toBe(1.5);
  });

  it('appends the new patterns without moving the old ones', () => {
    expect(PATTERNS.slice(0, 12)).toEqual([
      'single',
      'jump',
      'backforth',
      'triangle',
      'square',
      'star',
      'flow',
      'stream',
      'burst',
      'doubles',
      'slider',
      'spinner',
    ]);
    expect(PATTERNS.slice(12)).toEqual(['stack', 'cutstream', 'spacedstream', 'polygon']);
    const { records } = makeFixture({ seed: 4, objects: 10 });
    records[0]!.pattern = 'polygon';
    expect(unpackRecords(packRecords(records))[0]!.pattern).toBe('polygon');
  });
});

describe('savePlay with a replay', () => {
  it('writes a gzip row, sets hasReplay, and getReplay returns an equal object', async () => {
    const data = makeReplayData({ seed: 5 });
    const fx = makeFixture({ seed: 5, objects: 40, presetLevel: 3, lengthSec: 45, startedAt: NOW - 1000 });
    const saved = await savePlay({ ...fx.result, replay: data }, NOW);
    expect(saved!.summary.hasReplay).toBe(true);
    expect((await getSummary(saved!.summary.id))!.hasReplay).toBe(true);

    const row = await getReplayRow(saved!.summary.id);
    expect(row).toMatchObject({
      playId: saved!.summary.id,
      v: 1,
      startedAt: saved!.summary.startedAt,
      keep: 0,
      events: data.trace.count,
      engineVersion: 2,
    });
    expect(row!.rawBytes).toBe(encodeReplay(data).byteLength);
    const bytes = await withTx('replayBytes', 'readonly', (tx) => req(tx.objectStore('replayBytes').get(saved!.summary.id)));
    expect(bytes.bytes[0]).toBe(0x1f);
    expect(bytes.bytes[1]).toBe(0x8b);
    expect(row!.size).toBe(bytes.bytes.byteLength);

    expect(await getReplay(saved!.summary.id)).toEqual(decodeReplay(encodeReplay(data)));
    expect(await getReplay('nope')).toBeNull();
    expect(await replayStorage()).toEqual({ count: 1, bytes: row!.size });
    await settle();
  });

  it('keeps the replay of a personal best', async () => {
    const first = await savePlay(playWithReplay(1, { score: 1000, startedAt: NOW - 3000 }), NOW);
    const better = await savePlay(playWithReplay(2, { score: 2000, startedAt: NOW - 2000 }), NOW);
    const worse = await savePlay(playWithReplay(3, { score: 500, startedAt: NOW - 1000 }), NOW);
    expect(better!.summary.pb.score).toBe(true);
    expect((await getReplayRow(first!.summary.id))!.keep).toBe(0);
    expect((await getReplayRow(better!.summary.id))!.keep).toBe(1);
    expect((await getReplayRow(worse!.summary.id))!.keep).toBe(0);
    await settle();
  });

  it('stores a tight array', async () => {
    const seen: { store: string; value: unknown }[] = [];
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      seen.push({ store: this.name, value });
      return put.call(this, value, key);
    });
    await savePlay(playWithReplay(6), NOW);
    const stored = seen.find((s) => s.store === 'replayBytes')!.value as { bytes: Uint8Array };
    expect(isTightBuffer(stored.bytes)).toBe(true);
    await settle();
  });

  it('saves the play without a replay when encoding fails', async () => {
    const data = makeReplayData();
    data.trace.t[1] = 1000.3; // off the 1/64 ms grid
    const saved = await savePlay({ ...makeFixture({ seed: 7, objects: 40 }).result, replay: data }, NOW);
    expect(saved!.summary.hasReplay).toBe(false);
    expect(await countPlays()).toBe(1);
    expect(await count('replays')).toBe(0);
    await settle();
  });

  it('keeps the play when writing the replay fails', async () => {
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === 'replayBytes') throw new Error('disk full');
      return put.call(this, value, key);
    });
    const saved = await savePlay(playWithReplay(8), NOW);
    expect(saved).not.toBeNull();
    expect(saved!.summary.hasReplay).toBe(false);
    const stored = await getSummary(saved!.summary.id);
    expect(stored).toMatchObject({ hasReplay: false, hasDetail: true });
    // The aborted transaction left no half-written replay behind.
    expect(await count('replays')).toBe(0);
    expect(await count('replayBytes')).toBe(0);
    await settle();
  });

  it('passes a damaged replay through as a ReplayFormatError', async () => {
    const saved = await savePlay(playWithReplay(9), NOW);
    await withTx('replayBytes', 'readwrite', (tx) => {
      tx.objectStore('replayBytes').put({ playId: saved!.summary.id, bytes: new Uint8Array([1, 2, 3]) });
    });
    await expect(getReplay(saved!.summary.id)).rejects.toBeInstanceOf(ReplayFormatError);
    // Valid gzip around a bad container.
    const bad = await gzipBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]));
    await withTx('replayBytes', 'readwrite', (tx) => {
      tx.objectStore('replayBytes').put({ playId: saved!.summary.id, bytes: bad });
    });
    await expect(getReplay(saved!.summary.id)).rejects.toMatchObject({ kind: 'damaged' });
    await settle();
  });
});

describe('replay retention', () => {
  async function saveFive() {
    const ids: string[] = [];
    // Falling scores, so none of them is a personal best.
    for (let i = 0; i < 5; i++) {
      const saved = await savePlay(playWithReplay(20 + i, { score: 5000 - i * 100, startedAt: NOW - (5 - i) * 1000 }), NOW);
      ids.push(saved!.summary.id);
    }
    return ids; // oldest first
  }

  it('keeps the newest 2 and the kept one', async () => {
    const ids = await saveFive();
    expect(await count('replays')).toBe(5);
    await setReplayKeep(ids[0]!, true);
    expect((await getReplayRow(ids[0]!))!.keep).toBe(1);

    expect(await runReplayRetention(2)).toBe(2);
    const left = (await Promise.all(ids.map(async (id) => ((await getReplayRow(id)) ? id : null)))).filter(Boolean);
    expect(left).toEqual([ids[0], ids[3], ids[4]]);
    expect(await count('replays')).toBe(3);
    expect(await count('replayBytes')).toBe(3);
    expect(await getReplay(ids[1]!)).toBeNull();
    expect(await getReplay(ids[4]!)).not.toBeNull();

    const flags = await Promise.all(ids.map(async (id) => (await getSummary(id))!.hasReplay));
    expect(flags).toEqual([true, false, false, true, true]);
    // The plays themselves stay.
    expect(await countPlays()).toBe(5);
    expect(await runReplayRetention(2)).toBe(0);
    expect(await runReplayRetention(null)).toBe(0);
    await settle();
  });

  it('counts what a lower limit would remove, without removing it', async () => {
    const ids = await saveFive();
    await setReplayKeep(ids[0]!, true);
    expect(await countReplayRemovals(null)).toBe(0);
    expect(await countReplayRemovals(100)).toBe(0);
    expect(await countReplayRemovals(2)).toBe(2);
    expect(await countReplayRemovals(0)).toBe(4);
    expect(await count('replays')).toBe(5);
    expect(await countReplayRemovals(2)).toBe(await runReplayRetention(2));
    await settle();
  });

  it('runs after a save, with the limit from the settings', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, data: { ...DEFAULT_SETTINGS.data, replayLimit: 25 } });
    for (let i = 0; i < 27; i++) await savePlay(playWithReplay(100 + i, { score: 9000 - i, startedAt: NOW - (27 - i) * 1000 }), NOW);
    expect(await count('replays')).toBe(25);
    expect(await count('replayBytes')).toBe(25);
    await settle();
  });
});

describe('deletes', () => {
  it('deletePlay removes the replay from both stores', async () => {
    const saved = await savePlay(playWithReplay(30), NOW);
    await deletePlay(saved!.summary.id, NOW);
    expect(await count('replays')).toBe(0);
    expect(await count('replayBytes')).toBe(0);
    await settle();
  });

  it('deleteAllData clears replays, milestones, snoozes and plans, and keeps onboarding', async () => {
    await savePlay(playWithReplay(31), NOW);
    await setMilestones({ 'first-play': { at: NOW, playId: null } });
    await snoozeInsight('long-undershoot', NOW + DAY, NOW);
    await savePlan({ date: '2026-10-01', createdAt: NOW, steps: [] });
    await savePlan({ date: '2026-10-02', createdAt: NOW, steps: [] });
    await setOnboarding({ done: true, at: NOW, input: true, calibrated: true, placed: false });
    await settle();

    await deleteAllData(NOW);
    expect(await countPlays()).toBe(0);
    expect(await count('replays')).toBe(0);
    expect(await count('replayBytes')).toBe(0);
    expect(await getMilestones()).toEqual({});
    expect(await getInsightSnooze()).toEqual({});
    expect(await getPlan('2026-10-01')).toBeUndefined();
    expect(await getPlan('2026-10-02')).toBeUndefined();
    expect(await getTierHistory()).toEqual({});
    expect(await getOnboarding()).toEqual({ done: true, at: NOW, input: true, calibrated: true, placed: false });
    expect(await getMeta('deviceId')).toBeDefined();
  });
});

describe('settings', () => {
  it('accepts every valid new value', () => {
    const s = sanitizeSettings({
      input: { retryKey: 'KeyR', keys: ['KeyA', 'KeyS'] },
      audio: { soundSet: 'wood', metronome: 'bar', metronomeVolume: 0.25, offsetMs: 120 },
      display: { visualOffsetMs: -20, frameGraph: true },
      skin: { palette: 'contrast', cursorStyle: 'dot', approach: 'brackets', fieldGrid: false, clickRipple: false },
      goals: { weeklyMinutes: 150 },
      data: { replayLimit: null },
    });
    expect(s.input.retryKey).toBe('KeyR');
    expect(s.audio).toMatchObject({ soundSet: 'wood', metronome: 'bar', metronomeVolume: 0.25, offsetMs: 120 });
    expect(s.display).toMatchObject({ visualOffsetMs: -20, frameGraph: true });
    expect(s.skin).toEqual({ palette: 'contrast', cursorStyle: 'dot', approach: 'brackets', fieldGrid: false, clickRipple: false });
    expect(s.goals.weeklyMinutes).toBe(150);
    expect(s.data.replayLimit).toBeNull();
    for (const limit of REPLAY_LIMIT_CHOICES) expect(sanitizeSettings({ data: { replayLimit: limit } }).data.replayLimit).toBe(limit);
  });

  it('replaces invalid values with the defaults', () => {
    const d = DEFAULT_SETTINGS;
    const s = sanitizeSettings({
      audio: { soundSet: 'brass', metronome: 'always', metronomeVolume: 'loud', offsetMs: NaN },
      display: { visualOffsetMs: null, frameGraph: 'yes' },
      skin: { palette: 'neon', cursorStyle: 'star', approach: 7, fieldGrid: 1, clickRipple: null },
      goals: { weeklyMinutes: '60' },
      data: { replayLimit: 40 },
    });
    expect(s.audio).toMatchObject({
      soundSet: d.audio.soundSet,
      metronome: d.audio.metronome,
      metronomeVolume: d.audio.metronomeVolume,
      offsetMs: d.audio.offsetMs,
    });
    expect(s.display.visualOffsetMs).toBe(d.display.visualOffsetMs);
    expect(s.display.frameGraph).toBe(d.display.frameGraph);
    expect(s.skin).toEqual(d.skin);
    expect(s.goals).toEqual(d.goals);
    expect(s.data.replayLimit).toBe(100);
    expect(sanitizeSettings(undefined).data.replayLimit).toBe(100);
    expect(sanitizeSettings({ data: { replayLimit: undefined } }).data.replayLimit).toBe(100);
  });

  it('reads a palette saved under the old name as the default', () => {
    expect(sanitizeSettings({ skin: { palette: 'flickwise' } }).skin.palette).toBe('heartbeat');
  });

  it('clamps numbers to their ranges', () => {
    const r = SETTING_RANGES;
    const high = sanitizeSettings({
      audio: { metronomeVolume: 9, offsetMs: 9999 },
      display: { visualOffsetMs: 999 },
      goals: { weeklyMinutes: 99_999 },
    });
    expect([high.audio.metronomeVolume, high.audio.offsetMs, high.display.visualOffsetMs, high.goals.weeklyMinutes]).toEqual([
      r.metronomeVolume.max,
      r.audioOffsetMs.max,
      r.visualOffsetMs.max,
      r.weeklyMinutes.max,
    ]);
    const low = sanitizeSettings({
      audio: { metronomeVolume: -9, offsetMs: -9999 },
      display: { visualOffsetMs: -999 },
      goals: { weeklyMinutes: -5 },
    });
    expect([low.audio.metronomeVolume, low.audio.offsetMs, low.display.visualOffsetMs, low.goals.weeklyMinutes]).toEqual([
      r.metronomeVolume.min,
      r.audioOffsetMs.min,
      r.visualOffsetMs.min,
      r.weeklyMinutes.min,
    ]);
  });

  it('turns a retry key that clashes with a hit key, Escape or nothing into an empty one', () => {
    expect(sanitizeSettings({ input: { keys: ['KeyA', 'KeyS'], retryKey: 'KeyA' } }).input.retryKey).toBe('');
    expect(sanitizeSettings({ input: { keys: ['KeyA', 'KeyS'], retryKey: 'KeyS' } }).input.retryKey).toBe('');
    expect(sanitizeSettings({ input: { retryKey: 'Escape' } }).input.retryKey).toBe('');
    expect(sanitizeSettings({ input: { retryKey: '' } }).input.retryKey).toBe('');
    expect(sanitizeSettings({ input: { retryKey: 5 } }).input.retryKey).toBe('');
    // A 1.0 profile has no retry key and gets the default, unless the default is one of its hit keys.
    expect(sanitizeSettings({ input: {} }).input.retryKey).toBe(DEFAULT_SETTINGS.input.retryKey);
    expect(sanitizeSettings({ input: { keys: [DEFAULT_SETTINGS.input.retryKey, 'KeyS'] } }).input.retryKey).toBe('');
  });

  it('rounds to the step as a whole count of steps', () => {
    const s = (audio: object, display: object = {}, goals: object = {}) => sanitizeSettings({ audio, display, goals });
    expect(s({ metronomeVolume: 0.15 }).audio.metronomeVolume).toBe(0.15);
    expect(s({ metronomeVolume: 0.149 }).audio.metronomeVolume).toBe(0.15);
    expect(s({ metronomeVolume: 0.1 + 0.2 }).audio.metronomeVolume).toBe(0.3);
    expect(s({ metronomeVolume: 0.35 }).audio.metronomeVolume).toBe(0.35);
    expect(s({ metronomeVolume: 0.7 }).audio.metronomeVolume).toBe(0.7);
    expect(s({ metronomeVolume: 0.95 }).audio.metronomeVolume).toBe(0.95);
    expect(s({ offsetMs: 12.6 }).audio.offsetMs).toBe(13);
    expect(s({ offsetMs: -0.4 }).audio.offsetMs).toBe(0);
    expect(Object.is(s({ offsetMs: -0.4 }).audio.offsetMs, -0)).toBe(false);
    expect(s({}, { visualOffsetMs: 33.2 }).display.visualOffsetMs).toBe(33);
    expect(s({}, {}, { weeklyMinutes: 62 }).goals.weeklyMinutes).toBe(60);
    expect(s({}, {}, { weeklyMinutes: 68 }).goals.weeklyMinutes).toBe(75);
    expect(s({}, {}, { weeklyMinutes: 7 }).goals.weeklyMinutes).toBe(0);
  });
});

describe('meta helpers', () => {
  it('merges milestones keeping the earliest time', () => {
    const a = { 'first-play': { at: 500, playId: 'a' }, 'plays-50': { at: 900, playId: null } } as const;
    const b = { 'first-play': { at: 300, playId: 'b' }, 'streak-7': { at: 100, playId: null } } as const;
    expect(mergeMilestones({ ...a }, { ...b })).toEqual({
      'first-play': { at: 300, playId: 'b' },
      'plays-50': { at: 900, playId: null },
      'streak-7': { at: 100, playId: null },
    });
  });

  it('prunes plans older than 14 days and keeps the rest', async () => {
    const day = (offset: number) => {
      const d = new Date(NOW - offset * DAY);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const plan = (date: string): DailyPlan => ({ date, createdAt: NOW, steps: [] });
    for (const offset of [0, 1, 14, 15, 40]) await savePlan(plan(day(offset)));
    await setMeta('plansNote', 'not a plan');
    expect(await prunePlans(NOW)).toBe(2);
    expect(await getPlan(day(0))).toEqual(plan(day(0)));
    expect(await getPlan(day(14))).toBeDefined();
    expect(await getPlan(day(15))).toBeUndefined();
    expect(await getPlan(day(40))).toBeUndefined();
    expect(planKey('2026-11-01')).toBe('plan:2026-11-01');
    expect(await getMeta('plansNote')).toBe('not a plan');
  });

  it('stores snoozes and drops expired ones when a new one is added', async () => {
    await snoozeInsight('a', NOW + DAY, NOW);
    await snoozeInsight('b', NOW + 2 * DAY, NOW + 2 * DAY - 1);
    expect(await getInsightSnooze()).toEqual({ b: NOW + 2 * DAY });
    await snoozeInsight('c', NOW + 5 * DAY, NOW + 3 * DAY);
    expect(await getInsightSnooze()).toEqual({ c: NOW + 5 * DAY });
  });

  it('reads onboarding as undefined until it is saved', async () => {
    expect(await getOnboarding()).toBeUndefined();
    await setOnboarding({ done: false, at: null, input: true, calibrated: false, placed: false });
    expect(await getOnboarding()).toEqual({ done: false, at: null, input: true, calibrated: false, placed: false });
  });

  it('adds the new UI prefs and fills them for older stored prefs', async () => {
    const fresh = await loadUiPrefs();
    expect(fresh).toMatchObject({ daily: { level: null }, playback: { speed: 1 }, installDismissed: false });
    // What 1.0 stored.
    await setMeta('ui', { fullscreen: true, dynamic: fresh.dynamic, modules: {} });
    expect(await loadUiPrefs()).toMatchObject({
      fullscreen: true,
      daily: { level: null },
      playback: { speed: 1 },
      installDismissed: false,
    });
    await saveUiPrefs({ ...fresh, daily: { level: 5 }, playback: { speed: 2 }, installDismissed: true });
    expect(await loadUiPrefs()).toMatchObject({ daily: { level: 5 }, playback: { speed: 2 }, installDismissed: true });
    await setMeta('ui', { fullscreen: false, daily: { level: 'x' }, playback: { speed: -1 } });
    expect(await loadUiPrefs()).toMatchObject({ daily: { level: null }, playback: { speed: 1 } });
  });
});

describe('gzip helpers', () => {
  it('round trips base64 for inputs larger than one slice', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31 + 7) % 256);
    const text = bytesToBase64(bytes);
    expect(text.endsWith('=') || text.length % 4 === 0).toBe(true);
    expect(base64ToBytes(text)).toEqual(bytes);
    expect(() => base64ToBytes('not base64!')).toThrow();
  });
});

describe('export v2', () => {
  async function seedWithReplays() {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const saved = await savePlay(playWithReplay(40 + i, { score: 5000 - i * 100, startedAt: NOW - (3 - i) * 1000 }), NOW);
      ids.push(saved!.summary.id);
    }
    await savePlay(makeFixture({ seed: 50, objects: 40, startedAt: NOW - 10_000 }).result, NOW);
    await settle();
    return ids;
  }

  const roundTrip = (file: ExportFile) => JSON.parse(JSON.stringify(file)) as ExportFile;

  it('imports replays with equal bytes', async () => {
    const ids = await seedWithReplays();
    await setReplayKeep(ids[1]!, true);
    const rowsBefore = await Promise.all(ids.map((id) => getReplayRow(id)));
    const bytesBefore = await withTx('replayBytes', 'readonly', (tx) => req(tx.objectStore('replayBytes').getAll()));
    const file = roundTrip(await buildExport(undefined, { includeReplays: true }, NOW));
    expect(file.formatVersion).toBe(2);
    expect(file.plays.filter((p) => p.replay).length).toBe(3);
    expect(file.plays.find((p) => p.summary.id === ids[1])!.replay).toMatchObject({ v: 1, keep: true });

    await deleteDatabase();
    const report = await importExport(file);
    expect(report).toMatchObject({ playsAdded: 4, replaysAdded: 3, replaysInvalid: 0 });
    expect(await Promise.all(ids.map((id) => getReplayRow(id)))).toEqual(rowsBefore);
    const bytesAfter = await withTx('replayBytes', 'readonly', (tx) => req(tx.objectStore('replayBytes').getAll()));
    expect(bytesAfter).toEqual(bytesBefore);
    for (const id of ids) expect(await getReplay(id)).not.toBeNull();
    const summaries = await listSummaries();
    expect(
      summaries
        .filter((s) => s.hasReplay)
        .map((s) => s.id)
        .sort(),
    ).toEqual([...ids].sort());
  });

  it('leaves replays out when asked, and the imported plays say so', async () => {
    await seedWithReplays();
    const file = roundTrip(await buildExport(undefined, { includeReplays: false }, NOW));
    expect(file.plays.every((p) => p.replay === undefined)).toBe(true);
    // The exported summaries still carry the hint. Import corrects it.
    expect(file.plays.some((p) => p.summary.hasReplay)).toBe(true);
    await deleteDatabase();
    const report = await importExport(file);
    expect(report.replaysAdded).toBe(0);
    expect((await listSummaries()).every((s) => !s.hasReplay)).toBe(true);
    expect(await replayStorage()).toEqual({ count: 0, bytes: 0 });
  });

  it('skips a bad replay but still imports its play', async () => {
    const ids = await seedWithReplays();
    const file = roundTrip(await buildExport(undefined, { includeReplays: true }, NOW));
    const replayOf = (id: string) => file.plays.find((p) => p.summary.id === id)!;
    replayOf(ids[0]!).replay!.data = 'not base64 !!';
    replayOf(ids[1]!).replay!.data = bytesToBase64(new Uint8Array([1, 2, 3, 4, 5]));
    (replayOf(ids[2]!).replay as unknown as { events: unknown }).events = 'many';
    const huge = { ...replayOf(ids[2]!).replay!, events: 1, data: 'A'.repeat(23_000_000) };
    file.plays.push({ ...structuredClone(file.plays.find((p) => !p.replay)!), replay: huge });
    file.plays[file.plays.length - 1]!.summary.id = 'extra-play';

    await deleteDatabase();
    const report = await importExport(file);
    expect(report.playsAdded).toBe(5);
    expect(report.replaysAdded).toBe(0);
    expect(report.replaysInvalid).toBe(4);
    expect(await countPlays()).toBe(5);
    expect((await listSummaries()).every((s) => !s.hasReplay)).toBe(true);
    expect(await count('replays')).toBe(0);
  });

  it('keeps an existing replay row and does not import the replay of a deleted play', async () => {
    const ids = await seedWithReplays();
    const file = roundTrip(await buildExport(undefined, { includeReplays: true }, NOW));
    const before = await getReplayRow(ids[0]!);

    await deleteDatabase();
    // A replay row without its play, as a crash could leave behind.
    await withTx(['replays', 'replayBytes'], 'readwrite', (tx) => {
      tx.objectStore('replays').put({ ...before!, size: 3, keep: 1 });
      tx.objectStore('replayBytes').put({ playId: ids[0]!, bytes: new Uint8Array([0x1f, 0x8b, 0]) });
    });
    file.tombstones = [{ id: ids[2]!, deletedAt: NOW }];
    const report = await importExport(file);
    expect(report.replaysAdded).toBe(1);
    expect((await getReplayRow(ids[0]!))!.keep).toBe(1);
    expect((await getSummary(ids[0]!))!.hasReplay).toBe(true);
    expect(await getReplayRow(ids[2]!)).toBeUndefined();
    expect(await getSummary(ids[2]!)).toBeUndefined();
    expect(await getReplayRow(ids[1]!)).toBeDefined();
  });

  it('applies a tombstone to the replay of a play that exists locally', async () => {
    const ids = await seedWithReplays();
    const file = roundTrip(await buildExport(undefined, { includeReplays: false }, NOW));
    file.tombstones = [{ id: ids[0]!, deletedAt: NOW }];
    await importExport(file);
    expect(await getReplayRow(ids[0]!)).toBeUndefined();
    expect(await count('replayBytes')).toBe(2);
  });

  it('merges milestones and applies onboarding only when missing', async () => {
    await seedWithReplays();
    await setMilestones({ 'first-play': { at: 500, playId: 'p' }, 'plays-50': { at: 900, playId: null } });
    await setOnboarding({ done: true, at: 5, input: true, calibrated: true, placed: true });
    const file = roundTrip(await buildExport(undefined, { includeReplays: false }, NOW));
    expect(file.meta.milestones).toBeDefined();
    expect(file.meta.onboarding).toEqual({ done: true, at: 5, input: true, calibrated: true, placed: true });

    // Same database: the earlier time wins and local onboarding is kept.
    file.meta.milestones = {
      'first-play': { at: 100, playId: 'x' },
      'streak-7': { at: 50, playId: null },
      nonsense: { at: 1, playId: null },
    } as never;
    file.meta.onboarding = { done: false, at: null, input: false, calibrated: false, placed: false };
    await importExport(file);
    expect(await getMilestones()).toEqual({
      'first-play': { at: 100, playId: 'x' },
      'plays-50': { at: 900, playId: null },
      'streak-7': { at: 50, playId: null },
    });
    expect((await getOnboarding())!.done).toBe(true);

    // Fresh database: onboarding comes from the file.
    await deleteDatabase();
    file.meta.onboarding = { done: true, at: 7, input: true, calibrated: false, placed: false };
    await importExport(file);
    expect(await getOnboarding()).toEqual({ done: true, at: 7, input: true, calibrated: false, placed: false });
  });

  it('accepts versions 1 and 2, lifts old summaries in a v2 file, and rejects newer files', async () => {
    await seedWithReplays();
    const file = roundTrip(await buildExport(undefined, { includeReplays: false }, NOW));
    const v1Summary = { ...file.plays[0]!.summary, v: 1 } as unknown as Record<string, unknown>;
    for (const k of ['hasReplay', 'sections', 'movement', 'throughput', 'scoringVersion', 'milestones']) delete v1Summary[k];
    file.plays[0] = { ...file.plays[0]!, summary: v1Summary as unknown as PlaySummary };
    await deleteDatabase();
    expect((await importExport(file)).playsInvalid).toBe(0);
    expect((await listSummaries()).every((s) => s.v === 2 && s.scoringVersion >= 1)).toBe(true);

    await deleteDatabase();
    expect((await importExport({ ...file, formatVersion: 1 })).playsAdded).toBe(4);
    await expect(importExport({ ...file, formatVersion: 3 })).rejects.toThrow(
      'This file was made by a newer version of Heartbeat. Update the app and try again.',
    );
    await expect(importExport({ ...file, formatVersion: 3 })).rejects.toBeInstanceOf(ImportError);
  });
});

describe('opening the database', () => {
  it('waits while a 1.0 connection is open, fires onDbBlocked, and finishes once it closes', async () => {
    const v1 = await openV1();
    const blocked = vi.fn();
    const off = onDbBlocked(blocked);
    let done = false;
    const opened = openDb().then((db) => {
      done = true;
      return db;
    });
    await vi.waitFor(() => expect(blocked).toHaveBeenCalled());
    expect(done).toBe(false);

    v1.close();
    const db = await opened;
    off();
    expect(done).toBe(true);
    expect(db.version).toBe(DB_VERSION);
    expect(db.objectStoreNames.contains('replays')).toBe(true);
    expect(db.objectStoreNames.contains('replayBytes')).toBe(true);
  });

  it('rejects with the message to show when the stored data is newer', async () => {
    await openDb();
    await deleteDatabase();
    const newer = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('heartbeat', DB_VERSION + 1);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    newer.close();
    const error = await openDb().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DbNewerError);
    expect((error as Error).message).toBe(DB_NEWER_MESSAGE);
    expect(DB_NEWER_MESSAGE).toBe('This browser has data from a newer Heartbeat. Reload to update.');
    expect(DB_BLOCKED_MESSAGE).toBe('Close other Heartbeat tabs to finish the update.');
  });
});
