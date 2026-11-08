// Analytics 2.0, summary fields and views.

import { describe, expect, it } from 'vitest';
import type { PlayData, PlaySummary } from '../data/schema';
import { JUDGMENTS, SCORING_VERSION } from '../shared/catalog';
import type { HitRecord, Judgment, MapSection } from '../shared/types';
import { makeFixture } from './fixtures';
import { allRatings, skillRating } from './ratings';
import { mean, sd } from './stats';
import { moveStat, sectionStats, summarizePlay } from './summary';
import { playThroughput, throughputBuckets } from './throughput';
import { fatigueCurve, playVsAverage, radarData, radarMax, ratingHistory, throughputScatter, weeklyChanges } from './views';

const DAY = 86_400_000;
// Mid-afternoon local time, so day arithmetic does not depend on the machine's time zone.
const NOW = new Date(2027, 0, 15, 14, 0, 0).getTime();

const base: HitRecord = makeFixture({ seed: 21, objects: 12, jumpsOnly: true }).records[5]!;

/** A jump with the numbers throughput and movement need. Distances in units, radius 50. */
function jump(o: Partial<HitRecord> & { distance?: number; gapMs?: number; along?: number }): HitRecord {
  const { distance = 300, gapMs = 400, along = 0, ...rest } = o;
  return {
    ...base,
    radius: 50,
    judgment: 'crisp',
    headJudgment: null,
    missReason: null,
    aimAlong: along,
    aimLateral: 0,
    aimRadial: Math.abs(along),
    timingError: 0,
    afterPause: false,
    features: {
      ...base.features,
      distance,
      gapMs,
      spacing: distance / 100,
      direction: 0,
      velocity: distance / gapMs,
      runIndex: 0,
      runLength: 0,
    },
    ...rest,
  };
}

describe('summary v2 fields', () => {
  it('sets the scoring version and leaves milestones for the save', () => {
    const s = summarizePlay(makeFixture({ seed: 1, objects: 30 }).result);
    expect(s.scoringVersion).toBe(SCORING_VERSION);
    expect(s.milestones).toEqual([]);
    expect(s.sections).toBeNull();
    expect(s.movement).toBeNull();
  });

  it('counts records per section with start <= time < end', () => {
    const fx = makeFixture({ seed: 3, objects: 60 });
    const times = fx.records.map((r) => r.time);
    const cut = times[20]!;
    const sections: MapSection[] = [
      { start: 0, end: cut, intensity: 0.2, focus: 'jumps', role: 'intro' },
      { start: cut, end: 1e9, intensity: 0.8, focus: 'streams' },
    ];
    const stats = sectionStats(sections, fx.records)!;
    expect(stats.map((s) => s.n)).toEqual([20, 40]);
    expect(stats[0]).toMatchObject({ start: 0, end: cut, role: 'intro', focus: 'jumps' });
    expect(stats[1]!.role).toBeNull();
    const first = fx.records.slice(0, 20);
    expect(stats[0]!.accuracy).toBeCloseTo(mean(first.map((r) => JUDGMENTS[r.judgment].weight)), 3);
    expect(stats[0]!.misses).toBe(first.filter((r) => r.judgment === 'miss').length);
    // A section with no objects has no accuracy.
    expect(sectionStats([{ start: 5e8, end: 6e8, intensity: 0, focus: 'break' }], fx.records)![0]).toMatchObject({
      n: 0,
      accuracy: null,
      misses: 0,
    });
    expect(sectionStats(undefined, fx.records)).toBeNull();
    expect(sectionStats([], fx.records)).toBeNull();
  });

  it('puts the sections in the summary and skips records after a pause', () => {
    const fx = makeFixture({ seed: 3, objects: 60 });
    const paused = fx.records.map((r, i) => (i < 10 ? { ...r, afterPause: true } : r));
    const result = {
      ...fx.result,
      records: paused,
      map: { ...fx.result.map, sections: [{ start: 0, end: 1e9, intensity: 0.5, focus: 'mixed' as const }] },
    };
    expect(summarizePlay(result).sections![0]!.n).toBe(50);
  });

  it('summarizes movement as means over jumps, in radii', () => {
    const records = [
      jump({ movement: { ...base.movement, leaveMs: 40, primaryAlong: -50, correctionPath: 25, corrections: 0, efficiency: 0.9 } }),
      jump({ movement: { ...base.movement, leaveMs: 80, primaryAlong: -25, correctionPath: 25, corrections: 1, efficiency: 0.8 } }),
      jump({ movement: { ...base.movement, leaveMs: 120, primaryAlong: 0, correctionPath: 50, corrections: 2, efficiency: 0.7 } }),
    ];
    expect(moveStat(records)).toEqual({
      n: 3,
      leaveFrac: 0.2,
      primaryAlong: -0.5,
      correctionPath: 0.667,
      correctionShare: 0.667,
      efficiency: 0.8,
    });
  });

  it('gives null movement for 1.0 records and ignores records that are not jumps', () => {
    expect(moveStat([jump({ movement: { arriveMs: -50, efficiency: 0.9, corrections: 1, peakSpeed: 1 } })])).toBeNull();
    expect(moveStat([])).toBeNull();
    const stream = jump({
      features: { ...base.features, distance: 40, gapMs: 100, spacing: 0.4, direction: 0, runIndex: 2, runLength: 8, velocity: 0.4 },
      movement: { ...base.movement, leaveMs: 50 },
    });
    expect(moveStat([stream])).toBeNull();
  });

  it('fills movement from planted fixture records', () => {
    const fx = makeFixture({
      seed: 8,
      objects: 300,
      jumpsOnly: true,
      movement: { leaveFrac: 0.4, correctionShare: 0.5, correctionPath: 0.8, firstMotion: -0.6 },
    });
    const m = summarizePlay(fx.result).movement!;
    expect(m.n).toBeGreaterThan(250);
    expect(m.leaveFrac).toBeGreaterThan(0.36);
    expect(m.leaveFrac).toBeLessThan(0.44);
    expect(m.correctionShare).toBeGreaterThan(0.2);
    expect(m.primaryAlong).toBeLessThan(0);
  });
});

