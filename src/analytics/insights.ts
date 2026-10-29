// Insight rules. Each rule reads the player's recent taps and says something specific, with numbers,
// and names a module and options to train it. The rules are in PLAN section 11.
//
// A rule has two parts. `detect` decides whether the rule fires and with what numbers. `sample`
// returns the same measurement on any set of rows, which drills use for their before and after.

import type { DrillBaseline, PlayData, PlaySummary, RuleId } from '../data/schema';
import { DEFAULT_DIFFICULTY, MODES } from '../shared/catalog';
import type { HitRecord, LaunchRequest, ModeId, ModuleId, ModuleOptions } from '../shared/types';
import { isJump, isStreamNote, isTap, octantOf, tapMissed } from './buckets';
import { basisText, insightText, lateralSide, OCTANT_PHRASE, recommendationLabel, ruleTitle } from './insightCopy';
import type { Params } from './insightCopy';
import { SESSION_GAP_MS, groupSessions } from './sessions';
import { aggOf, logSdZ, mean, sd, twoPropZ, welch } from './stats';

export const INSIGHT_WINDOW_DAYS = 30;
export const MAX_TAPS = 3000;
const DAY = 86_400_000;

/* --------------------------------------------------------------- rows */

/** One judged object with the numbers rules need, errors in radii. */
export interface Tap {
  rec: HitRecord;
  play: PlaySummary;
  along: number | null;
  lateral: number | null;
  radial: number | null;
  timing: number | null;
  missed: boolean;
}

export interface Rows {
  taps: Tap[];
  sliders: Tap[];
  spinners: Tap[];
  plays: PlaySummary[];
}

const norm = (v: number | null, radius: number): number | null => (v === null ? null : v / radius);

export function buildRows(plays: readonly PlayData[]): Rows {
  const rows: Rows = { taps: [], sliders: [], spinners: [], plays: plays.map((p) => p.summary) };
  for (const { summary, records } of plays) {
    for (const rec of records) {
      if (rec.afterPause) continue;
      const tap: Tap = {
        rec,
        play: summary,
        along: norm(rec.aimAlong, rec.radius),
        lateral: norm(rec.aimLateral, rec.radius),
        radial: norm(rec.aimRadial, rec.radius),
        timing: rec.timingError,
        missed: tapMissed(rec),
      };
      if (rec.kind === 'spinner') rows.spinners.push(tap);
      else {
        rows.taps.push(tap);
        if (rec.kind === 'slider') rows.sliders.push(tap);
      }
    }
  }
  return rows;
}

/** Plays from the last 30 days, newest first, until 3000 taps are reached. Null below 3 plays. */
export function selectWindow(plays: readonly PlayData[], now: number): PlayData[] | null {
  const since = now - INSIGHT_WINDOW_DAYS * DAY;
  const recent = plays.filter((p) => p.summary.startedAt >= since && p.summary.startedAt <= now).sort((a, b) => b.summary.startedAt - a.summary.startedAt);
  if (recent.length < 3) return null;
  const out: PlayData[] = [];
  let taps = 0;
  for (const p of recent) {
    out.push(p);
    taps += p.records.filter(isTap).length;
    if (taps >= MAX_TAPS) break;
  }
  return out;
}

/* ------------------------------------------------------------ samples */

export type Sample =
  | { kind: 'mean'; values: number[] }
  | { kind: 'rate'; hits: number; n: number }
  | { kind: 'sd'; values: number[] };

export const sampleN = (s: Sample): number => (s.kind === 'rate' ? s.n : s.values.length);

export function baselineOf(s: Sample): DrillBaseline {
  if (s.kind === 'rate') return { kind: 'rate', rate: s.n ? s.hits / s.n : 0, n: s.n };
  if (s.kind === 'sd') return { kind: 'sd', sd: sd(s.values), n: s.values.length };
  const a = aggOf(s.values);
  return { kind: 'mean', mean: a.mean, sd: a.sd, n: a.n };
}

const nonNull = (xs: (number | null)[]): number[] => xs.filter((x): x is number => x !== null && Number.isFinite(x));

/* ------------------------------------------------------------- types */

export interface Recommendation {
  modeId: ModeId;
  options: ModuleOptions;
  label: string;
}

