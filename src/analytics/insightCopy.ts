// Every sentence the insight and drill code shows to players. Follows reference/writing.md.

import { MODES } from '../shared/catalog';
import type { DrillEval, RuleId } from '../data/schema';
import type { ModeId, ModuleOptions } from '../shared/types';

export type Params = Record<string, number | string>;

/** Octants as in ObjectFeatures.direction: 0 is right, then clockwise on screen. */
export const OCTANT_PHRASE = ['right', 'down and right', 'down', 'down and left', 'left', 'up and left', 'up', 'up and right'];

/**
 * Where clicks land on the screen when they are off the line of movement.
 * Lateral is positive to the right of the movement, which is a clockwise quarter turn on screen
 * (y points down), so moving down and landing to the right of the movement is the left of the screen.
 */
export function lateralSide(octant: number, sign: 1 | -1): string {
  const screen = (((octant + 2 * sign) % 8) + 8) % 8;
  switch (screen) {
    case 0: return 'to the right of the line';
    case 1: return 'down and to the right of the line';
    case 2: return 'below the line';
    case 3: return 'down and to the left of the line';
    case 4: return 'to the left of the line';
    case 5: return 'up and to the left of the line';
    case 6: return 'above the line';
    default: return 'up and to the right of the line';
  }
}

const num = (p: Params, k: string): number => {
  const v = p[k];
  return typeof v === 'number' ? v : Number(v);
};
const str = (p: Params, k: string): string => String(p[k] ?? '');

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The sentence an insight shows. */
export function insightText(ruleId: RuleId, variant: string | null, p: Params): string {
  switch (ruleId) {
    case 'long-undershoot':
      return `You stop short on long, fast jumps (over ${num(p, 'cut')} target widths). Your clicks land about ${num(p, 'pct')}% of a target's width before the center.`;
    case 'long-overshoot':
      return `You overshoot long, fast jumps (over ${num(p, 'cut')} target widths). Your clicks land about ${num(p, 'pct')}% of a target's width past the center.`;
    case 'short-overshoot':
      return `You overshoot short jumps by about ${num(p, 'pct')}% of a target's width.`;
    case 'direction-drift':
      if (variant?.endsWith(':spread')) {
        return `When you move ${str(p, 'dir')}, your clicks scatter across the line by ${num(p, 'pct')}% of a target's width, against ${num(p, 'other')}% on your other jumps.`;
      }
      return `When you move ${str(p, 'dir')}, your clicks land about ${num(p, 'pct')}% of a target's width ${str(p, 'side')}.`;
    case 'stream-offset':
      return variant === 'early'
        ? `You rush fast streams, about ${num(p, 'ms')} ms early on average.`
        : `You're late on fast streams by about ${num(p, 'ms')} ms on average.`;
    case 'stream-fade':
      return `Your timing gets looser after the first five taps of a stream (${num(p, 'a')} ms spread against ${num(p, 'b')} ms).`;
    case 'second-half':
      return `Your accuracy drops by about ${num(p, 'points')} points in the second half of a play.`;
    case 'sharp-wide':
      return variant === 'wide'
        ? `You miss more on wide, flowing jumps than on sharp back-and-forth ones (${num(p, 'a')}% against ${num(p, 'b')}%).`
        : `You miss more on sharp back-and-forth jumps than on wide, flowing ones (${num(p, 'a')}% against ${num(p, 'b')}%).`;
    case 'slider-lag':
      return `You trail behind slider balls by about ${num(p, 'pct')}% of a target's width.`;
    case 'slider-curves':
      return `You lose more sliders on curves than on straight paths (${num(p, 'a')}% kept against ${num(p, 'b')}%).`;
    case 'early-release':
      return `You often let go of sliders shortly before they end. The end counted on ${num(p, 'pct')}% of sliders, while ${num(p, 'ticks')}% of the ticks counted.`;
    case 'timing-bias':
      return `You click about ${num(p, 'ms')} ms ${variant === 'early' ? 'early' : 'late'} on average.`;
    case 'busy-screen':
      return `You miss more when ${num(p, 'cut')} or more targets are on screen (${num(p, 'a')}% against ${num(p, 'b')}% on quieter screens).`;
    case 'off-center':
      return `You hit almost every target, but your clicks land far from the center. On average a click is ${num(p, 'pct')}% of a target's width off.`;
    case 'spinners':
      return `You finish only ${num(p, 'pct')}% of spinners in time.`;
    case 'late-leave':
      return `On fast jumps you leave the last target late, after about ${num(p, 'pct')}% of the time to the next one. Leaving sooner gives the move more time.`;
    case 'first-motion':
      return variant?.startsWith('over')
        ? `On long jumps your first motion goes about ${num(p, 'pct')}% of a target's width past the center before you pull back.`
        : `On long jumps your first motion stops about ${num(p, 'pct')}% of a target's width short, and a second motion makes up the rest.`;
    case 'corrections':
      return `You make a second motion on ${num(p, 'pct')}% of your longer jumps. Try for one smooth move that stops on the target.`;
    case 'same-module':
      return `You've played ${str(p, 'module')} four times in a row. Try another module next, then come back to it.`;
    case 'long-session':
      return `Your accuracy over your last three plays is ${num(p, 'last')}%, against ${num(p, 'avg')}% for this session. A break might help before you go on.`;
  }
}

