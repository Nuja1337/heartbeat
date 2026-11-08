// Regression tests for the review findings in the data layer.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeFixture } from '../analytics/fixtures';
import { packRecords, tableFromJson, unpackRecords, OBJECT_COLUMNS } from './columns';
import { deleteDatabase } from './db';
import { buildExport, importExport } from './exportImport';
import { countPlays, deleteAllData, getDetail, getSummary, savePlay } from './plays';

const NOW = 1_800_000_000_000;

beforeEach(async () => {
  await deleteDatabase();
});

async function seed(n = 3) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const saved = await savePlay(makeFixture({ seed: 200 + i, objects: 40, startedAt: NOW - (i + 1) * 3_600_000 }).result, NOW);
    ids.push(saved!.summary.id);
  }
  return ids;
}

describe('export versions', () => {
  it('writes the detail version and imports from it', async () => {
    const ids = await seed(2);
    const file = JSON.parse(JSON.stringify(await buildExport(undefined, {}, NOW)));
    expect(file.plays[0].detail.v).toBe(1);

    await deleteDatabase();
    const report = await importExport(file);
    expect(report.playsAdded).toBe(2);
    expect((await getDetail(ids[0]!))?.v).toBe(1);
  });

  it('leaves out details written by a newer version and counts them', async () => {
    await seed(2);
    const file = JSON.parse(JSON.stringify(await buildExport(undefined, {}, NOW)));
    file.plays[0].detail.v = 99;
    await deleteDatabase();
    const report = await importExport(file);
    expect(report.playsInvalid).toBe(1);
    expect(report.playsAdded).toBe(1);
  });

  it('skips malformed summaries and counts them', async () => {
    await seed(3);
    const file = JSON.parse(JSON.stringify(await buildExport(undefined, {}, NOW)));
    delete file.plays[0].summary.buckets;
    file.plays[1].summary.modeId = 'not-a-mode';
    file.plays[2].summary = 'nonsense';
    file.plays.push({ summary: null, detail: null });
    await deleteDatabase();
    const report = await importExport(file);
    expect(report.playsInvalid).toBe(4);
    expect(report.playsAdded).toBe(0);
    expect(await countPlays()).toBe(0);
  });
});

describe('delete all', () => {
  it('leaves a tombstone for every play so an old export cannot bring them back', async () => {
    const ids = await seed(3);
    const old = JSON.parse(JSON.stringify(await buildExport(undefined, {}, NOW)));
    await deleteAllData(NOW);
    expect(await countPlays()).toBe(0);
    const after = await buildExport(undefined, {}, NOW);
    expect(after.tombstones.map((t) => t.id).sort()).toEqual([...ids].sort());
    const report = await importExport(old);
    expect(report.playsAdded).toBe(0);
    expect(report.playsSkipped).toBe(3);
    expect(await getSummary(ids[0]!)).toBeUndefined();
  });
});

describe('columns missing from a stored table', () => {
  it('read as null where the field can be null and 0 otherwise', () => {
    const { records } = makeFixture({ seed: 3, objects: 30 });
    const packed = packRecords(records);
    for (const name of ['headJudgment', 'missReason', 'input', 'corrections', 'visibleCount', 'afterPause', 'comboBefore'])
      delete packed.objects.columns[name];
    const back = unpackRecords(packed);
    expect(back[0]!.headJudgment).toBeNull();
    expect(back[0]!.missReason).toBeNull();
    expect(back[0]!.input).toBeNull();
    expect(back[0]!.movement.corrections).toBeNull();
    expect(back[0]!.features.visibleCount).toBe(0);
    expect(back[0]!.afterPause).toBe(false);
    expect(back[0]!.comboBefore).toBe(0);
  });

  it('are filled the same way when read from an export file', () => {
    const table = tableFromJson({ count: 2, columns: {} }, OBJECT_COLUMNS);
    expect(table.columns.input![0]).toBe(255);
    expect(table.columns.visibleCount![0]).toBe(0);
    expect(Number.isNaN(table.columns.time![0]!)).toBe(true);
  });
});