describe('throughput', () => {
  /** 20 jumps of 300 units every 400 ms, landing alternately 10 units short and past. */
  const bucket = (n: number, along = 10, distance = 300, gapMs = 400): HitRecord[] =>
    Array.from({ length: n }, (_, i) => jump({ distance, gapMs, along: i % 2 === 0 ? along : -along }));

  it('follows the effective-width formula', () => {
    const records = bucket(20);
    const alongs = records.map((r) => r.aimAlong!);
    const we = Math.max(4.133 * sd(alongs), 1);
    const de = 300 + mean(alongs);
    const ide = Math.log2(de / we + 1);
    const expected = ide / 0.4;
    const t = playThroughput(records)!;
    expect(t.n).toBe(20);
    expect(t.bitsPerSec).toBeCloseTo(expected, 9);
    const b = throughputBuckets(records);
    expect(b).toHaveLength(1);
    expect(b[0]!.idNominal).toBeCloseTo(2, 12);
    expect(b[0]!.we).toBeCloseTo(we, 9);
  });

  it('floors the effective width at 1 unit', () => {
    const t = throughputBuckets(bucket(10, 0))[0]!;
    expect(t.we).toBe(1);
    expect(t.ide).toBeCloseTo(Math.log2(301), 9);
  });

  it('drops buckets under 8 jumps and gives null under 15 in total', () => {
    expect(throughputBuckets(bucket(7))).toEqual([]);
    expect(playThroughput(bucket(14))).toBeNull();
    expect(playThroughput(bucket(15))).not.toBeNull();
    // Two buckets of 8 add up to 16 and are averaged by n.
    const two = [...bucket(8, 10, 300, 400), ...bucket(8, 20, 500, 250)];
    const [a, b] = throughputBuckets(two);
    const t = playThroughput(two)!;
    expect(t.n).toBe(16);
    expect(t.bitsPerSec).toBeCloseTo((8 * a!.tp + 8 * b!.tp) / 16, 9);
  });

  it('needs a direction and a press', () => {
    const noDirection = bucket(20).map((r) => ({ ...r, features: { ...r.features, direction: null } }));
    const noPress = bucket(20).map((r) => ({ ...r, aimAlong: null }));
    const paused = bucket(20).map((r) => ({ ...r, afterPause: true }));
    expect(playThroughput(noDirection)).toBeNull();
    expect(playThroughput(noPress)).toBeNull();
    expect(playThroughput(paused)).toBeNull();
  });

  it('is stored on the summary', () => {
    const fx = makeFixture({ seed: 2, objects: 400, jumpsOnly: true });
    const s = summarizePlay(fx.result);
    expect(s.throughput).not.toBeNull();
    expect(s.throughput!.bitsPerSec).toBeGreaterThan(0);
  });

  it('builds scatter points of nominal against effective difficulty', () => {
    const records = [...bucket(10, 10, 300, 400), ...bucket(12, 30, 500, 250)];
    const play: PlayData = { summary: summarizePlay(makeFixture({ seed: 1, objects: 20 }).result), records };
    const points = throughputScatter([play]);
    expect(points).toHaveLength(2);
    expect(points.map((p) => p.n).sort()).toEqual([10, 12]);
    const p = points.find((x) => x.n === 10)!;
    expect(p.nominalId).toBe(2);
    expect(p.ide).toBeLessThan(p.nominalId + 1);
    expect(p.tp).toBeGreaterThan(0);
  });
});

