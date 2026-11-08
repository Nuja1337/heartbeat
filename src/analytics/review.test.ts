// Regression tests for the review findings.

import { describe, expect, it } from 'vitest';
import type { PlayData } from '../data/schema';
import { isJump, octantOf } from './buckets';
import { createDrill, evaluateDrill, refreshDrill } from './drillEval';
import type { FixtureOptions } from './fixtures';
import { makeFixture, makeHistory } from './fixtures';
import { detectInsights } from './insights';
import { lateralSide, recommendationLabel } from './insightCopy';
import { summarizePlay } from './summary';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

const data = (list: ReturnType<typeof makeHistory>): PlayData[] =>
  list.map((fx) => ({ summary: summarizePlay(fx.result), records: fx.records }));
const hist = (
  o: FixtureOptions,
  count: number,
  endAt: number,
  seedStart: number,
  step = DAY,
  vary?: (i: number) => FixtureOptions,
): PlayData[] => data(makeHistory(count, { objects: 200, jumpsOnly: true, ...o }, { endAt, spacingMs: step, seedStart, vary }));

describe('direction wording uses the screen side', () => {
  it('maps every octant and sign to the side where the click lands', () => {
    // Lateral + is the heading turned a quarter clockwise on screen (y points down).
    const phrase = [
      'to the right of',
      'down and to the right of',
      'below',
      'down and to the left of',
      'to the left of',
      'up and to the left of',
      'above',
      'up and to the right of',
    ];
    for (let o = 0; o < 8; o++) {
      for (const sign of [1, -1] as const) {
        const h = (o * Math.PI) / 4;
        const angle = ((Math.atan2(Math.cos(h) * sign, -Math.sin(h) * sign) * 180) / Math.PI + 360) % 360;
        expect(lateralSide(o, sign)).toBe(`${phrase[octantOf(angle)]} the line`);
      }
    }
  });

  it('says moving down with a right-of-movement error lands to the left', () => {
    expect(lateralSide(2, 1)).toBe('to the left of the line');
    expect(lateralSide(0, 1)).toBe('below the line');
    expect(lateralSide(4, 1)).toBe('above the line');
    expect(lateralSide(1, -1)).toBe('up and to the right of the line');
  });
});

describe('rules that talk about jumps count jumps', () => {
  it('does not fire direction-drift from stream notes', () => {
    const streams = hist(
      { jumpsOnly: false, streamShare: 3, sliderShare: 0, spinnerShare: 0, octantLateral: { octant: 0, mean: 0.6 } },
      7,
      NOW - 600_000,
      10,
    );
    const found = detectInsights(streams, NOW);
    expect(found.find((i) => i.ruleId === 'direction-drift')).toBeUndefined();
  });

  it('counts only jumps in the numbers it reports', () => {
    const plays = hist({ octantLateral: { octant: 2, mean: 0.5 } }, 7, NOW - 600_000, 20);
    const drift = detectInsights(plays, NOW).find((i) => i.ruleId === 'direction-drift')!;
    const jumps = plays
      .flatMap((p) => p.records)
      .filter(
        (r) =>
          isJump(r) &&
          r.aimLateral !== null &&
          r.features.direction !== null &&
          Math.floor(((r.features.direction + 22.5) % 360) / 45) % 8 === 2,
      );
    expect(drift.n).toBe(jumps.length);
  });

  it('counts arc sliders as curves', () => {
    const plays = hist({ jumpsOnly: false, sliderShare: 0.35, streamShare: 0, spinnerShare: 0 }, 7, NOW - 600_000, 30);
    for (const p of plays) {
      for (const r of p.records) {
        if (!r.slider) continue;
        r.slider.shape = r.slider.shape === 'curve' ? 'arc' : r.slider.shape;
        r.slider.trackedFraction = r.slider.shape === 'straight' ? 0.97 : 0.7;
      }
    }
    const curves = detectInsights(plays, NOW).find((i) => i.ruleId === 'slider-curves');
    expect(curves).toBeDefined();
  });
});

