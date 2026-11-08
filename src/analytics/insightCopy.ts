// Every sentence the insight and drill code shows to players. Follows reference/writing.md. Each sentence goes through
// t(), so the insights read in the player's language, with plurals and sides chosen by the dictionary.

import { MODES } from '../shared/catalog';
import { formatNumber, intlTag, msg, t } from '../shared/i18n';
import type { DrillEval, RuleId } from '../data/schema';
import type { ModeId, ModuleOptions } from '../shared/types';

export type Params = Record<string, number | string>;

/** Octants as in ObjectFeatures.direction: 0 is right, then clockwise on screen. These are translated where shown. */
export const OCTANT_PHRASE = [
  msg('right'),
  msg('down and right'),
  msg('down'),
  msg('down and left'),
  msg('left'),
  msg('up and left'),
  msg('up'),
  msg('up and right'),
];

const octantPhrase = (o: number): string => {
  const phrase = OCTANT_PHRASE[o] ?? OCTANT_PHRASE[0]!;
  return t(phrase);
};

/**
 * Where clicks land on the screen when they are off the line of movement. The result is English, to translate where shown.
 * Lateral is positive to the right of the movement, which is a clockwise quarter turn on screen
 * (y points down), so moving down and landing to the right of the movement is the left of the screen.
 */
export function lateralSide(octant: number, sign: 1 | -1): string {
  const screen = (((octant + 2 * sign) % 8) + 8) % 8;
  switch (screen) {
    case 0:
      return msg('to the right of the line');
    case 1:
      return msg('down and to the right of the line');
    case 2:
      return msg('below the line');
    case 3:
      return msg('down and to the left of the line');
    case 4:
      return msg('to the left of the line');
    case 5:
      return msg('up and to the left of the line');
    case 6:
      return msg('above the line');
    default:
      return msg('up and to the right of the line');
  }
}

const num = (p: Params, k: string): number => {
  const v = p[k];
  return typeof v === 'number' ? v : Number(v);
};
const str = (p: Params, k: string): string => String(p[k] ?? '');

export { count as plural } from '../shared/i18n';

/** The sentence an insight shows. */
export function insightText(ruleId: RuleId, variant: string | null, p: Params): string {
  const cut = num(p, 'cut');
  const pct = num(p, 'pct');
  const ms = num(p, 'ms');
  const a = num(p, 'a');
  const b = num(p, 'b');
  switch (ruleId) {
    case 'long-undershoot':
      return t(
        "You stop short on long, fast jumps (over {cut} target widths). Your clicks land about {pct}% of a target's width before the center.",
        { cut, pct },
      );
    case 'long-overshoot':
      return t(
        "You overshoot long, fast jumps (over {cut} target widths). Your clicks land about {pct}% of a target's width past the center.",
        {
          cut,
          pct,
        },
      );
    case 'short-overshoot':
      return t("You overshoot short jumps by about {pct}% of a target's width.", { pct });
    case 'direction-drift': {
      // The direction and the side were marked with msg() where they are chosen, so they translate here.
      const dir = str(p, 'dir');
      const side = str(p, 'side');
      if (variant?.endsWith(':spread')) {
        return t(
          "When you move {dir}, your clicks scatter across the line by {pct}% of a target's width, against {other}% on your other jumps.",
          {
            dir: t(dir),
            pct,
            other: num(p, 'other'),
          },
        );
      }
      return t("When you move {dir}, your clicks land about {pct}% of a target's width {side}.", {
        dir: t(dir),
        pct,
        side: t(side),
      });
    }
    case 'stream-offset':
      return variant === 'early'
        ? t('You rush fast streams, about {ms} ms early on average.', { ms })
        : t("You're late on fast streams by about {ms} ms on average.", { ms });
    case 'stream-fade':
      return t('Your timing gets looser after the first five taps of a stream ({a} ms spread against {b} ms).', { a, b });
    case 'second-half':
      return t('Your accuracy drops by about {points} points in the second half of a play.', { points: num(p, 'points') });
    case 'sharp-wide':
      return variant === 'wide'
        ? t('You miss more on wide, flowing jumps than on sharp back-and-forth ones ({a}% against {b}%).', { a, b })
        : t('You miss more on sharp back-and-forth jumps than on wide, flowing ones ({a}% against {b}%).', { a, b });
    case 'slider-lag':
      return t("You trail behind slider balls by about {pct}% of a target's width.", { pct });
    case 'slider-curves':
      return t('You lose more sliders on curves than on straight paths ({a}% kept against {b}%).', { a, b });
    case 'early-release':
      return t(
        'You often let go of sliders shortly before they end. The end counted on {pct}% of sliders, while {ticks}% of the ticks counted.',
        {
          pct,
          ticks: num(p, 'ticks'),
        },
      );
    case 'timing-bias':
      return t('You click about {ms} ms {side, select, early {early} other {late}} on average.', {
        ms,
        side: variant === 'early' ? 'early' : 'late',
      });
    case 'busy-screen':
      return t('You miss more when {cut} or more targets are on screen ({a}% against {b}% on quieter screens).', { cut, a, b });
    case 'off-center':
      return t(
        "You hit almost every target, but your clicks land far from the center. On average a click is {pct}% of a target's width off.",
        {
          pct,
        },
      );
    case 'spinners':
      return t('You finish only {pct}% of spinners in time.', { pct });
    case 'late-leave':
      return t(
        'On fast jumps you leave the last target late, after about {pct}% of the time to the next one. Leaving sooner gives the move more time.',
        { pct },
      );
    case 'first-motion':
      return variant?.startsWith('over')
        ? t("On long jumps your first motion goes about {pct}% of a target's width past the center before you pull back.", { pct })
        : t("On long jumps your first motion stops about {pct}% of a target's width short, and a second motion makes up the rest.", {
            pct,
          });
    case 'corrections':
      return t('You make a second motion on {pct}% of your longer jumps. Try for one smooth move that stops on the target.', { pct });
    case 'same-module':
      return t("You've played {module} four times in a row. Try another module next, then come back to it.", { module: str(p, 'module') });
    case 'long-session':
      return t(
        'Your accuracy over your last three plays is {last}%, against {avg}% for this session. A break might help before you go on.',
        {
          last: num(p, 'last'),
          avg: num(p, 'avg'),
        },
      );
  }
}

