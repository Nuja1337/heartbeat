// Analytics 2.0 on real plays from the engine: simulated players that play well fire no insight, and planted
// movement habits (late leaving, a short first motion) are found in the engine's own movement metrics.

import { describe, expect, it } from 'vitest';
import type { PlayData } from '../data/schema';
import { LEVEL_PRESETS } from '../shared/catalog';
import type { LaunchRequest } from '../shared/types';
import { detectInsights } from '../analytics/insights';
import { summarizePlay } from '../analytics/summary';
import { demandTimeline } from '../analytics/views';
import { computeFeatures } from '../game/map/features';
import { setupPlay } from '../game/modes/runner';
import { NOISY_PLAYER, PERFECT_PLAYER } from '../game/sim/autoplay';
import type { PlayerModel } from '../game/sim/autoplay';
import { runHeadless } from '../game/sim/headless';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

function launch(seed: number, level = 4): LaunchRequest {
  const preset = LEVEL_PRESETS[level - 1]!;
  return {
    modeId: 'dynamic',
    difficulty: preset.difficulty,
    presetLevel: level,
    options: {},
    mods: [],
    seed,
    lengthSec: 90,
    levels: {},
    drillId: null,
  };
}

function plays(model: PlayerModel, count = 6, seedFrom = 300, level = 4): PlayData[] {
  const out: PlayData[] = [];
  for (let i = 0; i < count; i++) {
    const { result } = runHeadless({ launch: launch(seedFrom + i, level), model, record: false });
    const startedAt = NOW - (count - i) * 6 * HOUR;
    const r = { ...result, startedAt, endedAt: startedAt + result.playedMs };
    out.push({ summary: summarizePlay(r, { id: `${model.name}-${seedFrom}-${i}`, now: r.endedAt }), records: r.records });
  }
  return out;
}

describe('simulated players', () => {
  it('a perfect player fires no insight', () => {
    expect(detectInsights(plays(PERFECT_PLAYER), NOW).map((i) => i.key)).toEqual([]);
  });

  it('a noisy player fires no insight', () => {
    expect(detectInsights(plays(NOISY_PLAYER), NOW).map((i) => i.key)).toEqual([]);
  });

  it('fills the 2.0 summary fields from real records', () => {
    const [p] = plays(NOISY_PLAYER, 1);
    const s = p!.summary;
    expect(s.movement).not.toBeNull();
    expect(s.movement!.n).toBeGreaterThan(20);
    expect(s.movement!.leaveFrac).toBeGreaterThanOrEqual(0);
    expect(s.sections).not.toBeNull();
    expect(s.sections!.reduce((m, x) => m + x.n, 0)).toBeGreaterThan(50);
    expect(s.throughput).not.toBeNull();
    expect(s.throughput!.bitsPerSec).toBeGreaterThan(0);
  });
});

describe('planted movement habits', () => {
  it('finds a player who waits before leaving the last target', () => {
    const late: PlayerModel = { ...NOISY_PLAYER, name: 'late', leaveDelayMs: 120 };
    const found = detectInsights(plays(late, 8, 400, 6), NOW);
    expect(found.map((i) => i.ruleId)).toContain('late-leave');
    const normal = detectInsights(plays(NOISY_PLAYER, 8, 400, 6), NOW);
    expect(normal.map((i) => i.ruleId)).not.toContain('late-leave');
  });

  it('finds a player who stops the first motion short and corrects', () => {
    const short: PlayerModel = { ...NOISY_PLAYER, name: 'short', primaryShort: 0.3 };
    const found = detectInsights(plays(short, 8, 500, 6), NOW).map((i) => i.ruleId);
    expect(found).toEqual(expect.arrayContaining(['corrections', 'first-motion']));
  });
});

describe('demand timeline of a generated map', () => {
  const timeline = (level: number, binMs?: number) => {
    const map = setupPlay(launch(77, level)).map;
    return { map, t: demandTimeline(map, computeFeatures(map), binMs) };
  };
  const meanOf = (xs: (number | null)[]): number => {
    const v = xs.filter((x): x is number => x !== null);
    return v.reduce((a, b) => a + b, 0) / v.length;
  };

  it('has a bin every 2 s with the sections of the map', () => {
    const { map, t } = timeline(4);
    expect(t.binMs).toBe(2000);
    expect(t.bins).toHaveLength(Math.ceil(map.durationMs / 2000));
    expect(t.bins[0]!.start).toBe(0);
    expect(t.bins[1]!.start).toBe(2000);
    expect(t.bins.reduce((m, b) => m + b.n, 0)).toBe(map.objects.length);
    expect(t.sections).toHaveLength(map.sections.length);
    expect(t.sections[0]).toMatchObject({ start: map.sections[0]!.start, end: map.sections[0]!.end });
    for (const b of t.bins) {
      if (b.n === 0) expect(b.overall).toBeNull();
      for (const v of [b.aim, b.speed, b.overall]) if (v !== null) expect(v).toBeGreaterThan(0);
    }
  });

  it('puts a harder level higher on the scale', () => {
    const easy = timeline(2).t.bins;
    const hard = timeline(7).t.bins;
    expect(meanOf(hard.map((b) => b.overall))).toBeGreaterThan(meanOf(easy.map((b) => b.overall)) + 1);
    expect(meanOf(hard.map((b) => b.aim))).toBeGreaterThan(meanOf(easy.map((b) => b.aim)));
  });

  it('takes another bin length', () => {
    const wide = timeline(4, 5000);
    expect(wide.t.bins).toHaveLength(Math.ceil(wide.map.durationMs / 5000));
    expect(wide.t.bins[1]!.start).toBe(5000);
  });
});