export const RULE_NOUN: Record<RuleId, [string, string]> = {
  'long-undershoot': ['jump', 'jumps'],
  'long-overshoot': ['jump', 'jumps'],
  'short-overshoot': ['jump', 'jumps'],
  'direction-drift': ['jump', 'jumps'],
  'stream-offset': ['stream note', 'stream notes'],
  'stream-fade': ['stream note', 'stream notes'],
  'second-half': ['play', 'plays'],
  'sharp-wide': ['jump', 'jumps'],
  'slider-lag': ['slider', 'sliders'],
  'slider-curves': ['slider', 'sliders'],
  'early-release': ['slider', 'sliders'],
  'timing-bias': ['click', 'clicks'],
  'busy-screen': ['tap', 'taps'],
  'off-center': ['tap', 'taps'],
  spinners: ['spinner', 'spinners'],
  'same-module': ['play', 'plays'],
  'long-session': ['play', 'plays'],
  'late-leave': ['jump', 'jumps'],
  'first-motion': ['jump', 'jumps'],
  corrections: ['jump', 'jumps'],
};

export function basisText(ruleId: RuleId, n: number, scope: 'window' | 'play'): string {
  const [one, many] = RULE_NOUN[ruleId];
  const where = scope === 'window' ? 'from the last 30 days' : 'in this play';
  return `Based on ${n} ${n === 1 ? one : many} ${where}.`;
}

/** A short name for lists of drills. */
export function ruleTitle(ruleId: RuleId, variant: string | null): string {
  switch (ruleId) {
    case 'long-undershoot': return 'Stopping short on long jumps';
    case 'long-overshoot': return 'Overshooting long jumps';
    case 'short-overshoot': return 'Overshooting short jumps';
    case 'direction-drift': {
      const o = Number(variant?.match(/^o(\d)/)?.[1] ?? 0);
      return `Aim when moving ${OCTANT_PHRASE[o] ?? 'right'}`;
    }
    case 'stream-offset': return 'Timing on fast streams';
    case 'stream-fade': return 'Timing late in streams';
    case 'second-half': return 'Accuracy in the second half';
    case 'sharp-wide': return variant === 'wide' ? 'Wide, flowing jumps' : 'Sharp back-and-forth jumps';
    case 'slider-lag': return 'Staying with slider balls';
    case 'slider-curves': return 'Sliders on curves';
    case 'early-release': return 'Holding sliders to the end';
    case 'timing-bias': return 'Click timing';
    case 'busy-screen': return 'Busy screens';
    case 'off-center': return 'Hitting the center';
    case 'spinners': return 'Spinners';
    case 'same-module': return 'Variety';
    case 'long-session': return 'Rest';
    case 'late-leave': return 'Leaving the last target sooner';
    case 'first-motion': return 'Where your first motion stops';
    case 'corrections': return 'One smooth move per jump';
  }
}

/** What a drill measures, as a phrase that follows "went from" in a sentence, plus a formatter. */
export interface MetricCopy {
  /** Starts with a lowercase letter. */
  metric: string;
  format(value: number): string;
}

const pctWidth = (radii: number) => Math.round(Math.abs(radii) * 50);
const pct = (share: number) => Math.round(share * 100);

