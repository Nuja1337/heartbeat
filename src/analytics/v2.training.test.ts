// Analytics 2.0, training: local calendar days, streaks, the weekly goal, milestones, the suggested level, the daily plan,
// snoozing and the milestone wiring in savePlay.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteDatabase } from '../data/db';
import { getInsightSnooze, getMeta, getMilestones, snoozeInsight } from '../data/meta';
import { getSummary, savePlay } from '../data/plays';
import type { Drill, PlaySummary } from '../data/schema';
import { GRADES, LEVEL_PRESETS, MILESTONES, MODES, gradeFor } from '../shared/catalog';
import type { LaunchSource, MilestoneId, SkillId } from '../shared/types';
import { dayNumberKey, dayNumberStart, keyDayNumber, localDayNumber, mondayOf, weekdayOf } from './calendar';
import { makeFixture } from './fixtures';
import type { Insight } from './insights';
import { newMilestones, recordMilestones } from './milestones';
import type { RatingInfo } from './ratings';
import { isSnoozed, snoozeUntil } from './snooze';
import { summarizePlay } from './summary';
import { dayIndex, dayStartMs } from './trends';
import {
  buildDailyPlan, dailyStreak, isPlanStepDone, planStepsDone, playStreak, SKILL_MODULE, suggestedDynamicLevel, weeklyGoal,
} from './training';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const ZONES = ['America/New_York', 'Europe/London', 'Australia/Lord_Howe', 'UTC'] as const;