export interface Insight {
  /** Rule id plus variant. Stable between runs. */
  key: string;
  ruleId: RuleId;
  variant: string | null;
  severity: number;
  n: number;
  title: string;
  text: string;
  basis: string;
  recommendation: Recommendation | null;
  /** The measurement a drill compares against. Null for rules without one. */
  baseline: DrillBaseline | null;
}

interface Detection {
  variant: string | null;
  /** Effect size divided by the rule's threshold. 1 is just over the line. */
  ratio: number;
  n: number;
  params: Params;
  modeId: ModeId | null;
  options: ModuleOptions;
  sample: Sample | null;
}

export type Good = 'zero' | 'up' | 'down';

interface Rule {
  id: RuleId;
  minN: number;
  detect(rows: Rows, scale: number): Detection | null;
  /** The measurement for a variant, or null when the rule has no drill. */
  sample(rows: Rows, variant: string | null): Sample | null;
  good(variant: string | null): Good;
  /** The change in the sample's unit that counts as the rule's threshold. */
  threshold(variant: string | null): number;
}

function need(minN: number, scale: number): number {
  return Math.max(1, Math.ceil(minN * scale));
}

function withDefaults(modeId: ModeId, options: ModuleOptions): ModuleOptions {
  return { ...MODES[modeId].defaultOptions, ...options };
}

interface MeanTest {
  mean: number;
  sd: number;
  n: number;
}

/** Passes when the mean is at least `thr` in the wanted direction and clearly away from zero. */
function meanTest(values: number[], minN: number, thr: number, dir: -1 | 0 | 1, scale: number): MeanTest | null {
  if (values.length < need(minN, scale)) return null;
  const a = aggOf(values);
  const m = a.mean;
  const fits = dir === 0 ? Math.abs(m) >= thr : dir < 0 ? m <= -thr : m >= thr;
  if (!fits) return null;
  if (Math.abs(m) < (2 * a.sd) / Math.sqrt(a.n)) return null;
  return { mean: m, sd: a.sd, n: a.n };
}

/* ------------------------------------------------------------- rules */

const isLongFast = (t: Tap): boolean => {
  const f = t.rec.features;
  return isJump(t.rec) && t.along !== null && f.spacing !== null && f.velocity !== null && f.spacing >= 4.5 && f.velocity >= 0.9;
};
const isShort = (t: Tap): boolean => {
  const f = t.rec.features;
  return isJump(t.rec) && t.along !== null && f.spacing !== null && f.spacing >= 1 && f.spacing < 2.5;
};
const longFastAlong = (r: Rows) => nonNull(r.taps.filter(isLongFast).map((t) => t.along));
const shortAlong = (r: Rows) => nonNull(r.taps.filter(isShort).map((t) => t.along));

const pctWidth = (radii: number) => Math.round(Math.abs(radii) * 50);

function jumpsRec(options: ModuleOptions) {
  return { modeId: 'jumps' as ModeId, options: withDefaults('jumps', options) };
}

const streamNotesFast = (r: Rows) => nonNull(r.taps.filter((t) => isStreamNote(t.rec) && (t.rec.features.gapMs ?? 999) < 140).map((t) => t.timing));
const lateStream = (r: Rows) => nonNull(r.taps.filter((t) => isStreamNote(t.rec) && t.rec.features.runIndex >= 9).map((t) => t.timing));
const earlyStream = (r: Rows) => nonNull(r.taps.filter((t) => isStreamNote(t.rec) && t.rec.features.runIndex >= 1 && t.rec.features.runIndex <= 4).map((t) => t.timing));

const turnTaps = (r: Rows) => r.taps.filter((t) => isJump(t.rec) && t.rec.features.spacing !== null && t.rec.features.spacing >= 2.5 && t.rec.features.turnAngle !== null);
const sharpTaps = (r: Rows) => turnTaps(r).filter((t) => t.rec.features.turnAngle! >= 100);
const wideTaps = (r: Rows) => turnTaps(r).filter((t) => t.rec.features.turnAngle! < 100);

const rate = (taps: Tap[]): Sample => ({ kind: 'rate', hits: taps.filter((t) => t.missed).length, n: taps.length });

