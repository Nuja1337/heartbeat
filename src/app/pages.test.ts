// Pure helpers behind the 2.0 pages: replay markers, the seek target for a miss, counter easing,
// plan step status, the daily launch and its history.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeFixture } from '../analytics/fixtures';
import { summarizePlay } from '../analytics/summary';
import { buildDailyPlan, planStepsDone } from '../analytics/training';
import { deleteDatabase } from '../data/db';
import { getMilestones, getPlan, patchMilestones } from '../data/meta';
import type { DrillEval, PlaySummary } from '../data/schema';
import { DAILY_LENGTH_SEC } from '../shared/catalog';
import { dailySeed, localDateKey } from '../shared/codes';
import type { HitRecord } from '../shared/types';
import { nextPoint } from './charts/PointNav';
import { countAt } from './components/Count';
import { blockName, stripBlocks } from './components/SectionStrip';
import { previewRunning } from './components/SkinPreview';
import { canShare, shareText } from './components/ShareButton';
import { andList, count } from './format';
import { bestOfDay, dailyHistory, dailyLaunch, dailyLevel } from './state/daily';
import { recordDrillBetter } from './state/analysis';
import * as Analytics from '../analytics/index';
import { ensurePlan, planButtonLabel, planIsStale, planStatus } from './state/plan';
import {
  SEEK_LEAD_MS,
  markersFromJudgments,
  markersFromRecords,
  nextMissTarget,
  replayLink,
  replayMarkers,
  seekTarget,
} from './state/replayMarkers';

const NOW = new Date(2026, 5, 10, 12, 0, 0).getTime();
const DATE = localDateKey(NOW);

function summary(over: Partial<PlaySummary> = {}): PlaySummary {
  const { result } = makeFixture({ seed: 7, startedAt: NOW, presetLevel: 4 });
  return { ...summarizePlay(result), ...over };
}

function rec(index: number, time: number, over: Partial<HitRecord> = {}): HitRecord {
  const { records } = makeFixture({ seed: 3, objects: 8 });
  return { ...records[0]!, index, time, endTime: time, judgment: 'solid', missReason: null, slider: null, ...over };
}

describe('replay markers', () => {
  const records = [
    rec(0, 1000),
    rec(1, 4000, { judgment: 'miss', missReason: 'aim' }),
    rec(2, 6000, { kind: 'slider', endTime: 7000, judgment: 'rough', slider: { breaks: 1, firstLossAt: 0.5 } as HitRecord['slider'] }),
    rec(3, 9000, { judgment: 'miss', missReason: 'early' }),
    rec(4, 12_000, { kind: 'slider', endTime: 13_000, slider: { breaks: 0, firstLossAt: null } as HitRecord['slider'] }),
  ];

  it('takes misses and slider breaks from the records, in time order', () => {
    const m = markersFromRecords([...records].reverse());
    expect(m.map((x) => [x.index, x.kind, x.time])).toEqual([
      [1, 'miss', 4000],
      [2, 'break', 6500],
      [3, 'miss', 9000],
    ]);
    expect(m[0]!.reason).toBe('aim');
  });

  it('takes them from the judgment string when the detail is gone', () => {
    const objects = [
      { kind: 'circle' as const, time: 1000 },
      { kind: 'circle' as const, time: 4000 },
      { kind: 'slider' as const, time: 6000, endTime: 7000 },
      { kind: 'circle' as const, time: 9000 },
      { kind: 'spinner' as const, time: 10_000, endTime: 11_000 },
    ];
    const m = markersFromJudgments('cmrm-', objects);
    expect(m.map((x) => [x.index, x.kind, x.objectKind])).toEqual([
      [1, 'miss', 'circle'],
      [2, 'break', 'slider'],
      [3, 'miss', 'circle'],
    ]);
    // A rough circle is not a break, and an object that was never judged is not a miss.
    expect(markersFromJudgments('rr', objects).length).toBe(0);
  });

  it('prefers the records and falls back to the judgments', () => {
    const replay = {
      judgments: 'cm',
      map: {
        objects: [
          { kind: 'circle' as const, time: 1 },
          { kind: 'circle' as const, time: 2500 },
        ],
      },
    };
    expect(replayMarkers(records, replay).length).toBe(3);
    expect(replayMarkers(null, replay).map((x) => x.time)).toEqual([2500]);
    expect(replayMarkers([], replay).map((x) => x.time)).toEqual([2500]);
  });

  it('starts a watch link 1.5 seconds before the object and never before zero', () => {
    expect(SEEK_LEAD_MS).toBe(1500);
    expect(seekTarget(10_000)).toBe(8500);
    expect(seekTarget(900)).toBe(0);
    expect(replayLink('abc', 10_000)).toBe('/replay/abc?t=8500');
  });

  it('finds the next miss for the M key and skips slider breaks', () => {
    const m = markersFromRecords(records);
    expect(nextMissTarget(m, 0)).toBe(2500);
    // Already at the first miss's start, so the next one is ahead.
    expect(nextMissTarget(m, 2500)).toBe(7500);
    expect(nextMissTarget(m, 7500)).toBeNull();
    expect(nextMissTarget([], 0)).toBeNull();
  });
});

