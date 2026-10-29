// Regression tests for the review findings in the app layer.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeFixture } from '../analytics/fixtures';
import { deleteDatabase } from '../data/db';
import { listDrills, saveDrill } from '../data/drills';
import { savePlay } from '../data/plays';
import type { Drill } from '../data/schema';
import { MODES } from '../shared/catalog';
import type { LaunchRequest } from '../shared/types';
import { rejectHitKey } from './components/KeyCapture';
import { trendValue } from './format';
import { invalidateAnalysis, loadAnalysis } from './state/analysis';
import { moduleLaunch, snapLength, startWithCurrentLevels } from './state/launch';

const DAY = 86_400_000;

beforeEach(async () => {
  await deleteDatabase();
  invalidateAnalysis();
});

describe('drills are measured on all their data', () => {
  it('counts every drill session and loads the after-window past the 60 play cap', async () => {
    const now = Date.now();
    const drill: Drill = {
      id: 'd1',
      ruleId: 'long-undershoot',
      variant: null,
      modeId: 'jumps',
      options: { distanceFocus: 'long' },
      title: 'Stopping short on long jumps',
      createdAt: now - 31 * DAY,
      baseline: { kind: 'mean', mean: -0.45, sd: 0.3, n: 120 },
      status: 'active',
      final: null,
    };
    await saveDrill(drill);
    // Three drill sessions in the first week, then 70 plays outside the drill.
    for (const [k, daysAgo] of [30.5, 30.3, 30.1].entries()) {
      const fx = makeFixture({ seed: 900 + k, modeId: 'jumps', objects: 60, jumpsOnly: true, drillId: 'd1', longAlong: -0.05, startedAt: now - daysAgo * DAY });
      await savePlay(fx.result, now);
    }
    for (let i = 0; i < 70; i++) {
      const fx = makeFixture({ seed: 1000 + i, objects: 60, jumpsOnly: true, longAlong: -0.05, startedAt: now - (29 - i * 0.4) * DAY });
      await savePlay(fx.result, now);
    }

    const analysis = await loadAnalysis();
    const measured = analysis.drills.find((d) => d.drill.id === 'd1')!;
    expect(measured.eval.sessions).toBe(3);
    expect(measured.eval.outcome).toBe('better');
    expect(measured.drill.final?.outcome).toBe('better');
    expect((await listDrills())[0]!.final?.outcome).toBe('better');
  });
});

describe('launches use the levels in the store', () => {
  const stale = (): LaunchRequest =>
    moduleLaunch({ modeId: 'jumps', options: {}, mods: [], lengthSec: 90, seed: 4242, levels: { jumps: 2.5 }, drillId: null });

  async function playerAtNine() {
    const fx = makeFixture({ seed: 5, modeId: 'jumps', objects: 40 });
    await savePlay({ ...fx.result, finalLevels: { jumps: 9 } });
  }

  it('New map takes the current level and a new seed', async () => {
    await playerAtNine();
    const calls: { launch: LaunchRequest; from: string }[] = [];
    const navigate = ((_to: string, opts: { state: { launch: LaunchRequest; from: string } }) => calls.push(opts.state)) as never;
    await startWithCurrentLevels(navigate, stale(), '/train/jumps', false, true);
    expect(calls[0]!.launch.levels.jumps).toBe(9);
    expect(calls[0]!.launch.seed).not.toBe(4242);
    expect(calls[0]!.from).toBe('/train/jumps');
  });

  it('Retry keeps the seed and still takes the current level', async () => {
    await playerAtNine();
    const calls: { launch: LaunchRequest }[] = [];
    const navigate = ((_to: string, opts: { state: { launch: LaunchRequest } }) => calls.push(opts.state)) as never;
    await startWithCurrentLevels(navigate, stale(), '/train/jumps', false, false);
    expect(calls[0]!.launch.seed).toBe(4242);
    expect(calls[0]!.launch.levels.jumps).toBe(9);
  });
});

describe('small rules', () => {
  it('snaps a preset length to the nearest option, ties up', () => {
    const options = MODES.dynamic.lengthOptions;
    expect(snapLength(75, options)).toBe(90);
    expect(snapLength(60, options)).toBe(60);
    expect(snapLength(120, options)).toBe(120);
    expect(snapLength(200, options)).toBe(180);
  });

  it('refuses Tab, Esc and a repeated key as hit keys', () => {
    expect(rejectHitKey('Tab', 'KeyX')).toMatch(/Tab/);
    expect(rejectHitKey('Escape', 'KeyX')).toMatch(/Esc/);
    expect(rejectHitKey('KeyX', 'KeyX')).toMatch(/same/);
    expect(rejectHitKey('KeyC', 'KeyX')).toBeNull();
  });

  it('formats trend values with their unit', () => {
    expect(trendValue('%', 1, 88.14)).toBe('88.1%');
    expect(trendValue('level', 2, 4.213)).toBe('4.21');
    expect(trendValue('ms', 1, 12)).toBe('12.0 ms');
    expect(trendValue('% of a width', 1, -3.04)).toBe('-3.0% of a width');
  });
});