/** A summary with chosen numbers. */
function summary(i: number, at: number, over: Partial<PlaySummary> = {}): PlaySummary {
  const s = summarizePlay(makeFixture({ seed: 50 + (i % 5), objects: 30, startedAt: at }).result, { id: `s${i}`, now: at });
  return { ...s, ...over };
}

describe('ratings over time and the radar', () => {
  const withAim = (i: number, daysAgo: number, level: number): PlaySummary =>
    summary(i, NOW - daysAgo * DAY, { skills: { aim: { raw: 8.56 + (level - 4) * 1.3, level, performance: 1, score: level, n: 40 } } });

  it('gives each skill a rating at the end of each day', () => {
    const plays = [withAim(1, 9, 3), withAim(2, 6, 4), withAim(3, 3, 5)];
    const series = ratingHistory(plays, 10, NOW);
    expect(series).toHaveLength(7);
    const aim = series.find((s) => s.skill === 'aim')!.points;
    expect(aim).toHaveLength(10);
    expect(aim[0]!.day).toBeLessThan(aim[9]!.day);
    // Before the first score there is nothing, then it follows the plays so far.
    expect(aim.slice(0, 0).length).toBe(0);
    const ratings = aim.map((p) => p.rating);
    expect(ratings.filter((r) => r !== null).length).toBeGreaterThanOrEqual(9);
    expect(ratings[9]!).toBeGreaterThan(ratings[4]!);
    expect(aim[9]!.rating).toBeCloseTo(skillRating('aim', plays, NOW)!.rating, 9);
    expect(aim.every((p) => p.provisional)).toBe(true);
    expect(series.find((s) => s.skill === 'spin')!.points.every((p) => p.rating === null)).toBe(true);
  });

  it('is null before the first play of the skill', () => {
    const series = ratingHistory([withAim(1, 2, 4)], 6, NOW).find((s) => s.skill === 'aim')!.points;
    expect(series.slice(0, 3).every((p) => p.rating === null)).toBe(true);
    expect(series[5]!.rating).not.toBeNull();
  });

  it('flags provisional ratings on the radar and keeps the seven skills in order', () => {
    const plays = Array.from({ length: 6 }, (_, i) => withAim(i, i + 1, 4));
    const axes = radarData(allRatings(plays, NOW));
    expect(axes.map((a) => a.skill)).toEqual(['aim', 'speed', 'tracking', 'precision', 'timing', 'reading', 'spin']);
    expect(axes[0]).toMatchObject({ label: 'Aim', hasData: true, provisional: false });
    expect(axes[0]!.rating).toBeGreaterThan(3);
    const few = radarData(allRatings(plays.slice(0, 2), NOW));
    expect(few[0]!.provisional).toBe(true);
    expect(few[1]).toMatchObject({ rating: 0, hasData: false, provisional: false });
    expect(radarMax(axes)).toBeGreaterThanOrEqual(4);
  });
});