function octantTaps(r: Rows, octant: number): Tap[] {
  return r.taps.filter((t) => isJump(t.rec) && t.lateral !== null && t.rec.features.direction !== null && octantOf(t.rec.features.direction) === octant);
}
const parseOctant = (variant: string | null): number => Number(variant?.match(/^o(\d)/)?.[1] ?? 0);

const rules: Rule[] = [
  {
    id: 'long-undershoot',
    minN: 40,
    detect(rows, scale) {
      const values = longFastAlong(rows);
      const t = meanTest(values, 40, 0.25, -1, scale);
      if (!t) return null;
      return {
        variant: null, ratio: Math.abs(t.mean) / 0.25, n: t.n, params: { pct: pctWidth(t.mean) },
        ...jumpsRec({ distanceFocus: 'long' }), sample: { kind: 'mean', values },
      };
    },
    sample: (r) => ({ kind: 'mean', values: longFastAlong(r) }),
    good: () => 'zero',
    threshold: () => 0.25,
  },
  {
    id: 'long-overshoot',
    minN: 40,
    detect(rows, scale) {
      const values = longFastAlong(rows);
      const t = meanTest(values, 40, 0.25, 1, scale);
      if (!t) return null;
      return {
        variant: null, ratio: Math.abs(t.mean) / 0.25, n: t.n, params: { pct: pctWidth(t.mean) },
        ...jumpsRec({ distanceFocus: 'long' }), sample: { kind: 'mean', values },
      };
    },
    sample: (r) => ({ kind: 'mean', values: longFastAlong(r) }),
    good: () => 'zero',
    threshold: () => 0.25,
  },
  {
    id: 'short-overshoot',
    minN: 40,
    detect(rows, scale) {
      const values = shortAlong(rows);
      const t = meanTest(values, 40, 0.25, 1, scale);
      if (!t) return null;
      return {
        variant: null, ratio: Math.abs(t.mean) / 0.25, n: t.n, params: { pct: pctWidth(t.mean) },
        ...jumpsRec({ distanceFocus: 'short' }), sample: { kind: 'mean', values },
      };
    },
    sample: (r) => ({ kind: 'mean', values: shortAlong(r) }),
    good: () => 'zero',
    threshold: () => 0.25,
  },
  {
    id: 'direction-drift',
    minN: 40,
    detect(rows, scale) {
      let best: Detection | null = null;
      for (let o = 0; o < 8; o++) {
        const values = nonNull(octantTaps(rows, o).map((t) => t.lateral));
        if (values.length < need(40, scale)) continue;
        const a = aggOf(values);
        // The spread is compared with the jumps in every other direction.
        const others = nonNull(rows.taps.filter((t) => isJump(t.rec) && t.rec.features.direction !== null && octantOf(t.rec.features.direction) !== o).map((t) => t.lateral));
        const overall = sd(others);
        const consider = (d: Detection) => {
          if (!best || d.ratio > best.ratio) best = d;
        };
        if (Math.abs(a.mean) >= 0.25 && Math.abs(a.mean) >= (2 * a.sd) / Math.sqrt(a.n)) {
          consider({
            variant: `o${o}:bias`, ratio: Math.abs(a.mean) / 0.25, n: a.n,
            params: { dir: OCTANT_PHRASE[o]!, pct: pctWidth(a.mean), side: lateralSide(o, a.mean > 0 ? 1 : -1) },
            ...jumpsRec({ directionFocus: o }), sample: { kind: 'mean', values },
          });
        }
        if (overall > 0 && a.sd >= 1.3 * overall && logSdZ(a.sd, a.n, overall, others.length) >= 2) {
          consider({
            variant: `o${o}:spread`, ratio: a.sd / overall / 1.3, n: a.n,
            params: { dir: OCTANT_PHRASE[o]!, pct: pctWidth(a.sd), other: pctWidth(overall) },
            ...jumpsRec({ directionFocus: o }), sample: { kind: 'sd', values },
          });
        }
      }
      return best;
    },
    sample(rows, variant) {
      const values = nonNull(octantTaps(rows, parseOctant(variant)).map((t) => t.lateral));
      return variant?.endsWith(':spread') ? { kind: 'sd', values } : { kind: 'mean', values };
    },
    good: (v) => (v?.endsWith(':spread') ? 'down' : 'zero'),
    threshold: (v) => (v?.endsWith(':spread') ? 0.1 : 0.25),
  },
  {
    id: 'stream-offset',
    minN: 60,
    detect(rows, scale) {
      const values = streamNotesFast(rows);
      const t = meanTest(values, 60, 12, 0, scale);
      if (!t) return null;
      return {
        variant: t.mean > 0 ? 'late' : 'early', ratio: Math.abs(t.mean) / 12, n: t.n, params: { ms: Math.round(Math.abs(t.mean)) },
        modeId: 'streams', options: withDefaults('streams', { streamLength: 'short' }), sample: { kind: 'mean', values },
      };
    },
    sample: (r) => ({ kind: 'mean', values: streamNotesFast(r) }),
    good: () => 'zero',
    threshold: () => 12,
  },
  {
    id: 'stream-fade',
    minN: 40,
    detect(rows, scale) {
      const late = lateStream(rows);
      const early = earlyStream(rows);
      if (late.length < need(40, scale) || early.length < need(40, scale)) return null;
      const a = sd(late);
      const b = sd(early);
      if (b <= 0 || a / b < 1.35 || logSdZ(a, late.length, b, early.length) < 2) return null;
      return {
        variant: null, ratio: a / b / 1.35, n: Math.min(late.length, early.length), params: { a: Math.round(a), b: Math.round(b) },
        modeId: 'streams', options: withDefaults('streams', { streamLength: 'long' }), sample: { kind: 'sd', values: late },
      };
    },
    sample: (r) => ({ kind: 'sd', values: lateStream(r) }),
    good: () => 'down',
    threshold: () => 5,
  },
  {
    id: 'second-half',
    minN: 5,
    detect(rows, scale) {
      const diffs = secondHalfDrops(rows);
      if (diffs.length < need(5, scale)) return null;
      const m = mean(diffs);
      const positive = diffs.filter((d) => d > 0).length / diffs.length;
      if (m < 3 || positive < 0.7) return null;
      return {
        variant: null, ratio: m / 3, n: diffs.length, params: { pp: Math.round(m) },
        modeId: 'stamina', options: withDefaults('stamina', {}), sample: { kind: 'mean', values: diffs },
      };
    },
    sample: (r) => ({ kind: 'mean', values: secondHalfDrops(r) }),
    good: () => 'down',
    threshold: () => 3,
  },
  {
    id: 'sharp-wide',
    minN: 50,
    detect(rows, scale) {
      const sharp = sharpTaps(rows);
      const wide = wideTaps(rows);
      if (sharp.length < need(50, scale) || wide.length < need(50, scale)) return null;
      const ms = sharp.filter((t) => t.missed).length;
      const mw = wide.filter((t) => t.missed).length;
      const rs = ms / sharp.length;
      const rw = mw / wide.length;
      const diff = rs - rw;
      if (Math.abs(diff) < 0.06) return null;
      const z = twoPropZ(ms, sharp.length, mw, wide.length);
      if (Math.abs(z) < 2) return null;
      const sharpWorse = diff > 0;
      return {
        variant: sharpWorse ? 'sharp' : 'wide', ratio: Math.abs(diff) / 0.06, n: Math.min(sharp.length, wide.length),
        params: sharpWorse ? { a: Math.round(rs * 100), b: Math.round(rw * 100) } : { a: Math.round(rw * 100), b: Math.round(rs * 100) },
        modeId: 'angles', options: withDefaults('angles', { angleFocus: sharpWorse ? 'sharp' : 'wide' }),
        sample: rate(sharpWorse ? sharp : wide),
      };
    },
    sample: (r, variant) => rate(variant === 'wide' ? wideTaps(r) : sharpTaps(r)),
    good: () => 'down',
    threshold: () => 0.06,
  },
  {
    id: 'slider-lag',
    minN: 20,
    detect(rows, scale) {
      const values = sliderLag(rows);
      const t = meanTest(values, 20, 0.3, -1, scale);
      if (!t) return null;
      return {
        variant: null, ratio: Math.abs(t.mean) / 0.3, n: t.n, params: { pct: pctWidth(t.mean) },
        modeId: 'tracking', options: withDefaults('tracking', { sliderFocus: 'mixed' }), sample: { kind: 'mean', values },
      };
    },
    sample: (r) => ({ kind: 'mean', values: sliderLag(r) }),
    good: () => 'zero',
    threshold: () => 0.3,
  },
  {
    id: 'slider-curves',
    minN: 15,
    detect(rows, scale) {
      const curve = trackedBy(rows, 'curve');
      const straight = trackedBy(rows, 'straight');
      if (curve.length < need(15, scale) || straight.length < need(15, scale)) return null;
      const w = welch(aggOf(curve), aggOf(straight));
      if (w.diff > -0.08 || Math.abs(w.t) < 2) return null;
      return {
        variant: null, ratio: Math.abs(w.diff) / 0.08, n: Math.min(curve.length, straight.length),
        params: { a: Math.round(mean(curve) * 100), b: Math.round(mean(straight) * 100) },
        modeId: 'tracking', options: withDefaults('tracking', { sliderFocus: 'curves' }), sample: { kind: 'mean', values: curve },
      };
    },
    sample: (r) => ({ kind: 'mean', values: trackedBy(r, 'curve') }),
    good: () => 'up',
    threshold: () => 0.08,
  },
  {
    id: 'early-release',
    minN: 20,
    detect(rows, scale) {
      const s = rows.sliders.filter((t) => t.rec.slider);
      if (s.length < need(20, scale)) return null;
      const ends = s.filter((t) => t.rec.slider!.endHit).length;
      const ticksTotal = s.reduce((m, t) => m + t.rec.slider!.ticksTotal, 0);
      const ticksHit = s.reduce((m, t) => m + t.rec.slider!.ticksHit, 0);
      if (ticksTotal === 0) return null;
      const endRate = ends / s.length;
      const tickRate = ticksHit / ticksTotal;
      if (endRate > 0.85 || tickRate < 0.95) return null;
      if (twoPropZ(ticksHit, ticksTotal, ends, s.length) < 2) return null;
      return {
        variant: null, ratio: (1 - endRate) / 0.15, n: s.length, params: { pct: Math.round(endRate * 100), ticks: Math.round(tickRate * 100) },
        modeId: 'tracking', options: withDefaults('tracking', { sliderFocus: 'repeats' }),
        sample: { kind: 'rate', hits: ends, n: s.length },
      };
    },
    sample(r) {
      const s = r.sliders.filter((t) => t.rec.slider);
      return { kind: 'rate', hits: s.filter((t) => t.rec.slider!.endHit).length, n: s.length };
    },
    good: () => 'up',
    threshold: () => 0.05,
  },
  {
    id: 'timing-bias',
    minN: 200,
    detect(rows, scale) {
      const values = nonNull(rows.taps.map((t) => t.timing));
      const t = meanTest(values, 200, 10, 0, scale);
      if (!t || Math.abs(t.mean) / (t.sd / Math.sqrt(t.n)) < 3) return null;
      return {
        variant: t.mean > 0 ? 'late' : 'early', ratio: Math.abs(t.mean) / 10, n: t.n, params: { ms: Math.round(Math.abs(t.mean)) },
        modeId: 'timing', options: withDefaults('timing', {}), sample: { kind: 'mean', values },
      };
    },
    sample: (r) => ({ kind: 'mean', values: nonNull(r.taps.map((t) => t.timing)) }),
    good: () => 'zero',
    threshold: () => 10,
  },
  {
    id: 'busy-screen',
    minN: 50,
    detect(rows, scale) {
      const busy = rows.taps.filter((t) => t.rec.features.visibleCount >= 4);
      const calm = rows.taps.filter((t) => t.rec.features.visibleCount <= 2);
      if (busy.length < need(50, scale) || calm.length < need(50, scale)) return null;
      const mb = busy.filter((t) => t.missed).length;
      const mc = calm.filter((t) => t.missed).length;
      const diff = mb / busy.length - mc / calm.length;
      if (diff < 0.06 || twoPropZ(mb, busy.length, mc, calm.length) < 2) return null;
      return {
        variant: null, ratio: diff / 0.06, n: Math.min(busy.length, calm.length),
        params: { a: Math.round((mb / busy.length) * 100), b: Math.round((mc / calm.length) * 100) },
        modeId: 'reading', options: withDefaults('reading', {}), sample: rate(busy),
      };
    },
    sample: (r) => rate(r.taps.filter((t) => t.rec.features.visibleCount >= 4)),
    good: () => 'down',
    threshold: () => 0.06,
  },
  {
    id: 'off-center',
    minN: 150,
    detect(rows, scale) {
      if (rows.taps.length < need(150, scale)) return null;
      const hitRate = rows.taps.filter((t) => !t.missed).length / rows.taps.length;
      const values = offCenter(rows);
      if (hitRate < 0.95 || values.length === 0) return null;
      const m = mean(values);
      if (m < 0.55) return null;
      return {
        variant: null, ratio: m / 0.55, n: rows.taps.length, params: { pct: pctWidth(m) },
        modeId: 'precision', options: withDefaults('precision', {}), sample: { kind: 'mean', values },
      };
    },
    sample: (r) => ({ kind: 'mean', values: offCenter(r) }),
    good: () => 'down',
    threshold: () => 0.1,
  },
  {
    id: 'spinners',
    minN: 6,
    detect(rows, scale) {
      if (rows.spinners.length < need(6, scale)) return null;
      const crisp = rows.spinners.filter((t) => t.rec.judgment === 'crisp').length;
      const share = crisp / rows.spinners.length;
      if (share > 0.7) return null;
      return {
        variant: null, ratio: (1 - share) / 0.3, n: rows.spinners.length, params: { pct: Math.round(share * 100) },
        modeId: 'spinning', options: withDefaults('spinning', {}), sample: { kind: 'rate', hits: crisp, n: rows.spinners.length },
      };
    },
    sample: (r) => ({ kind: 'rate', hits: r.spinners.filter((t) => t.rec.judgment === 'crisp').length, n: r.spinners.length }),
    good: () => 'up',
    threshold: () => 0.1,
  },
];