const savedTz = process.env.TZ;
afterEach(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

function inZones(fn: (tz: string) => void): void {
  for (const tz of ZONES) {
    process.env.TZ = tz;
    fn(tz);
  }
}

/** A local time. Month is 1 to 12. */
const at = (y: number, m: number, d: number, h = 12, mi = 0): number => new Date(y, m - 1, d, h, mi).getTime();

let seq = 0;
function play(startedAt: number, over: Partial<PlaySummary> = {}): PlaySummary {
  seq++;
  const s = summarizePlay(makeFixture({ seed: 1 + (seq % 7), objects: 25, startedAt }).result, { id: `p${seq}`, now: startedAt });
  return { ...s, startedAt, endedAt: startedAt + 90_000, playedMs: 90_000, ...over };
}
const daily = (startedAt: number, date: string, over: Partial<PlaySummary> = {}): PlaySummary =>
  play(startedAt, { status: 'completed', ...over, launch: { ...play(0).launch, source: { kind: 'daily', date } } });

describe('local calendar days', () => {
  it('numbers days from local dates and round-trips through keys and midnights', () => {
    inZones(() => {
      expect(dayNumberKey(localDayNumber(at(2026, 3, 8, 12)))).toBe('2026-03-08');
      expect(localDayNumber(at(2026, 3, 9, 0, 30)) - localDayNumber(at(2026, 3, 7, 23, 30))).toBe(2);
      expect(keyDayNumber('2026-03-08')).toBe(localDayNumber(at(2026, 3, 8)));
      expect(keyDayNumber('2026-02-30')).toBeNull();
      expect(keyDayNumber('26-1-1')).toBeNull();
      for (const d of [at(2026, 3, 8), at(2026, 11, 1), at(2028, 2, 29), at(2026, 12, 31)]) {
        const n = localDayNumber(d + 5 * HOUR);
        expect(dayNumberStart(n)).toBe(new Date(new Date(d).getFullYear(), new Date(d).getMonth(), new Date(d).getDate()).getTime());
        expect(localDayNumber(dayNumberStart(n))).toBe(n);
        expect(localDayNumber(dayNumberStart(n + 1) - 1)).toBe(n);
      }
    });
  });

  it('keeps the trend day helpers on local midnights all year', () => {
    inZones(() => {
      const first = localDayNumber(at(2026, 1, 1, 12));
      for (let n = first; n < first + 365; n++) {
        const start = dayStartMs(n);
        const d = new Date(start);
        expect(d.getHours() * 60 + d.getMinutes()).toBe(0);
        expect(dayIndex(start)).toBe(n);
        expect(dayIndex(start - 1)).toBe(n - 1);
      }
    });
  });

  it('knows the weekday from Monday', () => {
    const monday = keyDayNumber('2026-11-02')!;
    expect(weekdayOf(monday)).toBe(0);
    expect(weekdayOf(monday + 6)).toBe(6);
    expect(weekdayOf(monday + 7)).toBe(0);
    expect(mondayOf(monday + 4)).toBe(monday);
    expect(weekdayOf(keyDayNumber('1970-01-01')!)).toBe(3);
    expect(weekdayOf(keyDayNumber('1969-12-29')!)).toBe(0);
  });
});

describe('grades', () => {
  it('give the first grade whose conditions hold', () => {
    expect(gradeFor(0.97, 0, 'completed')).toBe('pinpoint');
    expect(gradeFor(0.99, 1, 'completed')).toBe('sharp');
    expect(gradeFor(0.95, 3, 'completed')).toBe('sharp');
    expect(gradeFor(0.949, 0, 'completed')).toBe('clean');
    expect(gradeFor(0.9, 5, 'completed')).toBe('clean');
    expect(gradeFor(0.82, 9, 'completed')).toBe('steady');
    expect(gradeFor(0.7, 9, 'completed')).toBe('loose');
    expect(gradeFor(0.699, 9, 'completed')).toBe('scattered');
    expect(gradeFor(0, 9, 'completed')).toBe('scattered');
  });

  it('are not given to failed or quit plays', () => {
    expect(gradeFor(0.99, 0, 'failed')).toBeNull();
    expect(gradeFor(0.99, 0, 'quit')).toBeNull();
  });

  it('cover every accuracy from 0 to 1', () => {
    for (let a = 0; a <= 1; a += 0.001) for (const misses of [0, 1]) expect(GRADES.map((g) => g.id)).toContain(gradeFor(a, misses, 'completed'));
  });
});

describe('play streak', () => {
  const run = (days: [number, number, number][], hour: number): PlaySummary[] => days.map(([y, m, d]) => play(at(y, m, d, hour, 30)));

  it('counts consecutive local days across a spring-forward and a fall-back change', () => {
    inZones(() => {
      for (const hour of [0, 23]) {
        const spring = run([[2026, 3, 5], [2026, 3, 6], [2026, 3, 7], [2026, 3, 8], [2026, 3, 9], [2026, 3, 10], [2026, 3, 11]], hour);
        expect(playStreak(spring, at(2026, 3, 11, 23, 50)).current).toBe(7);
        const fall = run([[2026, 10, 30], [2026, 10, 31], [2026, 11, 1], [2026, 11, 2], [2026, 11, 3]], hour);
        expect(playStreak(fall, at(2026, 11, 3, 23, 50)).current).toBe(5);
        // Southern hemisphere changes, and Lord Howe's half-hour change, fall on other dates.
        const south = run([[2026, 4, 3], [2026, 4, 4], [2026, 4, 5], [2026, 4, 6]], hour);
        expect(playStreak(south, at(2026, 4, 6, 23, 50)).current).toBe(4);
        const oct = run([[2026, 10, 3], [2026, 10, 4], [2026, 10, 5]], hour);
        expect(playStreak(oct, at(2026, 10, 5, 23, 50)).current).toBe(3);
      }
    });
  });

  it('counts across month ends, a leap day and a year end', () => {
    inZones(() => {
      expect(playStreak(run([[2027, 1, 30], [2027, 1, 31], [2027, 2, 1]], 12), at(2027, 2, 1, 20)).current).toBe(3);
      expect(playStreak(run([[2027, 2, 28], [2027, 3, 1]], 12), at(2027, 3, 1, 20)).current).toBe(2);
      expect(playStreak(run([[2028, 2, 28], [2028, 2, 29], [2028, 3, 1]], 12), at(2028, 3, 1, 20)).current).toBe(3);
      expect(playStreak(run([[2028, 2, 28], [2028, 3, 1]], 12), at(2028, 3, 1, 20)).current).toBe(1);
      expect(playStreak(run([[2026, 12, 30], [2026, 12, 31], [2027, 1, 1]], 12), at(2027, 1, 1, 20)).current).toBe(3);
    });
  });

  it('keeps the streak alive through today, then lets it end', () => {
    inZones(() => {
      const plays = run([[2026, 5, 1], [2026, 5, 2], [2026, 5, 3]], 20);
      const today = playStreak(plays, at(2026, 5, 3, 21));
      expect(today).toMatchObject({ current: 3, doneToday: true, atRisk: false });
      const morning = playStreak(plays, at(2026, 5, 4, 8));
      expect(morning).toMatchObject({ current: 3, doneToday: false, atRisk: true });
      expect(playStreak(plays, at(2026, 5, 5, 8))).toMatchObject({ current: 0, atRisk: false, longest: 3 });
    });
  });

  it('only counts plays of 60 s or more and reports the longest run', () => {
    inZones(() => {
      const plays = [
        ...run([[2026, 5, 1], [2026, 5, 2], [2026, 5, 3], [2026, 5, 4]], 12),
        play(at(2026, 5, 5, 12), { playedMs: 59_999 }),
        ...run([[2026, 5, 6], [2026, 5, 7]], 12),
        play(at(2026, 5, 7, 18), { playedMs: 60_000 }),
      ];
      expect(playStreak(plays, at(2026, 5, 7, 22))).toMatchObject({ current: 2, longest: 4 });
      expect(playStreak([], at(2026, 5, 7, 22))).toEqual({ current: 0, longest: 0, doneToday: false, atRisk: false });
    });
  });
});

describe('daily streak', () => {
  it('counts consecutive dates of completed daily plays, from the launch date', () => {
    inZones(() => {
      const plays = [
        daily(at(2026, 3, 7, 21), '2026-03-07'),
        daily(at(2026, 3, 8, 21), '2026-03-08'),
        // Started just after midnight but for the previous day's map.
        daily(at(2026, 3, 10, 0, 20), '2026-03-09'),
        daily(at(2026, 3, 10, 22), '2026-03-10'),
        daily(at(2026, 3, 10, 23), '2026-03-10'),
      ];
      expect(dailyStreak(plays, at(2026, 3, 10, 23, 30))).toMatchObject({ current: 4, longest: 4, doneToday: true });
      expect(dailyStreak(plays, at(2026, 3, 11, 9))).toMatchObject({ current: 4, doneToday: false, atRisk: true });
      expect(dailyStreak(plays, at(2026, 3, 12, 9)).current).toBe(0);
    });
  });

  it('skips failed plays, plays from other sources and bad dates', () => {
    const plays = [
      daily(at(2026, 3, 7, 21), '2026-03-07', { status: 'failed' }),
      daily(at(2026, 3, 8, 21), '2026-03-08'),
      play(at(2026, 3, 9, 21)),
      daily(at(2026, 3, 9, 22), 'not-a-date'),
    ];
    expect(dailyStreak(plays, at(2026, 3, 9, 23)).current).toBe(1);
  });
});

describe('weekly goal', () => {
  it('counts minutes in the local Monday-to-Sunday week', () => {
    inZones(() => {
      // Week of Monday 2 to Sunday 8 March 2026. New York springs forward in the early hours of the 8th.
      const plays = [
        play(at(2026, 3, 1, 23, 50), { playedMs: 10 * MIN }), // Sunday of the week before
        play(at(2026, 3, 2, 0, 5), { playedMs: 12 * MIN }),
        play(at(2026, 3, 8, 23, 30), { playedMs: 20 * MIN }),
        play(at(2026, 3, 9, 0, 10), { playedMs: 30 * MIN }), // next Monday
      ];
      const g = weeklyGoal(plays, 60, at(2026, 3, 8, 23, 45));
      expect(g.minutes).toBeCloseTo(32, 9);
      expect(g.fraction).toBeCloseTo(32 / 60, 9);
      expect(g.reached).toBe(false);
      expect(g.daysLeft).toBe(1);
      expect(g.weekStart).toBe(at(2026, 3, 2, 0, 0));
      expect(g.weekEnd).toBe(at(2026, 3, 9, 0, 0));
      const next = weeklyGoal(plays, 60, at(2026, 3, 9, 8));
      expect(next.minutes).toBeCloseTo(30, 9);
      expect(next.daysLeft).toBe(7);
    });
  });

  it('has a week that is 167 hours long when the clocks go forward in New York', () => {
    process.env.TZ = 'America/New_York';
    const g = weeklyGoal([], 60, at(2026, 3, 5, 12));
    expect((g.weekEnd - g.weekStart) / HOUR).toBe(167);
    const back = weeklyGoal([], 60, at(2026, 10, 29, 12));
    expect((back.weekEnd - back.weekStart) / HOUR).toBe(169);
  });

  it('reports no goal as null and caps the fraction at 1', () => {
    inZones(() => {
      const plays = [play(at(2026, 6, 3, 12), { playedMs: 90 * MIN })];
      expect(weeklyGoal(plays, 0, at(2026, 6, 3, 13))).toMatchObject({ fraction: null, reached: false, minutes: 90 });
      expect(weeklyGoal(plays, 60, at(2026, 6, 3, 13))).toMatchObject({ fraction: 1, reached: true });
      expect(weeklyGoal(plays, 90, at(2026, 6, 3, 13)).reached).toBe(true);
    });
  });

  it('counts a Sunday in the week that ends on it', () => {
    inZones(() => {
      const plays = [play(at(2026, 6, 7, 22), { playedMs: 15 * MIN })];
      expect(weeklyGoal(plays, 60, at(2026, 6, 7, 23)).minutes).toBe(15);
      expect(weeklyGoal(plays, 60, at(2026, 6, 8, 1)).minutes).toBe(0);
    });
  });
});

describe('milestones', () => {
  const NOW = at(2026, 6, 10, 15);
  const base = (over: Partial<PlaySummary> = {}) => play(NOW, { status: 'completed', accuracy: 0.5, ...over });
  const check = (history: Parameters<typeof newMilestones>[0], s: PlaySummary, others: PlaySummary[] = []) => newMilestones(history, s, [...others, s]);

  it('names only catalog milestones', () => {
    const everything = [
      base({ maxCombo: 600, counts: { crisp: 50, solid: 0, rough: 0, miss: 0 }, presetLevel: 2, accuracy: 0.95, modeId: 'dynamic', playedMs: 90_000 }),
    ];
    for (const s of everything) for (const id of check({}, s)) expect(MILESTONES[id]).toBeDefined();
  });

  it('first-play needs a completed play', () => {
    expect(check({}, base())).toContain('first-play');
    expect(check({}, base({ status: 'failed' }))).not.toContain('first-play');
    expect(check({ 'first-play': { at: 1, playId: null } }, base())).not.toContain('first-play');
  });

  it('plays-50 and plays-250 count completed plays', () => {
    const others = (n: number, over: Partial<PlaySummary> = {}) => Array.from({ length: n }, (_, i) => play(NOW - (i + 1) * HOUR, { status: 'completed', ...over }));
    expect(check({}, base(), others(48))).not.toContain('plays-50');
    expect(check({}, base(), others(49))).toContain('plays-50');
    expect(check({}, base(), others(49, { status: 'failed' }))).not.toContain('plays-50');
    expect(check({}, base(), others(249))).toContain('plays-250');
    expect(check({}, base(), others(248))).not.toContain('plays-250');
  });

  it('hours-5 and hours-25 add up play time', () => {
    const hour = (n: number, ms = HOUR) => Array.from({ length: n }, (_, i) => play(NOW - (i + 1) * 3 * HOUR, { playedMs: ms }));
    expect(check({}, base({ playedMs: HOUR }), hour(4))).toContain('hours-5');
    expect(check({}, base({ playedMs: HOUR - 1 }), hour(4))).not.toContain('hours-5');
    expect(check({}, base({ playedMs: HOUR }), hour(24))).toContain('hours-25');
    expect(check({}, base({ playedMs: HOUR }), hour(23))).not.toContain('hours-25');
  });

  it('streak-7 and streak-30 count days ending with this play, across a clock change', () => {
    inZones(() => {
      const days = (n: number): PlaySummary[] => Array.from({ length: n }, (_, i) => play(at(2026, 3, 12 - (i + 1), 0, 30)));
      const today = play(at(2026, 3, 12, 0, 30));
      expect(check({}, today, days(6))).toContain('streak-7');
      expect(check({}, today, days(5))).not.toContain('streak-7');
      expect(check({}, today, days(29))).toContain('streak-30');
      expect(check({}, today, days(28))).not.toContain('streak-30');
      // A short play on a new day does not make the streak.
      expect(check({}, play(at(2026, 3, 12, 9), { playedMs: 30_000 }), days(6))).not.toContain('streak-7');
    });
  });

  it('combo-100 and combo-500', () => {
    expect(check({}, base({ maxCombo: 99 }))).toEqual(expect.not.arrayContaining(['combo-100']));
    expect(check({}, base({ maxCombo: 100 }))).toContain('combo-100');
    expect(check({}, base({ maxCombo: 100 }))).not.toContain('combo-500');
    expect(check({}, base({ maxCombo: 500 }))).toEqual(expect.arrayContaining(['combo-100', 'combo-500']));
  });

  it('no-miss needs a Dynamic play of a minute or more that finished without a miss', () => {
    const clean = { modeId: 'dynamic' as const, counts: { crisp: 40, solid: 5, rough: 2, miss: 0 }, playedMs: 60_000 };
    expect(check({}, base(clean))).toContain('no-miss');
    expect(check({}, base({ ...clean, counts: { ...clean.counts, miss: 1 } }))).not.toContain('no-miss');
    expect(check({}, base({ ...clean, playedMs: 59_000 }))).not.toContain('no-miss');
    expect(check({}, base({ ...clean, modeId: 'jumps' }))).not.toContain('no-miss');
    expect(check({}, base({ ...clean, status: 'failed' }))).not.toContain('no-miss');
  });

  it('daily-7 counts different dates of completed daily maps', () => {
    const dates = (n: number) => Array.from({ length: n }, (_, i) => daily(NOW - (i + 1) * DAY, dayNumberKey(localDayNumber(NOW) - (i + 1))));
    const today = daily(NOW, dayNumberKey(localDayNumber(NOW)));
    expect(check({}, today, dates(6))).toContain('daily-7');
    expect(check({}, today, dates(5))).not.toContain('daily-7');
    // The same date twice is one map.
    expect(check({}, today, [...dates(5), daily(NOW - 3 * HOUR, dayNumberKey(localDayNumber(NOW)))])).not.toContain('daily-7');
    // Only a daily play can reach it.
    expect(check({}, base(), dates(8))).not.toContain('daily-7');
  });

  it('drill-better and placement', () => {
    expect(newMilestones({}, base(), [base()], { drillBetter: true })).toContain('drill-better');
    expect(check({}, base())).not.toContain('drill-better');
    expect(check({}, base({ modeId: 'placement' }))).toContain('placement');
    expect(check({}, base({ modeId: 'placement', status: 'quit' }))).not.toContain('placement');
  });

  it('clear-N needs a completed preset-N play with 90% accuracy', () => {
    const lvl = (n: number | null, accuracy: number, status: PlaySummary['status'] = 'completed') =>
      base({ modeId: 'dynamic', presetLevel: n, accuracy, status });
    for (let n = 1; n <= 8; n++) expect(check({}, lvl(n, 0.9))).toContain(`clear-${n}` as MilestoneId);
    expect(check({}, lvl(3, 0.899))).not.toContain('clear-3');
    expect(check({}, lvl(3, 0.95, 'failed'))).not.toContain('clear-3');
    expect(check({}, lvl(null, 0.95))).toEqual(expect.not.arrayContaining(['clear-3']));
    expect(check({}, base({ modeId: 'jumps', presetLevel: 3, accuracy: 0.95 }))).not.toContain('clear-3');
    expect(check({}, lvl(4, 0.95))).not.toContain('clear-3');
  });

  it('reports each milestone once, and records the first time', () => {
    const s = base({ maxCombo: 120 });
    const first = check({}, s);
    expect(first).toEqual(expect.arrayContaining(['first-play', 'combo-100']));
    const stored = recordMilestones({}, first, NOW, s.id);
    expect(stored['combo-100']).toEqual({ at: NOW, playId: s.id });
    expect(check(stored, base({ maxCombo: 130 }))).toEqual([]);
    const later = recordMilestones(stored, ['combo-100', 'combo-500'], NOW + DAY, 'later');
    expect(later['combo-100']!.at).toBe(NOW);
    expect(later['combo-500']).toEqual({ at: NOW + DAY, playId: 'later' });
  });

  it('adds the play to the list when it is missing', () => {
    expect(newMilestones({}, base(), [])).toContain('first-play');
  });
});

describe('suggested Dynamic level', () => {
  const NOW = at(2026, 6, 10, 15);
  const preset = (level: number, accuracy: number, daysAgo = 1, status: PlaySummary['status'] = 'completed') =>
    play(NOW - daysAgo * DAY, { modeId: 'dynamic', presetLevel: level, accuracy, status });
  const rated = (aim: number, speed: number, timing: number): Partial<Record<SkillId, RatingInfo>> => {
    const r = (skill: SkillId, rating: number): RatingInfo => ({ skill, rating, plays: 9, provisional: false, tier: Math.floor(rating) });
    return { aim: r('aim', aim), speed: r('speed', speed), timing: r('timing', timing) };
  };

  it('moves one level from the latest finished preset play in the last 14 days', () => {
    expect(suggestedDynamicLevel([preset(4, 0.95)], {}, NOW)).toBe(5);
    expect(suggestedDynamicLevel([preset(4, 0.949)], {}, NOW)).toBe(4);
    expect(suggestedDynamicLevel([preset(4, 0.85)], {}, NOW)).toBe(4);
    expect(suggestedDynamicLevel([preset(4, 0.849)], {}, NOW)).toBe(3);
    expect(suggestedDynamicLevel([preset(4, 0.99, 1, 'failed')], {}, NOW)).toBe(3);
  });

  it('uses the latest play only, and ignores quits, custom plays, other modes and old plays', () => {
    expect(suggestedDynamicLevel([preset(2, 0.99, 3), preset(6, 0.7, 1)], {}, NOW)).toBe(5);
    expect(suggestedDynamicLevel([preset(5, 0.99, 1, 'quit')], rated(2, 2, 2), NOW)).toBe(2);
    expect(suggestedDynamicLevel([play(NOW - DAY, { modeId: 'dynamic', presetLevel: null, accuracy: 0.99 })], {}, NOW)).toBe(3);
    expect(suggestedDynamicLevel([play(NOW - DAY, { modeId: 'jumps', presetLevel: 6, accuracy: 0.99 })], {}, NOW)).toBe(3);
    expect(suggestedDynamicLevel([preset(6, 0.99, 15)], rated(2.4, 2.4, 2.4), NOW)).toBe(2);
  });

  it('falls back to the rounded mean of the aim, speed and timing ratings, then to 3', () => {
    expect(suggestedDynamicLevel([], rated(4, 5, 4), NOW)).toBe(4);
    expect(suggestedDynamicLevel([], rated(4, 5, 5), NOW)).toBe(5);
    expect(suggestedDynamicLevel([], { aim: rated(6.4, 0, 0).aim! }, NOW)).toBe(6);
    expect(suggestedDynamicLevel([], {}, NOW)).toBe(3);
    expect(suggestedDynamicLevel([], { aim: null }, NOW)).toBe(3);
  });

  it('stays between 1 and 8', () => {
    expect(suggestedDynamicLevel([preset(8, 0.99)], {}, NOW)).toBe(8);
    expect(suggestedDynamicLevel([preset(1, 0.5)], {}, NOW)).toBe(1);
    expect(suggestedDynamicLevel([], rated(12, 12, 12), NOW)).toBe(8);
    expect(suggestedDynamicLevel([], rated(0.2, 0.2, 0.2), NOW)).toBe(1);
  });
});

describe('daily plan', () => {
  const DATE = '2026-06-10';
  const NOW = at(2026, 6, 10, 9);
  const levels = { jumps: 4.5, streams: 3.2 };
  const rating = (skill: SkillId, v: number): RatingInfo => ({ skill, rating: v, plays: 9, provisional: false, tier: Math.floor(v) });
  const ratings = (o: Partial<Record<SkillId, number>>): Partial<Record<SkillId, RatingInfo>> =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, rating(k as SkillId, v!)]));
  const progress = (over: Partial<{ playCount: number; drills: Drill[]; dynamicLevel: number }> = {}) => ({ playCount: 20, drills: [], dynamicLevel: 4, ...over });

  const insight = (key: string, modeId: 'jumps' | 'streams' | 'timing' | 'tracking', over: Partial<Insight> = {}): Insight => {
    const [ruleId, variant] = key.split('|') as [Insight['ruleId'], string | undefined];
    return {
      key: variant ? `${ruleId}:${variant}` : ruleId, ruleId, variant: variant ?? null, severity: 2, n: 100, title: `Title of ${key}`, text: '', basis: '',
      recommendation: { modeId, options: { ...MODES[modeId].defaultOptions }, label: MODES[modeId].label }, baseline: null, ...over,
    };
  };
  const drill = (id: string, ruleId: Drill['ruleId'], variant: string | null, status: Drill['status'] = 'active'): Drill => ({
    id, ruleId, variant, modeId: 'jumps', options: {}, title: 't', createdAt: NOW, baseline: { kind: 'mean', mean: 0, sd: 1, n: 50 }, status, final: null,
  });

  const modules = (plan: ReturnType<typeof buildDailyPlan>) => plan.steps.map((s) => s.launch.modeId);

  it('is a warm-up, two drills and a Dynamic play, with the lengths of the plan', () => {
    const plan = buildDailyPlan(DATE, [insight('long-undershoot', 'jumps')], ratings({ aim: 3, speed: 2, timing: 5 }), progress(), levels, NOW);
    expect(plan.date).toBe(DATE);
    expect(plan.createdAt).toBe(NOW);
    expect(plan.steps.map((s) => s.kind)).toEqual(['warmup', 'drill', 'drill', 'dynamic']);
    expect(plan.steps.map((s) => s.step)).toEqual([0, 1, 2, 3]);
    expect(plan.steps.map((s) => s.launch.lengthSec)).toEqual([120, 90, 90, 120]);
    expect(modules(plan)[0]).toBe('warmup');
    expect(modules(plan)[3]).toBe('dynamic');
    for (const s of plan.steps) {
      expect(MODES[s.launch.modeId].lengthOptions).toContain(s.launch.lengthSec);
      expect(s.launch.levels).toEqual(levels);
      expect(s.title.length).toBeGreaterThan(0);
    }
  });

  it('puts source { plan, date, step } on every launch and fixes the seeds', () => {
    const args = [DATE, [insight('long-undershoot', 'jumps')], ratings({ aim: 3, speed: 2 }), progress(), levels, NOW] as const;
    const a = buildDailyPlan(...args);
    const b = buildDailyPlan(...args);
    a.steps.forEach((s, i) => expect(s.launch.source).toEqual({ kind: 'plan', date: DATE, step: i } satisfies LaunchSource));
    expect(a).toEqual(b);
    const seeds = a.steps.map((s) => s.launch.seed);
    expect(new Set(seeds).size).toBe(4);
    seeds.forEach((v) => expect(Number.isInteger(v) && v >= 0 && v <= 0xffffffff).toBe(true));
    const other = buildDailyPlan('2026-06-11', ...args.slice(1) as [Insight[], never, never, never, number]);
    expect(other.steps.map((s) => s.launch.seed)).not.toEqual(seeds);
  });

  it('runs Dynamic at the suggested level with that level\'s preset', () => {
    for (const level of [1, 4, 8]) {
      const last = buildDailyPlan(DATE, [], {}, progress({ dynamicLevel: level }), levels, NOW).steps[3]!;
      expect(last.launch).toMatchObject({ modeId: 'dynamic', presetLevel: level, lengthSec: 120, mods: [], drillId: null });
      expect(last.launch.difficulty).toEqual(LEVEL_PRESETS[level - 1]!.difficulty);
      expect(last.title).toBe(`Level ${level}`);
    }
    expect(buildDailyPlan(DATE, [], {}, progress({ dynamicLevel: 11 }), levels, NOW).steps[3]!.launch.presetLevel).toBe(8);
  });

  it('with fewer than 3 plays gives Jumps and Streams', () => {
    for (const playCount of [0, 2]) {
      const plan = buildDailyPlan(DATE, [insight('timing-bias|late', 'timing')], ratings({ timing: 1 }), progress({ playCount }), {}, NOW);
      expect(modules(plan)).toEqual(['warmup', 'jumps', 'streams', 'dynamic']);
      expect(plan.steps[1]!.insightKey).toBeNull();
    }
    expect(modules(buildDailyPlan(DATE, [], {}, progress({ playCount: 3 }), {}, NOW))).toEqual(['warmup', 'jumps', 'streams', 'dynamic']);
  });

  it('with no insight uses the two lowest-rated skills', () => {
    const plan = buildDailyPlan(DATE, [], ratings({ aim: 4, speed: 3, tracking: 2, timing: 1.5, spin: 6 }), progress(), {}, NOW);
    expect(modules(plan).slice(1, 3)).toEqual(['timing', 'tracking']);
    expect(plan.steps[1]!.insightKey).toBeNull();
    expect(plan.steps[1]!.launch.options).toEqual(MODES.timing.defaultOptions);
    // With no ratings either, the plan still has two different modules.
    const bare = buildDailyPlan(DATE, [], {}, progress(), {}, NOW);
    expect(modules(bare).slice(1, 3)).toEqual(['jumps', 'streams']);
  });

  it('with one insight drills it first, then the lowest-rated skill on another module', () => {
    const one = insight('long-undershoot|s4v1', 'jumps', { recommendation: { modeId: 'jumps', options: { distanceFocus: 'long', directionFocus: null }, label: 'Jumps, long distances' } });
    const plan = buildDailyPlan(DATE, [one], ratings({ aim: 2, speed: 3, tracking: 5 }), progress(), levels, NOW);
    const [, a, b] = plan.steps;
    expect(a!.launch.modeId).toBe('jumps');
    expect(a!.launch.options.distanceFocus).toBe('long');
    expect(a!.insightKey).toBe('long-undershoot:s4v1');
    expect(a!.title).toBe('Title of long-undershoot|s4v1');
    // Aim is the lowest, but jumps is taken, so the next lowest skill gives the module.
    expect(b!.launch.modeId).toBe('streams');
    expect(b!.insightKey).toBeNull();
  });

  it('with two insights on the same module takes the second from another source', () => {
    const list = [insight('long-undershoot', 'jumps'), insight('short-overshoot', 'jumps'), insight('timing-bias|late', 'timing')];
    expect(modules(buildDailyPlan(DATE, list, ratings({ aim: 1, tracking: 2 }), progress(), {}, NOW)).slice(1, 3)).toEqual(['jumps', 'timing']);
    // Without a third insight on another module, the lowest-rated skill steps in.
    const two = buildDailyPlan(DATE, list.slice(0, 2), ratings({ aim: 1, tracking: 2, speed: 4 }), progress(), {}, NOW);
    expect(modules(two).slice(1, 3)).toEqual(['jumps', 'tracking']);
    expect(two.steps[2]!.insightKey).toBeNull();
    expect(two.steps[1]!.insightKey).toBe('long-undershoot');
  });

  it('uses an active drill when its rule and variant match', () => {
    const list = [insight('direction-drift|o2:bias', 'jumps'), insight('timing-bias|late', 'timing')];
    const plan = buildDailyPlan(
      DATE, list, {}, progress({ drills: [drill('d1', 'direction-drift', 'o2:bias'), drill('d2', 'timing-bias', 'early'), drill('d3', 'timing-bias', 'late', 'archived')] }), {}, NOW,
    );
    expect(plan.steps[1]!.launch.drillId).toBe('d1');
    expect(plan.steps[2]!.launch.drillId).toBeNull();
    const matched = buildDailyPlan(DATE, list, {}, progress({ drills: [drill('d4', 'timing-bias', 'late')] }), {}, NOW);
    expect(matched.steps[2]!.launch.drillId).toBe('d4');
    expect(matched.steps[1]!.launch.drillId).toBeNull();
  });

  it('skips insights without a module', () => {
    const rest = insight('long-session', 'jumps', { recommendation: null });
    const plan = buildDailyPlan(DATE, [rest, insight('timing-bias|late', 'timing')], ratings({ aim: 1 }), progress(), {}, NOW);
    expect(modules(plan).slice(1, 3)).toEqual(['timing', 'jumps']);
  });

  it('maps every skill to its module', () => {
    expect(SKILL_MODULE).toEqual({ aim: 'jumps', speed: 'streams', tracking: 'tracking', precision: 'precision', timing: 'timing', reading: 'reading', spin: 'spinning' });
  });

  it('counts a step as done when a play from it completed or ran 60 s', () => {
    const plan = buildDailyPlan(DATE, [], {}, progress(), {}, NOW);
    const from = (step: number, over: Partial<PlaySummary>, date = DATE) =>
      play(NOW, { ...over, launch: { ...plan.steps[step]!.launch, source: { kind: 'plan', date, step } } });
    expect(isPlanStepDone([from(0, { status: 'completed', playedMs: 30_000 })], DATE, 0)).toBe(true);
    expect(isPlanStepDone([from(1, { status: 'quit', playedMs: 60_000 })], DATE, 1)).toBe(true);
    expect(isPlanStepDone([from(1, { status: 'failed', playedMs: 59_999 })], DATE, 1)).toBe(false);
    expect(isPlanStepDone([from(2, { status: 'completed' }, '2026-06-09')], DATE, 2)).toBe(false);
    expect(isPlanStepDone([from(2, { status: 'completed' })], DATE, 3)).toBe(false);
    expect(isPlanStepDone([play(NOW, { status: 'completed' })], DATE, 0)).toBe(false);
    expect(planStepsDone(plan, [from(0, { status: 'completed' }), from(3, { status: 'quit', playedMs: 70_000 })])).toEqual([true, false, false, true]);
  });
});

