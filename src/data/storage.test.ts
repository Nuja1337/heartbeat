import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeFixture, makeHistory } from '../analytics/fixtures';
import { OBJECT_COLUMNS, packRecords, tableFromJson, tableToJson, unpackRecords } from './columns';
import { deleteDatabase, openDb, STORE_NAMES, withTx } from './db';
import { gunzipBytes } from './gzip';
import { buildExport, exportBytes, ImportError, importBytes, importExport, LEGACY_EXPORT_FORMAT, parseExportBytes } from './exportImport';
import { getDeviceId, getMeta, loadUiPrefs, saveUiPrefs, getTierHistory } from './meta';
import {
  countPlays,
  deleteAllData,
  deletePlay,
  getDetail,
  getRecords,
  getSummary,
  listSummaries,
  listSummariesByMode,
  listSummariesSince,
  loadPlayData,
  savePlay,
  shouldSave,
} from './plays';
import { applyPlayToProgress, loadProgress } from './progress';
import { runRetention } from './retention';
import { loadSettings, sanitizeSettings, saveSettings } from './settings';
import { DEFAULT_SETTINGS } from '../shared/catalog';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

beforeEach(async () => {
  await deleteDatabase();
});

describe('database', () => {
  it('opens a fresh database with every store and index', async () => {
    const db = await openDb();
    expect([...db.objectStoreNames].sort()).toEqual([...STORE_NAMES].sort());
    await withTx('plays', 'readonly', (tx) => {
      const names = [...tx.objectStore('plays').indexNames].sort();
      expect(names).toEqual(['drillId', 'modeId', 'mode_startedAt', 'startedAt']);
    });
    expect(await loadSettings()).toEqual({ ...DEFAULT_SETTINGS, updatedAt: 0 });
  });

  it('keeps one device id', async () => {
    const a = await getDeviceId();
    const b = await getDeviceId();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });
});

describe('columns', () => {
  it('round trips records through typed arrays', () => {
    const { records } = makeFixture({ seed: 5, objects: 120, sliderShare: 0.2, spinnerShare: 0.05 });
    const back = unpackRecords(packRecords(records));
    expect(back).toHaveLength(records.length);
    expect(records.some((r) => r.slider)).toBe(true);
    expect(records.some((r) => r.spinner)).toBe(true);
    records.forEach((r, i) => {
      const b = back[i]!;
      expect(b.kind).toBe(r.kind);
      expect(b.judgment).toBe(r.judgment);
      expect(b.headJudgment).toBe(r.headJudgment);
      expect(b.missReason).toBe(r.missReason);
      expect(b.input).toBe(r.input);
      expect(b.pattern).toBe(r.pattern);
      expect(b.features.runIndex).toBe(r.features.runIndex);
      expect(b.timingError === null).toBe(r.timingError === null);
      if (r.timingError !== null) expect(b.timingError!).toBeCloseTo(r.timingError, 2);
      if (r.features.turnAngle !== null) expect(b.features.turnAngle!).toBeCloseTo(r.features.turnAngle, 2);
      expect(b.slider === null).toBe(r.slider === null);
      if (r.slider) {
        expect(b.slider!.endHit).toBe(r.slider.endHit);
        expect(b.slider!.shape).toBe(r.slider.shape);
        expect(b.slider!.trackedFraction).toBeCloseTo(r.slider.trackedFraction, 4);
      }
      expect(b.spinner === null).toBe(r.spinner === null);
    });
  });

  it('fills columns a stored table lacks and ignores unknown ones', () => {
    const packed = packRecords(makeFixture({ seed: 2, objects: 30 }).records);
    delete packed.objects.columns.efficiency;
    packed.objects.columns.futureColumn = new Float32Array(packed.objects.count);
    const back = unpackRecords(packed);
    expect(back[0]!.movement.efficiency).toBeNull();
    expect(back).toHaveLength(30);
  });

  it('survives the JSON form used by export files', () => {
    const { records } = makeFixture({ seed: 3, objects: 40 });
    const json = JSON.parse(JSON.stringify(tableToJson(packRecords(records).objects)));
    const table = tableFromJson(json, OBJECT_COLUMNS);
    expect(table.count).toBe(40);
    expect(table.columns.time).toBeInstanceOf(Float32Array);
    expect(table.columns.kind).toBeInstanceOf(Uint8Array);
  });
});

