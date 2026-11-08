// Data for the charts and sentences on the Home, Results, Replay and Stats pages. Every function is pure and
// returns plain objects: `ratingHistory` (a line per skill), `radarData` (seven axes), `throughputScatter` (points),
// `weeklyChanges` (sentences about what moved this week), `playVsAverage` (deltas for one play),
// `fatigueCurve` (rolling accuracy over time) and `demandTimeline` (level-scale demand per bin of a map).

import { t } from '../shared/i18n';
import type { PlayData, PlaySummary } from '../data/schema';
import { JUDGMENTS, MODES, SKILLS } from '../shared/catalog';
import type { HitRecord, MapSection, ObjectFeatures, PlayableMap, SkillId } from '../shared/types';
import { dayNumberStart, localDayNumber } from './calendar';
import { distinct } from './contrast';
import type { ContrastUnit } from './contrast';
import { itemsFromMap, mapDemand, SKILL_ORDER } from './demand';
import { buildRows } from './insights';
import type { Rows } from './insights';
import { skillRating } from './ratings';
import type { RatingInfo } from './ratings';
import { aggOf, mean, welch } from './stats';
import { throughputBuckets } from './throughput';

const DAY = 86_400_000;
const round2 = (v: number): number => Math.round(v * 100) / 100;

/* ----------------------------------------------------- rating history */

export interface RatingPoint {
  /** Local day number. */
  day: number;
  /** End of that day, or `now` for today. */
  t: number;
  /** The skill's rating at the end of the day, or null before it had any score. */
  rating: number | null;
  provisional: boolean;
  tier: number;
}
export interface RatingSeries {
  skill: SkillId;
  points: RatingPoint[];
}

/** Each skill's rating at the end of each of the last `days` local days, today included. One series per skill. */
export function ratingHistory(summaries: readonly PlaySummary[], days: number, now = Date.now()): RatingSeries[] {
  const today = localDayNumber(now);
  const count = Math.max(1, Math.floor(days));
  const sorted = [...summaries].sort((a, b) => a.startedAt - b.startedAt);
  const series: RatingSeries[] = SKILL_ORDER.map((skill) => ({ skill, points: [] }));
  for (let day = today - count + 1; day <= today; day++) {
    const cutoff = day === today ? now : dayNumberStart(day + 1) - 1;
    const upTo = sorted.filter((s) => s.startedAt <= cutoff);
    for (const line of series) {
      const r = skillRating(line.skill, upTo, cutoff);
      line.points.push({ day, t: cutoff, rating: r ? r.rating : null, provisional: r ? r.provisional : false, tier: r ? r.tier : 0 });
    }
  }
  return series;
}

/* ---------------------------------------------------------------- radar */

export interface RadarAxis {
  skill: SkillId;
  label: string;
  /** 0 when the skill has no score yet. */
  rating: number;
  tier: number;
  /** Fewer than 5 plays behind it. Draw it dashed or faded. */
  provisional: boolean;
  hasData: boolean;
}

/** The seven skills in the catalog order. Skills without a score come back with rating 0 and hasData false. */
export function radarData(ratings: Record<SkillId, RatingInfo | null>): RadarAxis[] {
  return SKILL_ORDER.map((skill) => {
    const r = ratings[skill];
    return {
      skill,
      label: SKILLS[skill].label,
      rating: r ? r.rating : 0,
      tier: r ? r.tier : 0,
      provisional: r ? r.provisional : false,
      hasData: r !== null,
    };
  });
}

/** A round upper bound for the radar's axes: the highest rating rounded up, and at least 4. */
export const radarMax = (axes: readonly RadarAxis[]): number => Math.max(4, Math.ceil(Math.max(0, ...axes.map((a) => a.rating))));

/* ----------------------------------------------------------- throughput */

export interface ThroughputPoint {
  /** Distance bin and gap bin, as in the summary. */
  key: string;
  /** Jumps behind the point. */
  n: number;
  /** Nominal difficulty, log2(D / 2r + 1), in bits. */
  nominalId: number;
  /** Effective difficulty from where the clicks landed, in bits. */
  ide: number;
  /** Bits per second. */
  tp: number;
}