describe('snoozing an insight', () => {
  beforeEach(async () => {
    await deleteDatabase();
  });

  it('ends 7 days from now by default and after the given days otherwise', () => {
    expect(snoozeUntil(undefined, 1000)).toBe(1000 + 7 * DAY);
    expect(snoozeUntil(2, 1000)).toBe(1000 + 2 * DAY);
    expect(isSnoozed({ a: 2000 }, 'a', 1999)).toBe(true);
    expect(isSnoozed({ a: 2000 }, 'a', 2000)).toBe(false);
    expect(isSnoozed({ a: 2000 }, 'b', 0)).toBe(false);
  });

  it('is stored in the insightSnooze meta key and read back into detectInsights', async () => {
    const now = 1_800_000_000_000;
    const after = await snoozeInsight('long-undershoot:s4v1', snoozeUntil(undefined, now), now);
    expect(after).toEqual({ 'long-undershoot:s4v1': now + 7 * DAY });
    await snoozeInsight('timing-bias:late', snoozeUntil(2, now), now);
    expect(await getInsightSnooze()).toEqual({ 'long-undershoot:s4v1': now + 7 * DAY, 'timing-bias:late': now + 2 * DAY });
    expect(await getMeta('insightSnooze')).toEqual(await getInsightSnooze());
  });

  it('drops snoozes that have run out the next time one is written', async () => {
    const now = 1_800_000_000_000;
    await snoozeInsight('a', snoozeUntil(1, now), now);
    await snoozeInsight('b', snoozeUntil(7, now + 2 * DAY), now + 2 * DAY);
    expect(Object.keys(await getInsightSnooze())).toEqual(['b']);
  });
});