describe('weekly changes', () => {
  const noon = (daysAgo: number) => NOW - daysAgo * DAY;
  const timing = (n: number, avg: number, sdv: number) => ({ n, mean: avg, median: avg, sd: sdv });

  function week(before: number, after: number, extra: (i: number, recent: boolean) => Partial<PlaySummary> = () => ({})): PlaySummary[] {
    const out: PlaySummary[] = [];
    for (let d = 8; d <= 30; d += 1) {
      const wob = (d % 3) * 0.4 - 0.4;
      out.push(summary(d, noon(d), { timing: timing(100, 0, before + wob), ...extra(d, false) }));
    }
    for (let d = 0; d < 7; d++) {
      const wob = (d % 3) * 0.4 - 0.4;
      out.push(summary(100 + d, noon(d) - 3_600_000, { timing: timing(100, 0, after + wob), ...extra(d, true) }));
    }
    return out;
  }

  it('says what moved, in the copy style', () => {
    const changes = weeklyChanges(week(21, 17), NOW);
    const c = changes.find((x) => x.id === 'timingSd')!;
    expect(c).toBeDefined();
    expect(c.text).toBe('Your timing spread went from 21 ms to 17 ms this week.');
    expect(c.improved).toBe(true);
    expect(c.before).toBeCloseTo(21, 0);
    expect(c.after).toBeCloseTo(17, 0);
    expect(c.nAfter).toBe(7);
    expect(weeklyChanges(week(17, 21), NOW).find((x) => x.id === 'timingSd')!.improved).toBe(false);
  });

  it('applies the distinct gate', () => {
    // A clear t statistic, but 20 ms against 18 ms is not worth a sentence.
    expect(weeklyChanges(week(20, 18), NOW).find((x) => x.id === 'timingSd')).toBeUndefined();
    expect(weeklyChanges(week(20, 17), NOW).find((x) => x.id === 'timingSd')).toBeDefined();
  });

  it('needs 3 plays on each side and |t| of 2 or more', () => {
    const all = week(21, 17);
    const recent = all.filter((s) => s.startedAt >= NOW - 7 * DAY);
    expect(
      weeklyChanges(
        all.filter((s) => !recent.includes(s) || s === recent[0] || s === recent[1]),
        NOW,
      ),
    ).toEqual([]);
    expect(
      weeklyChanges(
        all.filter((s) => s.startedAt >= NOW - 7 * DAY),
        NOW,
      ),
    ).toEqual([]);
    expect(weeklyChanges(week(21, 21), NOW).find((x) => x.id === 'timingSd')).toBeUndefined();
    // Noisy plays with a small gap give |t| under 2.
    const noisy = week(21, 17).map((s, i) => ({ ...s, timing: { ...s.timing, sd: s.timing.sd + (i % 2 === 0 ? 14 : -14) } }));
    expect(weeklyChanges(noisy, NOW).find((x) => x.id === 'timingSd')).toBeUndefined();
  });

  it('covers accuracy, the timing offset, distance from the center, throughput and minutes', () => {
    const changes = weeklyChanges(
      week(20, 20, (_d, recent) => ({
        accuracy: recent ? 0.9 : 0.8,
        aim: { n: 100, alongMean: 0, alongSd: 0.3, lateralMean: 0, lateralSd: 0.3, radialMean: recent ? 0.3 : 0.5 },
        throughput: { n: 80, bitsPerSec: recent ? 7 : 5 },
        playedMs: recent ? 12 * 60_000 : 5 * 60_000,
      })).map((s, i) => ({
        ...s,
        accuracy: s.accuracy + (i % 3) * 0.002,
        timing: { ...s.timing, mean: (s.startedAt > NOW - 7 * DAY ? 4 : 18) + (i % 3) },
        aim: { ...s.aim, radialMean: s.aim.radialMean + (i % 3) * 0.004 },
        throughput: { n: 80, bitsPerSec: s.throughput!.bitsPerSec + (i % 3) * 0.05 },
      })),
      NOW,
    );
    const byId = Object.fromEntries(changes.map((c) => [c.id, c]));
    expect(byId.accuracy!.text).toMatch(/^Your accuracy went from 80% to 90% this week\.$/);
    expect(byId.timingMean!.text).toMatch(/^Your timing offset went from \d+ ms to \d+ ms this week\.$/);
    expect(byId.timingMean!.improved).toBe(true);
    expect(byId.radial!.text).toMatch(/^Your distance from the center of the target went from 2\d% to 1\d% of its width this week\.$/);
    expect(byId.throughput!.text).toMatch(/^Your throughput went from 5\.\d to 7\.\d bits per second this week\.$/);
    expect(byId.minutes).toBeDefined();
    expect(byId.minutes!.improved).toBeNull();
    expect(byId.minutes!.text).toMatch(/^Your practice went from \d+ to \d+ minutes a day this week\.$/);
  });

  it('shows no two equal numbers in any sentence', () => {
    for (const [b, a] of [
      [21, 17],
      [30, 12],
      [18, 14],
      [40, 25],
    ] as const) {
      for (const c of weeklyChanges(week(b, a), NOW)) {
        const nums = c.text.match(/\d+(\.\d+)?/g)!.map(Number);
        expect(nums[0], c.text).not.toBe(nums[1]);
      }
    }
  });
});