function secondHalfDrops(rows: Rows): number[] {
  return rows.plays
    .filter((p) => p.playedMs >= 60_000 && p.halves.first !== null && p.halves.second !== null)
    .map((p) => (p.halves.first! - p.halves.second!) * 100);
}
const sliderLag = (r: Rows) => nonNull(r.sliders.map((t) => (t.rec.slider ? t.rec.slider.meanLag / t.rec.radius : null)));
const trackedBy = (r: Rows, shape: 'curve' | 'straight') =>
  r.sliders.filter((t) => (shape === 'straight' ? t.rec.slider?.shape === 'straight' : t.rec.slider !== null && t.rec.slider.shape !== 'straight')).map((t) => t.rec.slider!.trackedFraction);
const offCenter = (r: Rows) => nonNull(r.taps.filter((t) => !t.missed).map((t) => t.radial));

const RULES_BY_ID = new Map<RuleId, Rule>(rules.map((r) => [r.id, r]));

/* ---------------------------------------------------- public helpers */

export function ruleSample(ruleId: RuleId, variant: string | null, rows: Rows): Sample | null {
  return RULES_BY_ID.get(ruleId)?.sample(rows, variant) ?? null;
}
export const ruleMinN = (ruleId: RuleId): number => RULES_BY_ID.get(ruleId)?.minN ?? 1;
export const ruleGood = (ruleId: RuleId, variant: string | null): Good => RULES_BY_ID.get(ruleId)?.good(variant) ?? 'down';
export const ruleThreshold = (ruleId: RuleId, variant: string | null): number => RULES_BY_ID.get(ruleId)?.threshold(variant) ?? 1;