describe('plays', () => {
  it('saves and loads a play with its typed-array detail intact', async () => {
    const fx = makeFixture({ seed: 11, objects: 150, startedAt: NOW - DAY });
    const saved = await savePlay(fx.result, NOW);
    expect(saved).not.toBeNull();
    const id = saved!.summary.id;

    const summary = await getSummary(id);
    expect(summary?.accuracy).toBeCloseTo(fx.result.accuracy, 6);
    expect(summary?.hasDetail).toBe(true);

    const detail = await getDetail(id);
    expect(detail?.objects.columns.time).toBeInstanceOf(Float32Array);
    expect(detail?.objects.count).toBe(150);

    const records = await getRecords(id);
    expect(records).toHaveLength(150);
    expect(records![10]!.pos.x).toBeCloseTo(fx.records[10]!.pos.x, 3);
  });

  it('queries by time and by mode through the indexes', async () => {
    await savePlay(makeFixture({ seed: 1, startedAt: NOW - 3 * DAY, objects: 40 }).result, NOW);
    await savePlay(makeFixture({ seed: 2, startedAt: NOW - 2 * DAY, objects: 40, modeId: 'jumps' }).result, NOW);
    await savePlay(makeFixture({ seed: 3, startedAt: NOW - DAY, objects: 40 }).result, NOW);
    expect(await countPlays()).toBe(3);
    const all = await listSummaries();
    expect(all.map((s) => s.launch.seed)).toEqual([3, 2, 1]);
    expect((await listSummariesSince(NOW - 2.5 * DAY)).length).toBe(2);
    const jumps = await listSummariesByMode('jumps');
    expect(jumps).toHaveLength(1);
    expect(jumps[0]!.modeId).toBe('jumps');
    const data = await loadPlayData(all);
    expect(data.every((d) => d.records.length === 40)).toBe(true);
  });

  it('does not save short quit plays', async () => {
    const short = makeFixture({ seed: 4, objects: 12, status: 'quit' }).result;
    expect(shouldSave(short)).toBe(false);
    expect(await savePlay(short, NOW)).toBeNull();
    expect(await countPlays()).toBe(0);
    const long = makeFixture({ seed: 4, objects: 25, status: 'quit' }).result;
    expect(shouldSave(long)).toBe(true);
  });

  it('deleting a play leaves a tombstone', async () => {
    const saved = await savePlay(makeFixture({ seed: 6, objects: 30 }).result, NOW);
    await deletePlay(saved!.summary.id, NOW);
    expect(await getSummary(saved!.summary.id)).toBeUndefined();
    expect(await getDetail(saved!.summary.id)).toBeUndefined();
    const file = await buildExport(undefined, {}, NOW);
    expect(file.tombstones.map((t) => t.id)).toEqual([saved!.summary.id]);
  });

  it('flags a personal best and records new tiers', async () => {
    const history = makeHistory(6, { objects: 120, jumpsOnly: true, aimSd: 0.2, baseMiss: 0.01 }, { endAt: NOW, spacingMs: 3_600_000 });
    let last = null;
    for (const fx of history) last = await savePlay(fx.result, NOW);
    expect(last).not.toBeNull();
    const tiers = await getTierHistory();
    expect(Object.keys(tiers).length).toBeGreaterThan(0);
    const all = await listSummaries();
    expect(all.some((s) => s.tiers.length > 0)).toBe(true);
    // The first play has nothing to beat.
    expect(all[all.length - 1]!.pb).toEqual({});
  });
});