/** The thing a rule counts, as a plural message: "{n, plural, one {# jump} other {# jumps}}". */
export const RULE_NOUN: Record<RuleId, string> = {
  'long-undershoot': msg('{n, plural, one {# jump} other {# jumps}}'),
  'long-overshoot': msg('{n, plural, one {# jump} other {# jumps}}'),
  'short-overshoot': msg('{n, plural, one {# jump} other {# jumps}}'),
  'direction-drift': msg('{n, plural, one {# jump} other {# jumps}}'),
  'stream-offset': msg('{n, plural, one {# stream note} other {# stream notes}}'),
  'stream-fade': msg('{n, plural, one {# stream note} other {# stream notes}}'),
  'second-half': msg('{n, plural, one {# play} other {# plays}}'),
  'sharp-wide': msg('{n, plural, one {# jump} other {# jumps}}'),
  'slider-lag': msg('{n, plural, one {# slider} other {# sliders}}'),
  'slider-curves': msg('{n, plural, one {# slider} other {# sliders}}'),
  'early-release': msg('{n, plural, one {# slider} other {# sliders}}'),
  'timing-bias': msg('{n, plural, one {# click} other {# clicks}}'),
  'busy-screen': msg('{n, plural, one {# tap} other {# taps}}'),
  'off-center': msg('{n, plural, one {# tap} other {# taps}}'),
  spinners: msg('{n, plural, one {# spinner} other {# spinners}}'),
  'same-module': msg('{n, plural, one {# play} other {# plays}}'),
  'long-session': msg('{n, plural, one {# play} other {# plays}}'),
  'late-leave': msg('{n, plural, one {# jump} other {# jumps}}'),
  'first-motion': msg('{n, plural, one {# jump} other {# jumps}}'),
  corrections: msg('{n, plural, one {# jump} other {# jumps}}'),
};

/** "3 jumps", in the player's language. */
export const nounCount = (ruleId: RuleId, n: number): string => t(RULE_NOUN[ruleId], { n });

export function basisText(ruleId: RuleId, n: number, scope: 'window' | 'play' | 'session'): string {
  const what = nounCount(ruleId, n);
  if (scope === 'window') return t('Based on {what} from the last 30 days.', { what });
  if (scope === 'session') return t('Based on {what} in this session.', { what });
  return t('Based on {what} in this play.', { what });
}