const severity = (ratio: number, n: number, minN: number): number => ratio * Math.min(1, n / (3 * minN));

function toInsight(rule: Rule, d: Detection, scope: 'window' | 'play'): Insight {
  const recommendation: Recommendation | null = d.modeId ? { modeId: d.modeId, options: d.options, label: recommendationLabel(d.modeId, d.options) } : null;
  return {
    key: d.variant ? `${rule.id}:${d.variant}` : rule.id,
    ruleId: rule.id,
    variant: d.variant,
    severity: severity(d.ratio, d.n, rule.minN),
    n: d.n,
    title: ruleTitle(rule.id, d.variant),
    text: insightText(rule.id, d.variant, d.params),
    basis: basisText(rule.id, d.n, scope),
    recommendation,
    baseline: d.sample ? baselineOf(d.sample) : null,
  };
}

/** The module and options a play launch should use for a recommendation. */
export function drillLaunch(
  rec: Recommendation,
  levels: Partial<Record<ModuleId, number>>,
  drillId: string | null,
  seed: number,
): LaunchRequest {
  const mode = MODES[rec.modeId];
  return {
    modeId: rec.modeId,
    difficulty: { ...DEFAULT_DIFFICULTY },
    presetLevel: null,
    options: { ...rec.options },
    mods: [],
    seed,
    lengthSec: mode.lengthOptions.includes(90) ? 90 : mode.defaultLengthSec,
    levels,
    drillId,
  };
}