describe('drill baseline and after-data use the same plays', () => {
  const prior = (): PlayData[] => [
    // The Jumps module is much harder on long jumps than Dynamic, so mixing them inflates the baseline.
    ...hist({ modeId: 'jumps', longAlong: -0.8, longFrom: 4, fastFrom: 0 }, 5, NOW - 3 * DAY, 40),
    ...hist({ longAlong: -0.3, longFrom: 4, fastFrom: 0 }, 5, NOW - 600_000, 60),
  ];
  const after = (): PlayData[] => [
    ...[0, 1, 2].map((k) => ({ ...hist({ modeId: 'jumps', objects: 60, drillId: 'd' }, 1, NOW + (k + 1) * 3 * 3_600_000, 80 + k)[0]! })),
    ...hist({ longAlong: -0.3, longFrom: 4, fastFrom: 0 }, 6, NOW + 2 * DAY, 90, 3_600_000),
  ];

  it('a player who does not change is not reported as better', () => {
    const insight = detectInsights(prior(), NOW).find((i) => i.ruleId === 'long-undershoot')!;
    expect(insight).toBeDefined();

    const mixed = createDrill(insight, 'd', NOW)!;
    const matched = createDrill(insight, 'd', NOW, prior())!;
    expect(matched.baseline.kind).toBe('mean');
    if (mixed.baseline.kind === 'mean' && matched.baseline.kind === 'mean') {
      expect(matched.baseline.mean).toBeGreaterThan(mixed.baseline.mean + 0.1);
      expect(matched.baseline.mean).toBeCloseTo(-0.3, 1);
    }
    const plays = after();
    const wrong = evaluateDrill(mixed, plays, NOW + 3 * DAY);
    const right = evaluateDrill(matched, plays, NOW + 3 * DAY);
    expect(wrong.outcome).toBe('better');
    expect(right.outcome).toBe('unclear');
  });
});

describe('locking', () => {
  it('does not lock a drill when the data given is known to be partial', () => {
    const plays = hist({ longAlong: -0.5 }, 5, NOW - 600_000, 100);
    const insight = detectInsights(plays, NOW).find((i) => i.ruleId === 'long-undershoot')!;
    const drill = createDrill(insight, 'd', NOW - 31 * DAY)!;
    const partial = refreshDrill(drill, [], NOW, false);
    expect(partial.changed).toBe(false);
    expect(partial.drill.final).toBeNull();
    expect(refreshDrill(drill, [], NOW, true).changed).toBe(true);
  });
});

describe('session insight timing', () => {
  const session = (): PlayData[] =>
    data(
      makeHistory(
        7,
        { objects: 120, jumpsOnly: true },
        { endAt: NOW - 2 * 60_000, spacingMs: 6 * 60_000, vary: (i) => ({ baseMiss: i < 4 ? 0.02 : 0.2 }) },
      ),
    );

  it('stops once the session has ended (30 minutes without a play)', () => {
    const list = session();
    expect(detectInsights(list, NOW + 20 * 60_000).some((i) => i.ruleId === 'long-session')).toBe(true);
    expect(detectInsights(list, NOW + 40 * 60_000).some((i) => i.ruleId === 'long-session')).toBe(false);
  });
});

describe('summaries', () => {
  it('leave spinners and plays after a pause out of the halves and quarters', () => {
    const fx = makeFixture({ seed: 5, objects: 160, jumpsOnly: false, spinnerShare: 0.1, sliderShare: 0, streamShare: 0 });
    const records = fx.records.map((r, i) => (i < 20 ? { ...r, afterPause: true } : r));
    const s = summarizePlay({ ...fx.result, records });
    const taps = records.filter((r) => r.kind !== 'spinner' && !r.afterPause);
    const weight = (j: string) => ({ crisp: 1, solid: 0.65, rough: 0.3, miss: 0 })[j as 'crisp'];
    const half = Math.floor(taps.length / 2);
    const first = taps.slice(0, half).reduce((m, r) => m + weight(r.judgment), 0) / half;
    expect(s.halves.first!).toBeCloseTo(first, 3);
    expect(records.some((r) => r.kind === 'spinner')).toBe(true);
  });
});

describe('labels', () => {
  it('reads naturally after "Opens"', () => {
    expect(recommendationLabel('jumps', { directionFocus: 2, distanceFocus: 'mixed' })).toBe('Jumps, moving down');
    expect(recommendationLabel('jumps', { distanceFocus: 'long' })).toBe('Jumps, long distances');
  });
});