/** A short name for lists of drills. */
export function ruleTitle(ruleId: RuleId, variant: string | null): string {
  switch (ruleId) {
    case 'long-undershoot':
      return t('Stopping short on long jumps');
    case 'long-overshoot':
      return t('Overshooting long jumps');
    case 'short-overshoot':
      return t('Overshooting short jumps');
    case 'direction-drift': {
      const o = Number(variant?.match(/^o(\d)/)?.[1] ?? 0);
      return t('Aim when moving {direction}', { direction: octantPhrase(o) });
    }
    case 'stream-offset':
      return t('Timing on fast streams');
    case 'stream-fade':
      return t('Timing late in streams');
    case 'second-half':
      return t('Accuracy in the second half');
    case 'sharp-wide':
      return variant === 'wide' ? t('Wide, flowing jumps') : t('Sharp back-and-forth jumps');
    case 'slider-lag':
      return t('Staying with slider balls');
    case 'slider-curves':
      return t('Sliders on curves');
    case 'early-release':
      return t('Holding sliders to the end');
    case 'timing-bias':
      return t('Click timing');
    case 'busy-screen':
      return t('Busy screens');
    case 'off-center':
      return t('Hitting the center');
    case 'spinners':
      return t('Spinners');
    case 'same-module':
      return t('Variety');
    case 'long-session':
      return t('Rest');
    case 'late-leave':
      return t('Leaving the last target sooner');
    case 'first-motion':
      return t('Where your first motion stops');
    case 'corrections':
      return t('One smooth move per jump');
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

const shortOrPast = (v: number) =>
  pctWidth(v) === 0
    ? t('on the center')
    : t('{pct}% {side, select, short {short} other {past}}', { pct: pctWidth(v), side: v < 0 ? 'short' : 'past' });
const earlyOrLate = (v: number) =>
  Math.round(Math.abs(v)) === 0
    ? t('on time')
    : t('{ms} ms {side, select, early {early} other {late}}', { ms: Math.round(Math.abs(v)), side: v < 0 ? 'early' : 'late' });
const percent = (v: number) => `${formatNumber(pct(v))}%`;

export function metricCopy(ruleId: RuleId, variant: string | null): MetricCopy {
  switch (ruleId) {
    case 'long-undershoot':
    case 'long-overshoot':
      return { metric: t('your aim on long, fast jumps'), format: shortOrPast };
    case 'short-overshoot':
      return { metric: t('your aim on short jumps'), format: shortOrPast };
    case 'direction-drift':
      return variant?.endsWith(':spread')
        ? { metric: t('how widely your clicks scatter across the line'), format: (v) => `${formatNumber(pctWidth(v))}%` }
        : {
            metric: t('how far your clicks drift off the line'),
            format: (v) => {
              if (pctWidth(v) === 0) return t('on the line');
              const side = sideOf(variant, v);
              return t('{pct}% {side}', { pct: pctWidth(v), side: t(side) });
            },
          };
    case 'stream-offset':
      return { metric: t('your timing on fast streams'), format: earlyOrLate };
    case 'stream-fade':
      return { metric: t('your timing spread late in streams'), format: (v) => t('{ms} ms', { ms: Math.round(v) }) };
    case 'second-half':
      return {
        metric: t('your accuracy drop in the second half'),
        format: (v) => t('{points} points', { points: Math.round(v * 10) / 10 }),
      };
    case 'sharp-wide':
      return { metric: variant === 'wide' ? t('your miss rate on wide jumps') : t('your miss rate on sharp jumps'), format: percent };
    case 'slider-lag':
      return {
        metric: t('how far you trail slider balls'),
        format: (v) =>
          pctWidth(v) === 0
            ? t('level with the ball')
            : t('{pct}% {side, select, behind {behind} other {ahead}}', { pct: pctWidth(v), side: v < 0 ? 'behind' : 'ahead' }),
      };
    case 'slider-curves':
      return { metric: t('how much of curved sliders you keep'), format: percent };
    case 'early-release':
      return { metric: t('how often you hold sliders to the end'), format: percent };
    case 'timing-bias':
      return { metric: t('your click timing'), format: earlyOrLate };
    case 'busy-screen':
      return { metric: t('your miss rate on busy screens'), format: percent };
    case 'off-center':
      return { metric: t('how far your clicks land from the center'), format: (v) => t('{pct}% of a width', { pct: pctWidth(v) }) };
    case 'spinners':
      return { metric: t('how many spinners you finish in time'), format: percent };
    case 'late-leave':
      return { metric: t('how late you leave the last target'), format: (v) => t('{pct}% of the gap', { pct: pct(v) }) };
    case 'first-motion':
      return { metric: t('where your first motion stops on long jumps'), format: shortOrPast };
    case 'corrections':
      return { metric: t('how often you make a second motion'), format: percent };
    case 'same-module':
    case 'long-session':
      return { metric: '', format: (v) => String(v) };
  }
}

const parseOctant = (variant: string | null): number => Number(variant?.match(/^o(\d)/)?.[1] ?? 0);
const sideOf = (variant: string | null, v: number): string => lateralSide(parseOctant(variant), v > 0 ? 1 : -1);

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** "7 Nov", in the player's language. */
export const shortDate = (time: number): string =>
  new Intl.DateTimeFormat(intlTag(), { day: 'numeric', month: 'short' }).format(new Date(time));

export interface DrillTextInput {
  ruleId: RuleId;
  variant: string | null;
  createdAt: number;
  eval: DrillEval;
}

/** The sentence that says whether a drill is working. */
export function drillText({ ruleId, variant, createdAt, eval: e }: DrillTextInput): string {
  const m = metricCopy(ruleId, variant);
  const date = shortDate(createdAt);
  const before = e.before === null ? '' : m.format(e.before);
  const after = e.after === null ? '' : m.format(e.after);
  switch (e.outcome) {
    case 'collecting':
      return e.sessions < e.sessionsNeeded
        ? t('Do {n, plural, one {# more drill session} other {# more drill sessions}} to start the comparison.', {
            n: e.sessionsNeeded - e.sessions,
          })
        : t('Play {n, plural, one {# more map} other {# more maps}} outside the drill to measure it.', { n: Math.max(1, e.morePlays) });
    case 'better': {
      // Two values that round to the same text are not shown side by side.
      const change = before === after ? t('improved a little') : t('went from {before} to {after}', { before, after });
      return t("Since you started this drill on {date}, {metric} {change}. That's based on {before} before and {after} after.", {
        date,
        metric: m.metric,
        change,
        before: nounCount(ruleId, e.nBefore),
        after: formatNumber(e.nAfter),
      });
    }
    case 'worse':
      if (before === after) return t('{metric} is a little worse than before this drill.', { metric: cap(m.metric) });
      return t('{metric} is worse than before this drill ({before} then, {after} now).', { metric: cap(m.metric), before, after });
    case 'unclear':
      return t('No clear change in {metric} yet. {count} measured since {date}.', {
        metric: m.metric,
        count: nounCount(ruleId, e.nAfter),
        date,
      });
  }
}

export const OUTCOME_LABEL: Record<DrillEval['outcome'], string> = {
  get collecting() {
    return t('Collecting data');
  },
  get better() {
    return t('Better');
  },
  get unclear() {
    return t('No clear change');
  },
  get worse() {
    return t('Worse');
  },
};

/** Label for the module and options a recommendation opens. */
export function recommendationLabel(modeId: ModeId, o: ModuleOptions): string {
  const base = MODES[modeId].label;
  let extra = '';
  if (o.distanceFocus === 'long') extra = t('long distances');
  else if (o.distanceFocus === 'short') extra = t('short distances');
  else if (typeof o.directionFocus === 'number') extra = t('moving {direction}', { direction: octantPhrase(o.directionFocus) });
  else if (o.angleFocus === 'sharp') extra = t('sharp turns');
  else if (o.angleFocus === 'wide') extra = t('wide turns');
  else if (o.streamLength === 'short') extra = t('short streams');
  else if (o.streamLength === 'long') extra = t('long streams');
  else if (o.sliderFocus === 'curves') extra = t('curved sliders');
  else if (o.sliderFocus === 'repeats') extra = t('sliders with repeats');
  return extra ? `${base}, ${extra}` : base;
}