/* ------------------------------------------------------ session rules */

function sameModule(plays: PlaySummary[]): Insight | null {
  const last = [...plays].sort((a, b) => b.startedAt - a.startedAt).slice(0, 4);
  if (last.length < 4) return null;
  const mode = last[0]!.modeId;
  if (!last.every((p) => p.modeId === mode) || mode === 'dynamic') return null;
  if (last.every((p) => p.drillId !== null)) return null;
  return {
    key: 'same-module',
    ruleId: 'same-module',
    variant: null,
    severity: 0.5,
    n: 4,
    title: ruleTitle('same-module', null),
    text: insightText('same-module', null, { module: MODES[mode].label }),
    basis: basisText('same-module', 4, 'window'),
    recommendation: null,
    baseline: null,
  };
}

function longSession(plays: PlaySummary[], now: number): Insight | null {
  const session = groupSessions(plays)[0];
  if (!session || session.plays.length < 4) return null;
  const minutes = (session.end - session.start) / 60_000;
  if (minutes < 25 || now - session.end > SESSION_GAP_MS) return null;
  const avg = mean(session.plays.map((p) => p.accuracy));
  const last = mean(session.plays.slice(-3).map((p) => p.accuracy));
  const dropPoints = (avg - last) * 100;
  if (dropPoints < 3) return null;
  return {
    key: 'long-session',
    ruleId: 'long-session',
    variant: null,
    severity: dropPoints / 3,
    n: session.plays.length,
    title: ruleTitle('long-session', null),
    text: insightText('long-session', null, { last: Math.round(last * 100), avg: Math.round(avg * 100) }),
    basis: basisText('long-session', session.plays.length, 'window').replace('from the last 30 days', 'in this session'),
    recommendation: null,
    baseline: null,
  };
}

