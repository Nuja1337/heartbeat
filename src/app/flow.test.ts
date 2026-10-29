// The ?fake=1 flow without a browser: fake plays are saved, analysed, turned into a drill and measured.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteDatabase } from '../data/db';
import { listDrills } from '../data/drills';
import { savePlay } from '../data/plays';
import { levelsFromProgress } from '../data/progress';
import type { LaunchRequest, PlayResult } from '../shared/types';
import { fakeResult } from './play/fakeGame';
import { invalidateAnalysis, loadAnalysis } from './state/analysis';
import { trainThis } from './state/drills';
import { dynamicLaunch, moduleLaunch, presetDifficulty } from './state/launch';

const HOUR = 3_600_000;
const NOW = Date.now();

function playAt(launch: LaunchRequest, hoursAgo: number): PlayResult {
  const r = fakeResult(launch);
  const startedAt = NOW - hoursAgo * HOUR;
  return { ...r, startedAt, endedAt: startedAt + r.playedMs };
}

const dynamic = (seed: number) =>
  dynamicLaunch({ presetLevel: 4, difficulty: presetDifficulty(4), mods: [], lengthSec: 90, seed, levels: {} });

beforeEach(async () => {
  await deleteDatabase();
  invalidateAnalysis();
});

describe('fake game flow', () => {
  it('saves plays, finds an insight, starts a drill and measures it', async () => {
    for (let i = 0; i < 6; i++) await savePlay(playAt(dynamic(100 + i), 400 - i * 24), NOW);

    let analysis = await loadAnalysis();
    expect(analysis.summaries).toHaveLength(6);
    expect(analysis.ratings.aim).not.toBeNull();
    const top = analysis.insights.find((i) => i.ruleId === 'long-undershoot');
    expect(top).toBeDefined();
    expect(top!.recommendation?.modeId).toBe('jumps');

    // "Train this" records a drill and opens the module setup prefilled.
    const calls: [string, unknown][] = [];
    await trainThis(top!, analysis.drills.map((d) => d.drill), levelsFromProgress(analysis.progress), analysis.windowPlays, ((to: string, opts: unknown) => calls.push([to, opts])) as never);
    expect(calls[0]![0]).toBe('/train/jumps');
    const prefill = (calls[0]![1] as { state: { prefill: LaunchRequest } }).state.prefill;
    expect(prefill.drillId).not.toBeNull();
    expect(prefill.options.distanceFocus).toBe('long');
    const drills = await listDrills();
    expect(drills).toHaveLength(1);

    // Asking again reuses the active drill.
    await trainThis(top!, drills, {}, analysis.windowPlays, ((): void => undefined) as never);
    expect(await listDrills()).toHaveLength(1);

    // Three drill sessions an hour apart, then plays outside the drill.
    for (let k = 0; k < 3; k++) await savePlay(playAt(moduleLaunch({ modeId: 'jumps', options: prefill.options, mods: [], lengthSec: 90, seed: 500 + k, levels: {}, drillId: prefill.drillId }), 12 - k), NOW);
    for (let k = 0; k < 4; k++) await savePlay(playAt(dynamic(700 + k), 6 - k), NOW);

    invalidateAnalysis();
    analysis = await loadAnalysis();
    expect(analysis.summaries).toHaveLength(13);
    const measured = analysis.drills.find((d) => d.drill.id === prefill.drillId)!;
    expect(measured.eval.sessions).toBe(3);
    expect(measured.eval.outcome).not.toBe('collecting');
    // The progress rows come from the module plays.
    expect(analysis.progress.jumps?.sessions).toBe(3);
  });
});