describe('insights on realistic jump distances', () => {
  // Real Dynamic maps below Level 7 have almost no jumps over 4.5 widths (p90 is 2.3 to 3.3 at Levels 1 to 6).
  const LEVEL_4 = [1.2, 1.6, 1.9, 2.2, 2.6, 3, 3.5, 4];
  const LEVEL_1 = [1, 1.3, 1.6, 1.9, 2.2, 2.5];

  it('finds a planted undershoot at Level 4 spacing', () => {
    const plays = hist({ jumpSpacings: LEVEL_4, longAlong: -0.4, longFrom: 2.8, fastFrom: 0 }, 7, NOW - 600_000, 300);
    const jumpsOver45 = plays.flatMap((p) => p.records).filter((r) => isJump(r) && (r.features.spacing ?? 0) >= 4.5);
    expect(jumpsOver45).toHaveLength(0);
    const i = detectInsights(plays, NOW).find((x) => x.ruleId === 'long-undershoot')!;
    expect(i).toBeDefined();
    const cut = Number(i.text.match(/over ([\d.]+) target widths/)![1]);
    expect(cut).toBeGreaterThanOrEqual(2.5);
    expect(cut).toBeLessThanOrEqual(3.5);
    expect(i.variant).toMatch(/^s[\d.]+v[\d.]+$/);
    expect(i.recommendation?.options.distanceFocus).toBe('long');
  });

  it('finds a planted undershoot at Level 1 spacing', () => {
    const plays = hist({ jumpSpacings: LEVEL_1, longAlong: -0.4, longFrom: 1.9, fastFrom: 0 }, 8, NOW - 600_000, 320);
    const i = detectInsights(plays, NOW).find((x) => x.ruleId === 'long-undershoot');
    expect(i).toBeDefined();
    expect(Number(i!.text.match(/over ([\d.]+) target widths/)![1])).toBeGreaterThanOrEqual(1.5);
  });

  it('stays silent when the long jumps are fine', () => {
    const plays = hist({ jumpSpacings: LEVEL_4, longAlong: 0, longFrom: 2.8, fastFrom: 0 }, 7, NOW - 600_000, 340);
    expect(detectInsights(plays, NOW).find((x) => x.ruleId === 'long-undershoot' || x.ruleId === 'long-overshoot')).toBeUndefined();
  });

  it('a drill measures the same jumps even when later maps have longer ones', async () => {
    const { ruleSample, buildRows } = await import('./insights');
    const plays = hist({ jumpSpacings: LEVEL_4, longAlong: -0.4, longFrom: 2.8, fastFrom: 0 }, 7, NOW - 600_000, 360);
    const i = detectInsights(plays, NOW).find((x) => x.ruleId === 'long-undershoot')!;
    const cut = Number(i.variant!.match(/^s([\d.]+)/)![1]);
    const harder = hist({ jumpSpacings: [3, 4, 5, 6, 7], longAlong: -0.4, longFrom: 2.8, fastFrom: 0 }, 4, NOW + DAY, 380);
    const sample = ruleSample('long-undershoot', i.variant, buildRows(harder))!;
    const expected = harder
      .flatMap((p) => p.records)
      .filter((r) => isJump(r) && r.aimAlong !== null && (r.features.spacing ?? 0) >= cut).length;
    expect(sample.kind === 'mean' && sample.values.length).toBeLessThanOrEqual(expected);
    expect(sample.kind === 'mean' && sample.values.length).toBeGreaterThan(0);
  });

  it('puts Level 4 jumps in more than one of the longer bins', async () => {
    const { computeBuckets } = await import('./buckets');
    const plays = hist({ jumpSpacings: LEVEL_4 }, 3, NOW, 400);
    const keys = Object.keys(computeBuckets(plays.flatMap((p) => p.records)));
    expect(keys.some((k) => k.startsWith('dg:long:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('dg:medium:'))).toBe(true);
  });

  it('finds sharp against wide turns on short Level 1 jumps', () => {
    const plays = hist({ jumpSpacings: LEVEL_1, sharpExtraMiss: 0.2 }, 8, NOW - 600_000, 420);
    expect(detectInsights(plays, NOW).find((x) => x.ruleId === 'sharp-wide')).toBeDefined();
  });

  it('finds a busy-screen problem relative to the maps the player uses', () => {
    const plays = hist({ busyExtraMiss: 0.2, busyFrom: 3 }, 10, NOW - 600_000, 440);
    const i = detectInsights(plays, NOW).find((x) => x.ruleId === 'busy-screen')!;
    expect(i.text).toMatch(/^You miss more when 3 or more targets are on screen/);
  });
});

describe('no stream data yet', () => {
  it('gives no Speed score and no stream insights when no note is part of a run', () => {
    const plays = hist({ jumpsOnly: false, streamShare: 3, sliderShare: 0, spinnerShare: 0, streamOffsetMs: 25 }, 7, NOW - 600_000, 460);
    // The engine can report runLength 0 for every note.
    const flat: PlayData[] = plays.map((p) => {
      const records = p.records.map((r) => ({ ...r, features: { ...r.features, runIndex: 0, runLength: 0 } }));
      const fx = makeFixture({ seed: 1, objects: 10 });
      return { summary: summarizePlay({ ...fx.result, records, startedAt: p.summary.startedAt, endedAt: p.summary.endedAt }), records };
    });
    expect(flat.every((p) => p.summary.skills.speed === undefined)).toBe(true);
    const found = detectInsights(flat, NOW);
    expect(found.find((i) => i.ruleId === 'stream-offset' || i.ruleId === 'stream-fade')).toBeUndefined();
  });
});