describe('progress', () => {
  it('moves module levels only for plays with no mods or Mirror alone', async () => {
    const plain = makeFixture({ seed: 8, modeId: 'jumps', objects: 60 }).result;
    const faded = makeFixture({ seed: 9, modeId: 'jumps', objects: 60, mods: ['fade'] }).result;
    const mirrored = makeFixture({ seed: 10, modeId: 'streams', objects: 60, mods: ['mirror'] }).result;
    expect(applyPlayToProgress({}, faded)).toEqual([]);
    await savePlay(plain, NOW);
    await savePlay(faded, NOW);
    await savePlay(mirrored, NOW);
    const progress = await loadProgress();
    expect(progress.jumps?.sessions).toBe(1);
    expect(progress.jumps?.level).toBeCloseTo(plain.finalLevels.jumps!, 6);
    expect(progress.streams?.sessions).toBe(1);
    expect(progress.angles).toBeUndefined();
  });
});

describe('settings and prefs', () => {
  it('merges stored settings over the defaults and clamps them', async () => {
    const s = sanitizeSettings({
      input: { sensitivity: 99, keys: ['KeyA', 'KeyS'] },
      audio: { master: -2 },
      data: { detailRetentionDays: null },
    });
    expect(s.input.sensitivity).toBe(5);
    expect(s.input.keys).toEqual(['KeyA', 'KeyS']);
    expect(s.audio.master).toBe(0);
    expect(s.data.detailRetentionDays).toBeNull();
    expect(s.display.errorBar).toBe(true);
    const saved = await saveSettings({ ...s, input: { ...s.input, mouseButtons: false } });
    expect(saved.updatedAt).toBeGreaterThan(0);
    expect((await loadSettings()).input.mouseButtons).toBe(false);
  });

  it('remembers UI choices', async () => {
    const prefs = await loadUiPrefs();
    expect(prefs.fullscreen).toBe(false);
    await saveUiPrefs({ ...prefs, fullscreen: true });
    expect((await loadUiPrefs()).fullscreen).toBe(true);
  });
});

describe('retention', () => {
  it('removes old detail and keeps summaries', async () => {
    const oldPlay = await savePlay(makeFixture({ seed: 20, objects: 40, startedAt: NOW - 400 * DAY }).result, NOW - 400 * DAY);
    const newPlay = await savePlay(makeFixture({ seed: 21, objects: 40, startedAt: NOW - 10 * DAY }).result, NOW - 10 * DAY);
    const removed = await runRetention(NOW, 365);
    expect(removed).toBe(1);
    expect(await getDetail(oldPlay!.summary.id)).toBeUndefined();
    expect((await getSummary(oldPlay!.summary.id))?.hasDetail).toBe(false);
    expect(await getDetail(newPlay!.summary.id)).toBeDefined();
    expect(await countPlays()).toBe(2);
    expect(await runRetention(NOW, null)).toBe(0);
  });
});