describe('play against the average', () => {
  const peer = (i: number, daysAgo: number, over: Partial<PlaySummary> = {}) =>
    summary(i, NOW - daysAgo * DAY, {
      presetLevel: 4,
      status: 'completed',
      accuracy: 0.8,
      score: 1000,
      timing: { n: 100, mean: 0, median: 0, sd: 25 },
      ...over,
    });
  const now = peer(99, 0, { accuracy: 0.9, score: 1500, timing: { n: 100, mean: 0, median: 0, sd: 18 } });

  it('compares with the same mode and level over the last 30 days', () => {
    const peers = [peer(1, 2), peer(2, 5), peer(3, 12), peer(4, 20)];
    const r = playVsAverage(now, [now, ...peers])!;
    expect(r.n).toBe(4);
    expect(r.text).toBe('Compared with 4 earlier plays at Level 4');
    const acc = r.deltas.find((d) => d.id === 'accuracy')!;
    expect(acc.average).toBeCloseTo(0.8, 9);
    expect(acc.diff).toBeCloseTo(0.1, 9);
    expect(acc.better).toBe(true);
    const t = r.deltas.find((d) => d.id === 'timingSd')!;
    expect(t.diff).toBeCloseTo(-7, 9);
    expect(t.better).toBe(true);
    expect(r.deltas.find((d) => d.id === 'score')!.better).toBe(true);
    expect(r.deltas.map((d) => d.id)).toEqual(['accuracy', 'timingSd', 'radial', 'score']);
  });

  it('needs 3 peers and leaves out other levels, old plays, unfinished plays and other scoring versions', () => {
    const peers = [peer(1, 2), peer(2, 5)];
    expect(playVsAverage(now, peers)).toBeNull();
    const noise = [
      peer(3, 3, { presetLevel: 5 }),
      peer(4, 40),
      peer(5, 4, { status: 'failed' }),
      peer(6, 6, { scoringVersion: 2 }),
      peer(7, 1, { modeId: 'jumps' }),
    ];
    expect(playVsAverage(now, [...peers, ...noise])).toBeNull();
    expect(playVsAverage(now, [...peers, peer(8, 7)])!.n).toBe(3);
  });

  it('names the mode when the peers are a module', () => {
    const jumps = (i: number, daysAgo: number) => peer(i, daysAgo, { modeId: 'jumps', presetLevel: null });
    const r = playVsAverage(jumps(99, 0), [jumps(1, 1), jumps(2, 2), jumps(3, 3)])!;
    expect(r.text).toBe('Compared with 3 earlier Jumps plays');
  });

  it('marks a worse play', () => {
    const worse = peer(98, 0, { accuracy: 0.7 });
    const r = playVsAverage(worse, [peer(1, 2), peer(2, 5), peer(3, 9)])!;
    expect(r.deltas.find((d) => d.id === 'accuracy')!.better).toBe(false);
  });
});

describe('fatigue curve', () => {
  const rec = (i: number, judgment: Judgment): HitRecord => ({ ...base, index: i, time: 1000 + i * 400, judgment });

  it('is a rolling accuracy over 20 objects against time', () => {
    const records = Array.from({ length: 200 }, (_, i) => rec(i, i < 100 ? 'crisp' : 'miss'));
    const curve = fatigueCurve(records);
    expect(curve).toHaveLength(181);
    expect(curve[0]).toMatchObject({ index: 19, accuracy: 1 });
    expect(curve[0]!.t).toBe(1000 + 19 * 400);
    expect(curve[curve.length - 1]!.accuracy).toBe(0);
    // Window 80..99 is still full, 81..100 has one miss.
    expect(curve[80]!.accuracy).toBe(1);
    expect(curve[81]!.accuracy).toBeCloseTo(0.95, 12);
    for (let i = 1; i < curve.length; i++) expect(curve[i]!.accuracy).toBeLessThanOrEqual(curve[i - 1]!.accuracy + 1e-12);
  });

  it('weights judgments, skips records after a pause and is empty below 20 records', () => {
    const solid = Array.from({ length: 30 }, (_, i) => rec(i, 'solid'));
    expect(fatigueCurve(solid)[0]!.accuracy).toBeCloseTo(JUDGMENTS.solid.weight, 12);
    expect(fatigueCurve(solid.map((r, i) => (i < 11 ? { ...r, afterPause: true } : r)))).toEqual([]);
    expect(fatigueCurve(solid.slice(0, 19))).toEqual([]);
    expect(fatigueCurve([])).toEqual([]);
  });

  it('sorts records by time', () => {
    const records = Array.from({ length: 25 }, (_, i) => rec(i, i < 5 ? 'miss' : 'crisp')).reverse();
    expect(fatigueCurve(records)[0]!.accuracy).toBeCloseTo(0.75, 12);
  });
});
