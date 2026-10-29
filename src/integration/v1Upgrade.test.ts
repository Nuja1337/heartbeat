// A 1.0 profile must survive the move to 2.0: the same data through a database upgrade, through an import of the
// golden 1.0 export, and under new plays saved on top of it.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pbFlags } from '../analytics/bests';
import { makeFixture } from '../analytics/fixtures';
import { allRatings } from '../analytics/ratings';
import { OBJECT_COLUMNS, SLIDER_COLUMNS, SPINNER_COLUMNS, tableFromJson, unpackRecords } from '../data/columns';
import { DB_VERSION, deleteDatabase, openDb, req, STORE_NAMES, withTx } from '../data/db';
import { listDrills } from '../data/drills';
import { buildExport, importExport } from '../data/exportImport';
import v1Json from '../data/fixtures/v1-export.json';
import { makeReplayData } from '../data/fixtures/replayData';
import { openV1 } from '../data/fixtures/v1Migration';
import { getMeta, getTierHistory } from '../data/meta';
import { countPlays, getRecords, listSummaries, savePlay } from '../data/plays';
import { loadProgress } from '../data/progress';
import { getReplay, replayStorage } from '../data/replays';
import { loadSettings } from '../data/settings';
import { DEFAULT_SETTINGS } from '../shared/catalog';
import { decodeReplay, encodeReplay } from '../shared/replay';

// Wrap two analytics functions so the tests can see what savePlay hands them.
vi.mock('../analytics/ratings', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../analytics/ratings')>();
  return { ...orig, allRatings: vi.fn(orig.allRatings) };
});
vi.mock('../analytics/bests', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../analytics/bests')>();
  return { ...orig, pbFlags: vi.fn(orig.pbFlags) };
});

type JsonTable = { count: number; columns: Record<string, (number | null)[]> };
type RawSummary = Record<string, unknown> & { id: string; startedAt: number };
interface FixtureFile {
  deviceId: string;
  settings: Record<string, unknown>;
  progress: Record<string, unknown>[];
  drills: Record<string, unknown>[];
  meta: { tiers: Record<string, unknown> };
  tombstones: unknown[];
  plays: { summary: RawSummary; detail: { v: number; objects: JsonTable; sliders: JsonTable; spinners: JsonTable } }[];
}
const fixture = v1Json as unknown as FixtureFile;

const NOW = 1_800_000_000_000;

/** What a 1.0 summary reads as after the lift. */
const lifted = (s: Record<string, unknown>) => ({
  ...s, v: 2, hasReplay: false, sections: null, movement: null, throughput: null, scoringVersion: 1, milestones: [],
});

const fixtureTables = (p: FixtureFile['plays'][number]) => ({
  objects: tableFromJson(p.detail.objects, OBJECT_COLUMNS),
  sliders: tableFromJson(p.detail.sliders, SLIDER_COLUMNS),
  spinners: tableFromJson(p.detail.spinners, SPINNER_COLUMNS),
});

/** The names of every store and its indexes, as a 2.0 database has them. */
const V2_SHAPE = {
  drills: ['createdAt', 'status'],
  meta: [],
  playDetails: ['startedAt'],
  plays: ['drillId', 'modeId', 'mode_startedAt', 'startedAt'],
  progress: [],
  replayBytes: [],
  replays: ['keep_startedAt', 'startedAt'],
  settings: [],
  tombstones: [],
};

async function shapeOf(): Promise<Record<string, string[]>> {
  const db = await openDb();
  const shape: Record<string, string[]> = {};
  const names = [...db.objectStoreNames].sort();
  const tx = db.transaction(names, 'readonly');
  for (const name of names) shape[name] = [...tx.objectStore(name).indexNames].sort();
  return shape;
}