describe('milestones in savePlay', () => {
  beforeEach(async () => {
    await deleteDatabase();
  });

  const NOW = 1_800_000_000_000;
  const result = (seed: number, startedAt: number, over: Record<string, unknown> = {}) => ({
    ...makeFixture({ seed, objects: 30, startedAt, presetLevel: 3, lengthSec: 45 }).result,
    ...over,
  });

  it('writes new milestones on the summary and in the meta key, in the same save', async () => {
    const out = await savePlay(result(1, NOW - HOUR, { status: 'completed', accuracy: 0.5, maxCombo: 130 }), NOW);
    expect(out!.summary.milestones).toEqual(expect.arrayContaining(['first-play', 'combo-100']));
    const stored = await getMilestones();
    expect(stored['first-play']).toEqual({ at: NOW, playId: out!.summary.id });
    expect(stored['combo-100']!.playId).toBe(out!.summary.id);
    expect((await getSummary(out!.summary.id))!.milestones).toEqual(out!.summary.milestones);
  });

  it('does not report a milestone twice', async () => {
    await savePlay(result(1, NOW - 3 * HOUR, { status: 'completed', accuracy: 0.5, maxCombo: 130 }), NOW - 2 * HOUR);
    const second = await savePlay(result(2, NOW - HOUR, { status: 'completed', accuracy: 0.5, maxCombo: 140 }), NOW);
    expect(second!.summary.milestones).toEqual([]);
    expect(Object.keys(await getMilestones()).sort()).toEqual(['combo-100', 'first-play']);
  });

  it('counts the plays already stored, so the 50th completed play earns plays-50', async () => {
    for (let i = 0; i < 49; i++) {
      await savePlay(result(i + 1, NOW - (60 - i) * HOUR, { status: 'completed', accuracy: 0.5, maxCombo: 5 }), NOW - (60 - i) * HOUR + 1000);
    }
    expect(Object.keys(await getMilestones())).not.toContain('plays-50');
    const fiftieth = await savePlay(result(99, NOW - HOUR, { status: 'completed', accuracy: 0.5, maxCombo: 5 }), NOW);
    expect(fiftieth!.summary.milestones).toContain('plays-50');
  }, 30_000);

  it('saves a play with no milestone without touching the meta key', async () => {
    const out = await savePlay(result(1, NOW - HOUR, { status: 'failed', maxCombo: 3 }), NOW);
    expect(out!.summary.milestones).toEqual([]);
    expect(await getMeta('milestones')).toBeUndefined();
  });
});