/* --------------------------------------------------------------- main */

/** Insights from the last 30 days of plays, strongest first. Empty below 3 plays. */
export function detectInsights(plays: readonly PlayData[], now: number): Insight[] {
  const window = selectWindow(plays, now);
  if (!window) return [];
  const rows = buildRows(window);
  const out: Insight[] = [];
  for (const rule of rules) {
    const d = rule.detect(rows, 1);
    if (d) out.push(toInsight(rule, d, 'window'));
  }
  out.sort((a, b) => b.severity - a.severity);

  const summaries = window.map((p) => p.summary);
  const repeat = sameModule(summaries);
  if (repeat) {
    const repeated = summaries.slice().sort((a, b) => b.startedAt - a.startedAt)[0]!.modeId;
    const next = out.find((i) => i.recommendation && i.recommendation.modeId !== repeated);
    out.push({ ...repeat, recommendation: next?.recommendation ?? null });
  }
  const tired = longSession(summaries, now);
  if (tired) out.push(tired);
  return out.sort((a, b) => b.severity - a.severity);
}

/** Notes for one finished play. They use half the usual minimum counts. */
export function playNotes(records: readonly HitRecord[], summary: PlaySummary): Insight[] {
  const rows = buildRows([{ summary, records: [...records] }]);
  const out: Insight[] = [];
  for (const id of ['long-undershoot', 'long-overshoot', 'stream-offset', 'sharp-wide'] as RuleId[]) {
    const rule = RULES_BY_ID.get(id)!;
    const d = rule.detect(rows, 0.5);
    if (d) out.push(toInsight(rule, d, 'play'));
  }
  return out.sort((a, b) => b.severity - a.severity);
}