export function metricCopy(ruleId: RuleId, variant: string | null): MetricCopy {
  switch (ruleId) {
    case 'long-undershoot':
    case 'long-overshoot':
      return { metric: 'your aim on long, fast jumps', format: (v) => (pctWidth(v) === 0 ? 'on the center' : `${pctWidth(v)}% ${v < 0 ? 'short' : 'past'}`) };
    case 'short-overshoot':
      return { metric: 'your aim on short jumps', format: (v) => (pctWidth(v) === 0 ? 'on the center' : `${pctWidth(v)}% ${v < 0 ? 'short' : 'past'}`) };
    case 'direction-drift':
      return variant?.endsWith(':spread')
        ? { metric: 'how widely your clicks scatter across the line', format: (v) => `${pctWidth(v)}%` }
        : { metric: 'how far your clicks drift off the line', format: (v) => (pctWidth(v) === 0 ? 'on the line' : `${pctWidth(v)}% ${lateralSide(parseOctant(variant), v > 0 ? 1 : -1)}`) };
    case 'stream-offset':
      return { metric: 'your timing on fast streams', format: (v) => (Math.round(Math.abs(v)) === 0 ? 'on time' : `${Math.round(Math.abs(v))} ms ${v < 0 ? 'early' : 'late'}`) };
    case 'stream-fade':
      return { metric: 'your timing spread late in streams', format: (v) => `${Math.round(v)} ms` };
    case 'second-half':
      return { metric: 'your accuracy drop in the second half', format: (v) => `${Math.round(v * 10) / 10} points` };
    case 'sharp-wide':
      return { metric: variant === 'wide' ? 'your miss rate on wide jumps' : 'your miss rate on sharp jumps', format: (v) => `${pct(v)}%` };
    case 'slider-lag':
      return { metric: 'how far you trail slider balls', format: (v) => (pctWidth(v) === 0 ? 'level with the ball' : `${pctWidth(v)}% ${v < 0 ? 'behind' : 'ahead'}`) };
    case 'slider-curves':
      return { metric: 'how much of curved sliders you keep', format: (v) => `${pct(v)}%` };
    case 'early-release':
      return { metric: 'how often you hold sliders to the end', format: (v) => `${pct(v)}%` };
    case 'timing-bias':
      return { metric: 'your click timing', format: (v) => (Math.round(Math.abs(v)) === 0 ? 'on time' : `${Math.round(Math.abs(v))} ms ${v < 0 ? 'early' : 'late'}`) };
    case 'busy-screen':
      return { metric: 'your miss rate on busy screens', format: (v) => `${pct(v)}%` };
    case 'off-center':
      return { metric: 'how far your clicks land from the center', format: (v) => `${pctWidth(v)}% of a width` };
    case 'spinners':
      return { metric: 'how many spinners you finish in time', format: (v) => `${pct(v)}%` };
    case 'late-leave':
      return { metric: 'how late you leave the last target', format: (v) => `${pct(v)}% of the gap` };
    case 'first-motion':
      return { metric: 'where your first motion stops on long jumps', format: (v) => (pctWidth(v) === 0 ? 'on the center' : `${pctWidth(v)}% ${v < 0 ? 'short' : 'past'}`) };
    case 'corrections':
      return { metric: 'how often you make a second motion', format: (v) => `${pct(v)}%` };
    case 'same-module':
    case 'long-session':
      return { metric: '', format: (v) => String(v) };
  }
}

const parseOctant = (variant: string | null): number => Number(variant?.match(/^o(\d)/)?.[1] ?? 0);

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
export const shortDate = (t: number): string => DATE.format(new Date(t));

export interface DrillTextInput {
  ruleId: RuleId;
  variant: string | null;
  createdAt: number;
  eval: DrillEval;
}

/** The sentence that says whether a drill is working. */
export function drillText({ ruleId, variant, createdAt, eval: e }: DrillTextInput): string {
  const m = metricCopy(ruleId, variant);
  const [one, many] = RULE_NOUN[ruleId];
  const noun = (n: number) => (n === 1 ? one : many);
  const date = shortDate(createdAt);
  const before = e.before === null ? '' : m.format(e.before);
  const after = e.after === null ? '' : m.format(e.after);
  switch (e.outcome) {
    case 'collecting':
      return e.sessions < e.sessionsNeeded
        ? `Do ${plural(e.sessionsNeeded - e.sessions, 'more drill session')} to start the comparison.`
        : `Play ${plural(Math.max(1, e.morePlays), 'more map')} outside the drill to measure it.`;
    case 'better': {
      // Two values that round to the same text are not shown side by side.
      const change = before === after ? 'improved a little' : `went from ${before} to ${after}`;
      return `Since you started this drill on ${date}, ${m.metric} ${change}. That's based on ${e.nBefore} ${noun(e.nBefore)} before and ${e.nAfter} after.`;
    }
    case 'worse':
      if (before === after) return `${cap(m.metric)} is a little worse than before this drill.`;
      return `${cap(m.metric)} is worse than before this drill (${before} then, ${after} now).`;
    case 'unclear':
      return `No clear change in ${m.metric} yet. ${e.nAfter} ${noun(e.nAfter)} measured since ${date}.`;
  }
}

export const OUTCOME_LABEL: Record<DrillEval['outcome'], string> = {
  collecting: 'Collecting data',
  better: 'Better',
  unclear: 'No clear change',
  worse: 'Worse',
};

/** Label for the module and options a recommendation opens. */
export function recommendationLabel(modeId: ModeId, o: ModuleOptions): string {
  const base = MODES[modeId].label;
  let extra = '';
  if (o.distanceFocus === 'long') extra = 'long distances';
  else if (o.distanceFocus === 'short') extra = 'short distances';
  else if (typeof o.directionFocus === 'number') extra = `moving ${OCTANT_PHRASE[o.directionFocus] ?? 'right'}`;
  else if (o.angleFocus === 'sharp') extra = 'sharp turns';
  else if (o.angleFocus === 'wide') extra = 'wide turns';
  else if (o.streamLength === 'short') extra = 'short streams';
  else if (o.streamLength === 'long') extra = 'long streams';
  else if (o.sliderFocus === 'curves') extra = 'curved sliders';
  else if (o.sliderFocus === 'repeats') extra = 'sliders with repeats';
  return extra ? `${base}, ${extra}` : base;
}