describe('counter easing', () => {
  it('starts at 0, eases out and ends on the value', () => {
    expect(countAt(100, 0)).toBe(0);
    expect(countAt(100, 300)).toBeCloseTo(87.5, 5);
    expect(countAt(100, 600)).toBe(100);
    expect(countAt(100, 5000)).toBe(100);
    expect(countAt(100, -10)).toBe(0);
  });
  it('shows the final value when there is no duration', () => {
    expect(countAt(42, 0, 0)).toBe(42);
  });
  it('rises without ever dropping', () => {
    let last = -1;
    for (let t = 0; t <= 600; t += 20) {
      const v = countAt(1000, t);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });
});

describe('plan status', () => {
  const plan = buildDailyPlan(DATE, [], {}, { playCount: 0, drills: [], dynamicLevel: 3 }, {}, NOW);
  const from = (step: number, over: Partial<PlaySummary> = {}) =>
    summary({ status: 'completed', ...over, launch: { ...plan.steps[step]!.launch, source: { kind: 'plan', date: DATE, step } } });

  it('starts the plan when nothing is done', () => {
    const s = planStatus(plan, planStepsDone(plan, []));
    expect(s.doneCount).toBe(0);
    expect(s.next?.step).toBe(0);
    expect(planButtonLabel(s)).toBe("Start today's plan");
  });

  it('points at the first step that is not done', () => {
    const s = planStatus(plan, planStepsDone(plan, [from(0), from(2)]));
    expect(s.done).toEqual([true, false, true, false]);
    expect(s.doneCount).toBe(2);
    expect(s.next?.step).toBe(1);
    expect(planButtonLabel(s)).toBe(`Next: ${plan.steps[1]!.title}`);
  });

  it('has no next step when all are done', () => {
    const s = planStatus(
      plan,
      planStepsDone(
        plan,
        [0, 1, 2, 3].map((i) => from(i)),
      ),
    );
    expect(s.next).toBeNull();
    expect(planButtonLabel(s)).toBeNull();
  });
});

describe('daily map', () => {
  it('uses the date seed, Dynamic, the daily length and no mods', () => {
    const l = dailyLaunch('2026-11-01', 5, { jumps: 3 });
    expect(l.seed).toBe(1500758254);
    expect(l.seed).toBe(dailySeed('2026-11-01'));
    expect(l.modeId).toBe('dynamic');
    expect(l.presetLevel).toBe(5);
    expect(l.lengthSec).toBe(DAILY_LENGTH_SEC);
    expect(l.mods).toEqual([]);
    expect(l.source).toEqual({ kind: 'daily', date: '2026-11-01' });
    expect(l.levels).toEqual({ jumps: 3 });
  });

  it('takes the chosen level, or the suggested one', () => {
    expect(dailyLevel(6, 3)).toBe(6);
    expect(dailyLevel(null, 3)).toBe(3);
  });

  it('lists daily plays newest first and picks the best finished one for a day', () => {
    const daily = (id: string, at: number, accuracy: number, date: string, status: PlaySummary['status'] = 'completed') =>
      summary({ id, startedAt: at, accuracy, status, launch: dailyLaunch(date, 4, {}) });
    const list = [
      daily('a', NOW - 3000, 0.9, DATE),
      daily('b', NOW - 2000, 0.95, DATE),
      daily('c', NOW - 1000, 0.99, DATE, 'quit'),
      daily('d', NOW - 90_000_000, 0.8, '2026-06-09'),
      summary({ id: 'manual', startedAt: NOW }),
    ];
    const rows = dailyHistory(list);
    expect(rows.map((r) => r.id)).toEqual(['c', 'b', 'a', 'd']);
    expect(rows[0]!.grade).toBeNull();
    expect(bestOfDay(rows, DATE)?.id).toBe('b');
    expect(bestOfDay(rows, '2026-01-01')).toBeNull();
  });

  it('leaves out a new map started from a daily', () => {
    const fresh = summary({ id: 'fresh', startedAt: NOW, accuracy: 0.99, launch: { ...dailyLaunch(DATE, 4, {}), seed: 1 } });
    const real = summary({ id: 'real', startedAt: NOW - 1000, accuracy: 0.9, launch: dailyLaunch(DATE, 4, {}) });
    const rows = dailyHistory([fresh, real]);
    expect(rows.map((r) => r.id)).toEqual(['real']);
    expect(bestOfDay(rows, DATE)?.id).toBe('real');
  });
});

describe('text helpers', () => {
  it('writes a count with its noun', () => {
    expect(count(1, 'play')).toBe('1 play');
    expect(count(0, 'play')).toBe('0 plays');
    expect(count(75, 'replay')).toBe('75 replays');
    expect(count(2, 'day')).toBe('2 days');
    expect(count(1234, 'play')).toBe('1,234 plays');
  });

  it('joins a list with and before the last item', () => {
    expect(andList(['jumps'])).toBe('jumps');
    expect(andList(['jumps', 'streams'])).toBe('jumps and streams');
    expect(andList(['jumps', 'streams', 'tracking'])).toBe('jumps, streams and tracking');
  });
});

describe('chart point navigation', () => {
  it('moves with the arrow keys, stops at the ends and ignores other keys', () => {
    expect(nextPoint('ArrowRight', null, 5)).toBe(0);
    expect(nextPoint('ArrowRight', 0, 5)).toBe(1);
    expect(nextPoint('ArrowRight', 4, 5)).toBe(4);
    expect(nextPoint('ArrowLeft', 0, 5)).toBe(0);
    expect(nextPoint('ArrowUp', 3, 5)).toBe(2);
    expect(nextPoint('Home', 3, 5)).toBe(0);
    expect(nextPoint('End', 1, 5)).toBe(4);
    expect(nextPoint('a', 1, 5)).toBeNull();
    expect(nextPoint('ArrowRight', null, 0)).toBeNull();
  });
});

describe('skin preview', () => {
  it('stays paused under reduced motion until the player presses play', () => {
    expect(previewRunning(null, true)).toBe(false);
    expect(previewRunning(null, false)).toBe(true);
    expect(previewRunning(true, true)).toBe(true);
    expect(previewRunning(false, false)).toBe(false);
  });
});

describe('share text', () => {
  it('is not offered for a placement play', () => {
    expect(canShare('placement')).toBe(false);
    expect(canShare('dynamic')).toBe(true);
    expect(canShare('jumps')).toBe(true);
  });

  it('names the mode, the level and the mods', () => {
    expect(shareText({ modeId: 'dynamic', presetLevel: 4, mods: ['mirror'] }, 'https://x.test/s/abc')).toBe(
      'Heartbeat map: Dynamic, Level 4, Mirror. https://x.test/s/abc',
    );
    expect(shareText({ modeId: 'jumps', presetLevel: null, mods: [] }, 'u')).toBe('Heartbeat map: Jumps. u');
  });
});

describe('section strip', () => {
  it('names sets by their place and drops empty sections', () => {
    const blocks = stripBlocks([
      { start: 0, end: 0, role: 'intro', focus: 'mixed', n: 0, accuracy: null, misses: 0 },
      { start: 0, end: 5000, role: null, focus: 'set', n: 10, accuracy: 0.9, misses: 1 },
      { start: 5000, end: 9000, role: null, focus: 'set', n: 8, accuracy: 1, misses: 0 },
      { start: 9000, end: 12_000, role: 'peak', focus: 'jumps', n: 8, accuracy: 0.8, misses: 2 },
    ]);
    expect(blocks.map((b) => b.label)).toEqual(['Set 1', 'Set 2', 'Peak']);
    expect(stripBlocks(null)).toEqual([]);
  });

  it('puts the role in the name of a block', () => {
    const blocks = stripBlocks([
      { start: 0, end: 5000, role: 'peak', focus: 'jumps', n: 10, accuracy: 0.9, misses: 1 },
      { start: 5000, end: 9000, role: 'peak', focus: 'set', n: 8, accuracy: 0.5, misses: 2 },
      { start: 9000, end: 12_000, role: null, focus: 'set', n: 0, accuracy: null, misses: 0 },
    ]);
    expect(blocks.map(blockName)).toEqual(['Peak, 90% accuracy, 1 miss', 'Set 1, Peak, 50% accuracy, 2 misses', 'Set 2, no objects']);
  });
});

describe('drill-better milestone', () => {
  beforeEach(async () => {
    await deleteDatabase();
  });
  const ev = (outcome: DrillEval['outcome']) => ({ outcome }) as DrillEval;

  it('is written once, the first time a drill measures better', async () => {
    await recordDrillBetter([ev('collecting'), ev('unclear')], 1000);
    expect((await getMilestones())['drill-better']).toBeUndefined();
    await recordDrillBetter([ev('better')], 2000);
    expect((await getMilestones())['drill-better']).toEqual({ at: 2000, playId: null });
    await recordDrillBetter([ev('better')], 3000);
    expect((await getMilestones())['drill-better']?.at).toBe(2000);
  });

  it('does not lose milestones written at the same time', async () => {
    await Promise.all([
      patchMilestones((m) => ({ ...m, 'first-play': { at: 1, playId: 'a' } })),
      recordDrillBetter([ev('better')], 2000),
      patchMilestones((m) => ({ ...m, 'combo-100': { at: 3, playId: 'b' } })),
    ]);
    const stored = await getMilestones();
    expect(Object.keys(stored).sort()).toEqual(['combo-100', 'drill-better', 'first-play']);
  });

  it('writes nothing for an analysis that was outdated by a delete', async () => {
    await recordDrillBetter([ev('better')], 2000, () => false);
    expect((await getMilestones())['drill-better']).toBeUndefined();
  });

  it('sees a plan from an earlier day as stale', () => {
    expect(planIsStale({ date: DATE }, NOW)).toBe(false);
    expect(planIsStale({ date: DATE }, NOW + 86_400_000)).toBe(true);
  });

  it('does not save a plan for an analysis that was outdated by a delete', async () => {
    const input = { now: NOW, insights: [], ratings: {}, summaries: [], drills: [], levels: {}, dynamicLevel: 1 };
    const plan = await ensurePlan(Analytics, { ...input, isCurrent: () => false });
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(await getPlan(DATE)).toBeUndefined();
    await ensurePlan(Analytics, input);
    expect((await getPlan(DATE))?.steps.length).toBeGreaterThan(0);
  });

  it('patchMilestones leaves the record alone when the function returns null', async () => {
    await patchMilestones(() => null);
    expect(await getMilestones()).toEqual({});
  });
});