/** One point per distance-and-gap bucket with 8 or more jumps, for a scatter of nominal against effective difficulty. */
export function throughputScatter(source: Rows | readonly PlayData[]): ThroughputPoint[] {
  const rows = Array.isArray(source) ? buildRows(source as readonly PlayData[]) : (source as Rows);
  return throughputBuckets(rows.taps.map((tap) => tap.rec)).map((b) => ({
    key: b.key,
    n: b.n,
    nominalId: round2(b.idNominal),
    ide: round2(b.ide),
    tp: round2(b.tp),
  }));
}

/* -------------------------------------------------------- weekly changes */

export type WeeklyMetricId = 'accuracy' | 'timingSd' | 'timingMean' | 'radial' | 'throughput' | 'minutes';

interface WeeklyMetric {
  id: WeeklyMetricId;
  unit: ContrastUnit;
  better: 'up' | 'down' | null;
  /** The value of one play, or null when the play has none. Not used for minutes. */
  value?(s: PlaySummary): number | null;
  /** The number as the sentence shows it. */
  show(v: number): string;
  sentence(before: string, after: string): string;
}

const whole = (v: number): string => String(Math.round(v));

const WEEKLY_METRICS: WeeklyMetric[] = [
  {
    id: 'accuracy',
    unit: 'share',
    better: 'up',
    value: (s) => s.accuracy,
    show: (v) => `${whole(v * 100)}%`,
    sentence: (a, b) => t('Your accuracy went from {a} to {b} this week.', { a, b }),
  },
  {
    id: 'timingSd',
    unit: 'ms',
    better: 'down',
    value: (s) => (s.timing.n >= 20 ? s.timing.sd : null),
    show: (v) => `${whole(v)} ms`,
    sentence: (a, b) => t('Your timing spread went from {a} to {b} this week.', { a, b }),
  },
  {
    id: 'timingMean',
    unit: 'ms',
    better: 'down',
    value: (s) => (s.timing.n >= 20 ? Math.abs(s.timing.mean) : null),
    show: (v) => `${whole(v)} ms`,
    sentence: (a, b) => t('Your timing offset went from {a} to {b} this week.', { a, b }),
  },
  {
    id: 'radial',
    unit: 'width',
    better: 'down',
    value: (s) => (s.aim.n >= 20 ? s.aim.radialMean : null),
    show: (v) => `${whole(v * 50)}%`,
    sentence: (a, b) => t('Your distance from the center of the target went from {a} to {b} of its width this week.', { a, b }),
  },
  {
    id: 'throughput',
    unit: 'bits',
    better: 'up',
    value: (s) => s.throughput?.bitsPerSec ?? null,
    show: (v) => v.toFixed(1),
    sentence: (a, b) => t('Your throughput went from {a} to {b} bits per second this week.', { a, b }),
  },
  {
    id: 'minutes',
    unit: 'minutes',
    better: null,
    show: (v) => whole(v),
    sentence: (a, b) => t('Your practice went from {a} to {b} minutes a day this week.', { a, b }),
  },
];

export interface WeeklyChange {
  id: WeeklyMetricId;
  /** Mean over days 8 to 35 and over the last 7 days, in the metric's own unit (share, ms, radii, bits, minutes). */
  before: number;
  after: number;
  diff: number;
  t: number;
  nBefore: number;
  nAfter: number;
  /** null for minutes, where neither direction is better. */
  improved: boolean | null;
  /** For example "Your timing spread went from 21 ms to 17 ms this week." */
  text: string;
}

/**
 * The last 7 days (today and the 6 before, in local days) against the 28 days before them. A metric is reported when
 * both sides have 3 plays, Welch's |t| is 2 or more, and the two displayed numbers differ enough (see `distinct`).
 */