/** Writes the golden 1.0 export into a database built with the frozen 1.0 migration, in the shapes 1.0 stored. */
async function buildV1Database(): Promise<void> {
  const db = await openV1();
  const stores = ['plays', 'playDetails', 'progress', 'drills', 'tombstones', 'meta', 'settings'];
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    for (const p of fixture.plays) {
      tx.objectStore('plays').put(p.summary);
      tx.objectStore('playDetails').put({ playId: p.summary.id, v: p.detail.v, startedAt: p.summary.startedAt, ...fixtureTables(p) });
    }
    for (const row of fixture.progress) tx.objectStore('progress').put(row);
    for (const d of fixture.drills) tx.objectStore('drills').put(d);
    tx.objectStore('meta').put({ key: 'tiers', value: fixture.meta.tiers });
    tx.objectStore('meta').put({ key: 'deviceId', value: fixture.deviceId });
    tx.objectStore('settings').put({ key: 'settings', value: fixture.settings });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Everything a reader sees, for comparing the upgrade route with the import route. */
async function snapshot() {
  const summaries = await listSummaries();
  const records = await Promise.all(summaries.map((s) => getRecords(s.id)));
  return { summaries, records, progress: await loadProgress(), drills: await listDrills(), settings: await loadSettings() };
}

async function expectFixtureProfile() {
  const snap = await snapshot();
  expect(snap.summaries).toHaveLength(fixture.plays.length);
  // Newest first.
  const byNewest = [...fixture.plays].sort((a, b) => b.summary.startedAt - a.summary.startedAt);
  expect(snap.summaries).toEqual(byNewest.map((p) => lifted(p.summary)));
  byNewest.forEach((p, i) => {
    expect(snap.records[i]).toEqual(unpackRecords(fixtureTables(p)));
    expect(snap.records[i]!.length).toBeGreaterThan(0);
  });
  expect(Object.values(snap.progress).length).toBe(fixture.progress.length);
  for (const row of fixture.progress) expect(snap.progress[row.moduleId as 'jumps']).toEqual(row);
  expect(snap.drills).toEqual(fixture.drills);
  // Stored values stay, new fields take their defaults.
  expect(snap.settings.input.sensitivity).toBe(1.7);
  expect(snap.settings.input.keys).toEqual(['KeyA', 'KeyS']);
  expect(snap.settings.audio.master).toBe(0.35);
  expect(snap.settings.display.reduceMotion).toBe(true);
  expect(snap.settings.data.detailRetentionDays).toBe(90);
  expect(snap.settings.input.retryKey).toBe(DEFAULT_SETTINGS.input.retryKey);
  expect(snap.settings.audio.soundSet).toBe('glass');
  expect(snap.settings.skin).toEqual(DEFAULT_SETTINGS.skin);
  expect(snap.settings.goals).toEqual(DEFAULT_SETTINGS.goals);
  expect(snap.settings.data.replayLimit).toBe(100);
  expect(await getTierHistory()).toEqual(fixture.meta.tiers);
  expect(await replayStorage()).toEqual({ count: 0, bytes: 0 });
  return snap;
}

/** savePlay asks for persistent storage in the background. Wait for that, so it can't reopen a deleted database. */
const settle = () => vi.waitFor(async () => expect(await getMeta('persist')).toBeDefined());

beforeEach(async () => {
  await deleteDatabase();
  vi.mocked(allRatings).mockClear();
  vi.mocked(pbFlags).mockClear();
});

describe('upgrading a 1.0 database', () => {
  it('opens at version 2 with every row intact and the new stores empty', async () => {
    await buildV1Database();
    const db = await openDb();
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual([...STORE_NAMES].sort());
    expect(await shapeOf()).toEqual(V2_SHAPE);

    expect(await countPlays()).toBe(4);
    const details = await withTx('playDetails', 'readonly', (tx) => req(tx.objectStore('playDetails').count()));
    expect(details).toBe(4);
    await expectFixtureProfile();

    // The upgrade only adds stores. The stored summaries are still the 1.0 shape and lift on read.
    const raw = await withTx('plays', 'readonly', (tx) => req(tx.objectStore('plays').getAll()));
    expect(raw.every((r: { v: number }) => r.v === 1)).toBe(true);
  });

  it('gives a fresh database the same stores and indexes', async () => {
    expect(await shapeOf()).toEqual(V2_SHAPE);
  });

  it('gives the same result as importing the 1.0 export into a fresh database', async () => {
    const report = await importExport(JSON.parse(JSON.stringify(fixture)));
    expect(report.playsAdded).toBe(4);
    expect(report.playsInvalid).toBe(0);
    expect(report.detailsAdded).toBe(4);
    expect(report.replaysAdded).toBe(0);
    expect(report.settingsApplied).toBe(true);
    const imported = await expectFixtureProfile();

    await deleteDatabase();
    await buildV1Database();
    const upgraded = await snapshot();
    expect(upgraded).toEqual(imported);
  });
});

describe('new plays over 1.0 rows', () => {
  const levelThree = fixture.plays.find((p) => p.summary.presetLevel === 3 && p.summary.status === 'completed')!.summary;

  const play = (seed: number, score: number) => {
    const fx = makeFixture({ seed, objects: 60, presetLevel: 3, lengthSec: 45, startedAt: NOW - 1000 });
    return { ...fx.result, score };
  };

  it('sets pb.score when the play beats the 1.0 Level 3 score', async () => {
    await buildV1Database();
    const saved = await savePlay(play(1, (levelThree.score as number) + 1), NOW);
    expect(saved!.summary.pb.score).toBe(true);
    expect(saved!.summary.scoringVersion).toBe(1);
    await settle();
  });

  it('does not set pb.score when it does not', async () => {
    await buildV1Database();
    const saved = await savePlay(play(2, (levelThree.score as number) - 1), NOW);
    expect(saved!.summary.pb.score).toBeUndefined();
    await settle();
  });

  it('hands lifted rows to the personal best and rating code, and leaves the stored rows alone', async () => {
    await buildV1Database();
    await savePlay(play(3, 1), NOW);
    const seen = [...vi.mocked(pbFlags).mock.calls[0]![1], ...vi.mocked(allRatings).mock.calls[0]![0]];
    expect(seen.length).toBeGreaterThanOrEqual(4);
    for (const s of seen) {
      expect(s.v).toBe(2);
      expect(typeof s.scoringVersion).toBe('number');
      expect(typeof s.hasReplay).toBe('boolean');
    }
    const raw = await withTx('plays', 'readonly', (tx) => req(tx.objectStore('plays').getAll()));
    expect(raw.filter((r: { v: number }) => r.v === 1)).toHaveLength(4);
    // The tier history from 1.0 stays.
    expect((await getTierHistory()).aim).toEqual(fixture.meta.tiers.aim);
    await settle();
  });
});

describe('mixed rows', () => {
  it('exports 1.0 rows and a 2.0 play with its replay, and imports them back equal', async () => {
    await buildV1Database();
    const data = makeReplayData();
    const fx = makeFixture({ seed: 9, objects: 60, presetLevel: 3, lengthSec: 45, startedAt: NOW - 1000 });
    const saved = await savePlay({ ...fx.result, replay: data }, NOW);
    expect(saved!.summary.hasReplay).toBe(true);
    await settle();

    const summariesBefore = await listSummaries();
    const replayBefore = await getReplay(saved!.summary.id);
    expect(replayBefore).toEqual(decodeReplay(encodeReplay(data)));
    const file = JSON.parse(JSON.stringify(await buildExport(undefined, { includeReplays: true }, NOW)));
    expect(file.formatVersion).toBe(2);

    await deleteDatabase();
    const report = await importExport(file);
    expect(report.playsAdded).toBe(5);
    expect(report.replaysAdded).toBe(1);

    expect(await listSummaries()).toEqual(summariesBefore);
    expect(await getReplay(saved!.summary.id)).toEqual(replayBefore);
    for (const s of summariesBefore.filter((x) => x.id !== saved!.summary.id)) expect(await getReplay(s.id)).toBeNull();
    expect(await replayStorage()).toMatchObject({ count: 1 });
  });
});
