// Prints the median raw demand of the Dynamic presets, per skill, over 20 seeds.
// Run with CALIBRATE=1. The aim row is what DEMAND_ANCHORS.aim in catalog.ts should hold.
// The other rows are checked against the anchors that follow from the presets.

import { describe, expect, it } from 'vitest';
import { itemsFromMap, mapDemand } from '../analytics/demand';
import { quantile } from '../analytics/stats';
import { DEMAND_ANCHORS, LEVEL_PRESETS } from '../shared/catalog';
import type { LaunchRequest, SkillId } from '../shared/types';
import { previewLaunch } from '../game';

const SKILLS: SkillId[] = ['aim', 'speed', 'tracking', 'precision', 'timing', 'reading', 'spin'];
const SEEDS = 20;
const ONE: Record<SkillId, number> = { aim: 1, speed: 1, tracking: 1, precision: 1, timing: 1, reading: 1, spin: 1 };

function launchFor(level: number, seed: number): LaunchRequest {
  const p = LEVEL_PRESETS[level - 1]!;
  return { modeId: 'dynamic', difficulty: p.difficulty, presetLevel: level, options: {}, mods: [], seed, lengthSec: p.lengthSec, levels: {}, drillId: null };
}

function measure(): Record<SkillId, number[]> {
  const out = {} as Record<SkillId, number[]>;
  for (const s of SKILLS) out[s] = [];
  for (const p of LEVEL_PRESETS) {
    const per: Record<SkillId, number[]> = { aim: [], speed: [], tracking: [], precision: [], timing: [], reading: [], spin: [] };
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { map, features } = previewLaunch(launchFor(p.level, seed * 7919));
      const d = mapDemand(itemsFromMap(map, features), [], ONE);
      for (const s of SKILLS) {
        const v = d[s];
        if (v) per[s].push(v.raw);
      }
    }
    for (const s of SKILLS) out[s].push(per[s].length > 0 ? quantile(per[s], 0.5) : Number.NaN);
  }
  return out;
}

describe.skipIf(!process.env.CALIBRATE)('calibration', () => {
  const rows = measure();

  it('prints the medians', () => {
    const lines = SKILLS.map((s) => `${s.padEnd(10)} [${rows[s].map((v) => v.toFixed(2)).join(', ')}]`);
    process.stdout.write(`\nMedian raw demand at Levels 1 to 8, over ${SEEDS} seeds\n${lines.join('\n')}\n`);
    expect(rows.aim.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('matches the anchors for every skill except aim', () => {
    for (const s of SKILLS) {
      if (s === 'aim') continue;
      rows[s].forEach((v, i) => {
        const want = DEMAND_ANCHORS[s][i]!;
        // Level 1 has no streams, so it has no speed demand to measure.
        if (s === 'speed' && LEVEL_PRESETS[i]!.difficulty.streams === 0) {
          expect(Number.isNaN(v)).toBe(true);
          return;
        }
        if (!Number.isFinite(v)) throw new Error(`${s} at Level ${i + 1}: nothing measured`);
        if (Math.abs(v - want) / want > 0.03) throw new Error(`${s} at Level ${i + 1}: measured ${v.toFixed(3)}, anchor ${want}`);
      });
    }
  });
});