describe('export and import', () => {
  async function seed() {
    for (const fx of makeHistory(4, { objects: 80, sliderShare: 0.1 }, { endAt: NOW, spacingMs: DAY })) await savePlay(fx.result, NOW);
    await savePlay(makeFixture({ seed: 77, modeId: 'tracking', objects: 60, startedAt: NOW - 100 }).result, NOW);
  }

  it('exports to a fresh database and imports back to equality', async () => {
    await seed();
    await saveSettings(sanitizeSettings({ audio: { master: 0.3 } }));
    const before = await listSummaries();
    const detailBefore = await getRecords(before[0]!.id);
    const progressBefore = await loadProgress();
    const file = await buildExport({ engineVersion: 1, generatorVersion: 1 }, {}, NOW);
    const bytes = await exportBytes(file, false);

    await deleteDatabase();
    expect(await countPlays()).toBe(0);
    const report = await importBytes(bytes);
    expect(report.playsAdded).toBe(5);
    expect(report.playsSkipped).toBe(0);
    expect(report.detailsAdded).toBe(5);
    expect(report.settingsApplied).toBe(true);

    const after = await listSummaries();
    expect(after).toEqual(before);
    const detailAfter = await getRecords(after[0]!.id);
    expect(detailAfter).toHaveLength(detailBefore!.length);
    expect(detailAfter![5]!.features.spacing ?? 0).toBeCloseTo(detailBefore![5]!.features.spacing ?? 0, 2);
    expect(await loadProgress()).toEqual(progressBefore);
    expect((await loadSettings()).audio.master).toBeCloseTo(0.3);
  });

  it('skips plays that already exist', async () => {
    await seed();
    const file = await buildExport(undefined, {}, NOW);
    const report = await importExport(JSON.parse(JSON.stringify(file)));
    expect(report.playsAdded).toBe(0);
    expect(report.playsSkipped).toBe(5);
    expect(await countPlays()).toBe(5);
  });

  it('applies tombstones from the file', async () => {
    await seed();
    const file = JSON.parse(JSON.stringify(await buildExport(undefined, {}, NOW)));
    const victim = file.plays[0].summary.id as string;
    file.tombstones = [{ id: victim, deletedAt: NOW }];
    const report = await importExport(file);
    expect(report.tombstonesApplied).toBe(1);
    expect(await getSummary(victim)).toBeUndefined();
    expect(await countPlays()).toBe(4);
  });

  it('rejects files that are not Heartbeat exports', async () => {
    await expect(importExport({ format: 'something-else', formatVersion: 1, plays: [] })).rejects.toBeInstanceOf(ImportError);
    await expect(importExport({ format: LEGACY_EXPORT_FORMAT, formatVersion: 99, plays: [] })).rejects.toThrow(/newer/);
    await expect(importExport(null)).rejects.toBeInstanceOf(ImportError);
    await expect(parseExportBytes(new TextEncoder().encode('not json'))).rejects.toBeInstanceOf(ImportError);
  });

  it('writes the heartbeat format in new exports, and imports them', async () => {
    await seed();
    const file = await buildExport(undefined, {}, NOW);
    expect(file.format).toBe('heartbeat-export');
    const bytes = await exportBytes(file, true);
    expect(JSON.parse(new TextDecoder().decode(await gunzipBytes(bytes))).format).toBe('heartbeat-export');
    await deleteDatabase();
    const report = await importBytes(bytes);
    expect(report.playsAdded).toBe(5);
  });

  it('still imports a file with the older format value', async () => {
    await seed();
    const file = await buildExport(undefined, {}, NOW);
    await deleteDatabase();
    const report = await importBytes(await exportBytes({ ...file, format: LEGACY_EXPORT_FORMAT }, true));
    expect(report.playsAdded).toBe(5);
  });

  it('round trips through gzip', async () => {
    await seed();
    const file = await buildExport(undefined, {}, NOW);
    const plain = await exportBytes(file, false);
    const gz = await exportBytes(file, true);
    expect(await getMeta('lastExport')).toBe(NOW);
    expect(gz[0]).toBe(0x1f);
    expect(gz[1]).toBe(0x8b);
    expect(gz.length).toBeLessThan(plain.length);
    const parsed = (await parseExportBytes(gz)) as { plays: unknown[] };
    expect(parsed.plays).toHaveLength(5);
    await deleteDatabase();
    expect(await countPlays()).toBe(0);
    const report = await importBytes(gz);
    expect(report.playsAdded).toBe(5);
  });

  it('deleteAllData clears plays, progress and tier history', async () => {
    await seed();
    await deleteAllData();
    expect(await countPlays()).toBe(0);
    expect(await loadProgress()).toEqual({});
    expect(await getTierHistory()).toEqual({});
  });
});