export function weeklyChanges(summaries: readonly PlaySummary[], now: number): WeeklyChange[] {
  const today = localDayNumber(now);
  const thisFrom = dayNumberStart(today - 6);
  const beforeFrom = dayNumberStart(today - 34);
  const recent = summaries.filter((s) => s.startedAt >= thisFrom && s.startedAt <= now);
  const earlier = summaries.filter((s) => s.startedAt >= beforeFrom && s.startedAt < thisFrom);
  if (recent.length < 3 || earlier.length < 3) return [];

  const dailyMinutes = (list: PlaySummary[], firstDay: number, days: number): number[] => {
    const out = new Array<number>(days).fill(0);
    for (const s of list) {
      const i = localDayNumber(s.startedAt) - firstDay;
      if (i >= 0 && i < days) out[i]! += s.playedMs / 60_000;
    }
    return out;
  };

  const out: WeeklyChange[] = [];
  for (const m of WEEKLY_METRICS) {
    let after: number[];
    let before: number[];
    if (m.id === 'minutes') {
      after = dailyMinutes(recent, today - 6, 7);
      before = dailyMinutes(earlier, today - 34, 28);
    } else {
      const pick = (list: PlaySummary[]): number[] =>
        list.map((s) => m.value!(s)).filter((v): v is number => v !== null && Number.isFinite(v));
      after = pick(recent);
      before = pick(earlier);
      if (after.length < 3 || before.length < 3) continue;
    }
    const a = aggOf(after);
    const b = aggOf(before);
    const w = welch(a, b);
    if (!(Math.abs(w.t) >= 2) || !distinct(b.mean, a.mean, m.unit)) continue;
    out.push({
      id: m.id,
      before: b.mean,
      after: a.mean,
      diff: w.diff,
      t: w.t,
      nBefore: b.n,
      nAfter: a.n,
      improved: m.better === null ? null : m.better === 'up' ? w.diff > 0 : w.diff < 0,
      text: m.sentence(m.show(b.mean), m.show(a.mean)),
    });
  }
  return out;
}

/* -------------------------------------------------------- play vs average */

export type PlayDeltaId = 'accuracy' | 'timingSd' | 'radial' | 'score';

export interface PlayDelta {
  id: PlayDeltaId;
  label: string;
  /** This play and the average of the peers. Accuracy is a share, timing spread is ms, radial is target radii. */
  value: number;
  average: number;
  /** value - average */
  diff: number;
  /** true when this play is better than the average. */
  better: boolean;
}

export interface PlayVsAverage {
  /** Peer plays behind the averages. */
  n: number;
  /** Who the peers are: same mode and Dynamic level, or the same module. */
  peers: string;
  /** The peers as a sentence for a heading, such as "Compared with 12 earlier Jumps plays". */
  text: string;
  deltas: PlayDelta[];
}

const DELTAS: { id: PlayDeltaId; label: string; better: 'up' | 'down'; value: (s: PlaySummary) => number | null }[] = [
  {
    id: 'accuracy',
    get label() {
      return t('Accuracy');
    },
    better: 'up',
    value: (s) => s.accuracy,
  },
  {
    id: 'timingSd',
    get label() {
      return t('Timing spread');
    },
    better: 'down',
    value: (s) => (s.timing.n >= 20 ? s.timing.sd : null),
  },
  {
    id: 'radial',
    get label() {
      return t('Distance from the center');
    },
    better: 'down',
    value: (s) => (s.aim.n >= 20 ? s.aim.radialMean : null),
  },
  {
    id: 'score',
    get label() {
      return t('Score');
    },
    better: 'up',
    value: (s) => s.score,
  },
];

/**
 * A play against the player's completed plays of the same mode and Dynamic level (or the same module) from the 30
 * days before it, under the same scoring version. Null below 3 peers. A delta is left out when fewer than 3 peers
 * have the number.
 */
export function playVsAverage(summary: PlaySummary, summaries: readonly PlaySummary[]): PlayVsAverage | null {
  const since = summary.startedAt - 30 * DAY;
  const peers = summaries.filter(
    (s) =>
      s.id !== summary.id &&
      s.status === 'completed' &&
      s.modeId === summary.modeId &&
      s.presetLevel === summary.presetLevel &&
      (s.scoringVersion ?? 1) === (summary.scoringVersion ?? 1) &&
      s.startedAt >= since &&
      s.startedAt < summary.startedAt,
  );
  if (peers.length < 3) return null;
  const deltas: PlayDelta[] = [];
  for (const d of DELTAS) {
    const own = d.value(summary);
    const others = peers.map(d.value).filter((v): v is number => v !== null && Number.isFinite(v));
    if (own === null || others.length < 3) continue;
    const average = mean(others);
    deltas.push({
      id: d.id,
      label: d.label,
      value: own,
      average,
      diff: own - average,
      better: d.better === 'up' ? own > average : own < average,
    });
  }
  if (deltas.length === 0) return null;
  const n = peers.length;
  let peersText: string;
  let text: string;
  if (summary.modeId !== 'dynamic') {
    peersText = MODES[summary.modeId].label;
    text = t('Compared with {n} earlier {mode} plays', { n, mode: peersText });
  } else if (summary.presetLevel !== null) {
    peersText = t('Level {level}', { level: summary.presetLevel });
    text = t('Compared with {n} earlier plays at {level}', { n, level: peersText });
  } else {
    peersText = t('custom Dynamic');
    text = t('Compared with {n} earlier custom Dynamic plays', { n });
  }
  return { n, peers: peersText, text, deltas };
}

/* ---------------------------------------------------------------- fatigue */

export interface FatiguePoint {
  /** Time of the last object in the window, ms into the play. */
  t: number;
  /** Index of that object among the records used. */
  index: number;
  /** Mean judgment weight over the window, 0 to 1. */
  accuracy: number;
}

export const FATIGUE_WINDOW = 20;

/** Rolling accuracy over 20 objects against time. Records after a pause are left out. Empty below 20 records. */
export function fatigueCurve(records: readonly HitRecord[]): FatiguePoint[] {
  const usable = records.filter((r) => !r.afterPause).sort((a, b) => a.time - b.time || a.index - b.index);
  if (usable.length < FATIGUE_WINDOW) return [];
  const weights = usable.map((r) => JUDGMENTS[r.judgment].weight);
  const out: FatiguePoint[] = [];
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += weights[i]!;
    if (i >= FATIGUE_WINDOW) sum -= weights[i - FATIGUE_WINDOW]!;
    if (i >= FATIGUE_WINDOW - 1) out.push({ t: usable[i]!.time, index: i, accuracy: sum / FATIGUE_WINDOW });
  }
  return out;
}

/* ---------------------------------------------------------- demand timeline */

export interface DemandBin {
  start: number;
  end: number;
  /** Level-scale demand of the jumps in the bin, or null when it has none. */
  aim: number | null;
  /** Same for stream notes. */
  speed: number | null;
  /** The mean of the aim, speed, tracking and spin levels the bin has, or null when it has none. */
  overall: number | null;
  /** Objects starting in the bin. */
  n: number;
}

export interface DemandTimeline {
  binMs: number;
  bins: DemandBin[];
  sections: Pick<MapSection, 'start' | 'end' | 'role' | 'focus' | 'intensity'>[];
}

/** Demand per bin of a map on the level scale (Level 4 is about 4), for the difficulty graph. Bins have no minimum count. */
export function demandTimeline(
  map: Pick<PlayableMap, 'objects' | 'sections' | 'mods' | 'durationMs'>,
  features: readonly ObjectFeatures[],
  binMs = 2000,
): DemandTimeline {
  const step = binMs > 0 ? binMs : 2000;
  const items = itemsFromMap(map as PlayableMap, features);
  const count = Math.max(1, Math.ceil(map.durationMs / step));
  const groups: (typeof items)[] = Array.from({ length: count }, () => []);
  map.objects.forEach((o, i) => {
    const bin = Math.min(count - 1, Math.max(0, Math.floor(o.time / step)));
    groups[bin]!.push(items[i]!);
  });
  const none = { aim: 1, speed: 1, tracking: 1, precision: 1, timing: 1, reading: 1, spin: 1 };
  const bins = groups.map((list, b): DemandBin => {
    const d = mapDemand(list, map.mods, none);
    const levels = (['aim', 'speed', 'tracking', 'spin'] as const).map((k) => d[k]?.level).filter((v): v is number => v !== undefined);
    return {
      start: b * step,
      end: (b + 1) * step,
      aim: d.aim ? round2(d.aim.level) : null,
      speed: d.speed ? round2(d.speed.level) : null,
      overall: levels.length ? round2(mean(levels)) : null,
      n: list.length,
    };
  });
  return {
    binMs: step,
    bins,
    sections: (map.sections ?? []).map((s) => ({ start: s.start, end: s.end, role: s.role, focus: s.focus, intensity: s.intensity })),
  };
}
