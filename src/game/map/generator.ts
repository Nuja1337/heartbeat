// The Dynamic map generator (PLAN section 7).

import { MAP_FORMAT } from '../../shared/catalog';
import type { GeneratedMap, HitObject, LaunchRequest, MapSection, SectionFocus } from '../../shared/types';
import { GENERATOR_VERSION } from '../version';
import { deriveParams, jumpDistance, patternWeights, PATTERN_KINDS, restProb } from './difficulty';
import type { GenParams, PatternKind } from './difficulty';
import { MapBuilder } from './placement';
import type { BuilderConfig, GroupInfo, Motif } from './placement';
import { makeMotif, makeSliderSpec, singleRun } from './patterns';
import type { PatternCtx } from './patterns';
import { createRng } from './rng';
import type { Rng } from './rng';
import { healthRulesFor } from '../rules/scoring';

const INTENSITY_TEMPLATE = [0.55, 0.75, 0.9, 1.0, 0.4, 0.8, 0.95, 1.0, 0.6];

const T1 = ['A', "A'", 'B', "B'", 'A"', 'C', "C'"];
const T2 = ['A', 'B', "A'", "B'", 'C', "C'", 'D'];
const T3 = ['S', 'A', "S'", "A'", 'S"', 'B', "B'"];
const TB = ['A', 'B', "A'", "B'", 'A"', 'B"'];

const round1 = (x: number) => Math.round(x * 10) / 10;

export function intensityCurve(rng: Rng, k: number): number[] {
  const tpl = k < 5 ? INTENSITY_TEMPLATE.filter((v) => v !== 0.4) : INTENSITY_TEMPLATE;
  const out: number[] = [];
  for (let i = 0; i < k; i++) {
    const x = k === 1 ? 0.5 * (tpl.length - 1) : (i / (k - 1)) * (tpl.length - 1);
    const lo = Math.floor(x);
    const hi = Math.min(tpl.length - 1, lo + 1);
    const v = (tpl[lo] as number) + ((tpl[hi] as number) - (tpl[lo] as number)) * (x - lo);
    out.push(Math.min(1, Math.max(0.3, v + rng.range(-0.04, 0.04))));
  }
  return out;
}

function pickFocus(rng: Rng, p: GenParams, intensity: number): SectionFocus {
  if (intensity < 0.45) return 'break';
  const weights = [
    3, // jumps
    Math.max(0.6, 3 - 0.2 * p.complexity), // flow
    p.streams > 0 ? 0.5 * p.streams * (0.5 + intensity) : 0,
    p.sliders > 0 ? 0.5 * p.sliders * (1.5 - intensity) : 0,
    2, // mixed
  ];
  return (['jumps', 'flow', 'streams', 'sliders', 'mixed'] as const)[rng.weighted(weights)] as SectionFocus;
}

function focusBoost(focus: SectionFocus, kind: PatternKind): number {
  switch (focus) {
    case 'jumps':
      return ['jump', 'backforth', 'triangle', 'square', 'star', 'doubles'].includes(kind) ? 2 : 1;
    case 'flow':
      return kind === 'flow' ? 4 : 1;
    case 'streams':
      return kind === 'stream' || kind === 'burst' ? 4 : 1;
    case 'sliders':
      return kind === 'slider' || kind === 'sliderchain' ? 4 : 1;
    default:
      return 1;
  }
}

interface Tpl {
  tokens: string[];
  streamLetters: boolean;
}

function pickTemplate(rng: Rng, p: GenParams, focus: SectionFocus): Tpl {
  if (focus === 'break') return { tokens: TB, streamLetters: false };
  if (focus === 'streams' && p.streams > 0) return { tokens: T3, streamLetters: true };
  return { tokens: rng.chance(0.5) ? T1 : T2, streamLetters: false };
}

export function builderConfigFor(p: GenParams, setIndex = -1): BuilderConfig {
  return {
    radius: p.radius,
    approachMs: p.approachMs,
    windows: p.windows,
    beatMs: p.beatMs,
    sliderVelocity: p.sliderVelocity,
    tickDistance: p.sliderVelocity * p.beatMs * (p.bpm < 120 ? 0.5 : 1),
    jumpMinRadii: 2.25,
    // Times are rounded to 0.1 ms, so a quarter beat can come out 0.1 ms short.
    minGapMs: Math.max(p.beatMs / 4 - 0.1, 50),
    set: setIndex,
  };
}

/** Generate a whole Dynamic map. `rate` is the Fast or Slow rate, used only for the lead-in. */
export function generateDynamic(launch: LaunchRequest, rate = 1): GeneratedMap {
  const p = deriveParams(launch.difficulty, launch.mods);
  const rng = createRng(launch.seed).fork('dynamic');
  const beat = p.beatMs;
  const t0 = Math.round(rate * Math.max(2000, p.approachMs / rate + 1200) * 10) / 10;
  const lengthMs = Math.max(20000, launch.lengthSec * 1000 * rate);
  const endMs = lengthMs - 1000 * rate;
  const endBeat = Math.max(8, Math.floor((endMs - t0) / beat));
  const secBeats = launch.lengthSec < 45 ? 16 : 32;
  const full = Math.floor(endBeat / secBeats);
  const rem = endBeat - full * secBeats;
  const count = Math.max(1, full + (rem >= 8 ? 1 : 0));
  const curve = intensityCurve(rng.fork('curve'), count);

  const builder = new MapBuilder(builderConfigFor(p), rng.fork('place'));
  const sections: MapSection[] = [];
  const timeAt = (b: number) => round1(t0 + b * beat);
  let cursor = 0;
  let lastSpinStart = -Infinity;

  for (let s = 0; s < count; s++) {
    const secRng = rng.fork(`sec${s}`);
    const I = curve[s] as number;
    const startBeat = cursor;
    const budget = s === count - 1 ? endBeat - startBeat : Math.min(secBeats, endBeat - startBeat);
    if (budget < 4) break;
    const endOfSection = startBeat + budget;
    const focus = pickFocus(secRng, p, I);
    const tpl = pickTemplate(secRng, p, focus);

    // A spinner at the start of the section, when the rules allow it.
    if (p.spinners >= 1 && (focus === 'break' || secRng.chance(0.06 * p.spinners)) && builder.objects.length > 0) {
      const earliest = Math.max(timeAt(startBeat), builder.lastEnd + Math.max(beat, 400) + 0.1);
      const sb = Math.ceil((earliest - t0) / beat - 1e-9);
      const st = timeAt(sb);
      const dur = Math.min(4500, Math.max(1500, secRng.pick([2, 3]) * 4 * beat));
      const afterBeat = Math.ceil((st + dur + Math.max(2 * beat, 600) + 0.2 - t0) / beat - 1e-9);
      if (st >= 8000 && st - lastSpinStart >= 30000 && st + dur + Math.max(2 * beat, 600) <= endMs - 5000 && afterBeat <= endOfSection - 4) {
        const rpm = 1.1 * p.bpm;
        const rot = Math.max(0.5, Math.round(((dur / 1000) * rpm * 2) / 60) / 2);
        builder.addSpinner(st, dur, rot, I);
        lastSpinStart = st;
        cursor = afterBeat;
      }
    }

    const rBeats = endOfSection - cursor >= 12 ? 4 : 0;
    const lib: Record<string, { motif: Motif; info: GroupInfo | null }> = {};

    const pickKind = (letter: string, remaining: number): PatternKind => {
      if (focus === 'break') return letter === 'A' && p.sliders > 0 && secRng.chance(0.4) ? 'slider' : letter === 'B' && p.sliders > 0 ? 'slider' : 'single';
      if (tpl.streamLetters && letter === 'S') return secRng.chance(0.7) ? 'stream' : 'burst';
      const w = patternWeights(p, I);
      const weights = PATTERN_KINDS.map((k) => (w[k] > 0 ? w[k] * focusBoost(focus, k) : 0));
      if (tpl.streamLetters) {
        weights[PATTERN_KINDS.indexOf('stream')] = 0;
        weights[PATTERN_KINDS.indexOf('burst')] = 0;
      }
      void remaining;
      return PATTERN_KINDS[secRng.weighted(weights)] as PatternKind;
    };

    const ctxFor = (maxBeats: number): PatternCtx => ({ rng: secRng, p, intensity: I, maxBeats });
    const place = (m: Motif, opts: Parameters<MapBuilder['addMotif']>[2]) => {
      const res = builder.addMotif(m, timeAt(cursor), opts);
      if (res.ok) cursor += m.beats;
      return res;
    };
    const rest = () => {
      cursor += 1;
      const e = builder.prevEnd;
      if (e) builder.prevEnd = { x: e.x + (500 - e.x) * 0.3, y: e.y + (312.5 - e.y) * 0.3 };
      builder.dirIn = null;
    };

    let copies = 0;
    const tryCopy = (known: { motif: Motif; info: GroupInfo | null }, variant: string, scale: number): boolean => {
      const mirror = { mirrorOf: known.info ?? undefined, intensity: I, requireFull: true };
      const attempts: Parameters<MapBuilder['addMotif']>[2][] = [{ negate: true, scale, intensity: I, requireFull: true }];
      if (variant === '"') attempts.unshift(mirror);
      else attempts.push(mirror);
      for (const shift of [25, -25, 50, -50, 80, -80]) attempts.push({ negate: true, scale, turnShift: shift, intensity: I, requireFull: true });
      for (const f of [0.9, 0.8]) {
        for (const shift of [0, 40, -40]) attempts.push({ negate: true, scale: scale * f, turnShift: shift, intensity: I, requireFull: true });
      }
      for (const o of attempts) {
        if (place(known.motif, o).ok) {
          copies++;
          return true;
        }
      }
      return false;
    };

    const tokens = tpl.tokens;
    for (let ti = 0; ti < tokens.length; ti++) {
      const remaining = endOfSection - rBeats - cursor;
      if (remaining < 1) break;
      const tok = tokens[ti] as string;
      const letter = tok[0] as string;
      const variant = tok.length > 1 ? (tok[1] as string) : '';
      const lastToken = ti === tokens.length - 1;
      const scale = lastToken ? 1.1 : 1;
      const accent = (cursor - startBeat) % 4 === 0 ? 1.2 : 1;
      const known = lib[letter];
      let done = false;
      if (variant !== '' && known && known.motif.beats <= remaining) {
        done = tryCopy(known, variant, scale) || place(known.motif, { negate: true, scale, intensity: I }).ok;
      }
      if (!done && (variant === '' || !known)) {
        let motif = makeMotif(pickKind(letter, remaining), ctxFor(remaining));
        let res = motif ? place(motif, { scale, intensity: I, accent }) : null;
        if (!res || !res.ok) {
          motif = focus === 'break' ? singleRun(ctxFor(remaining)) : makeMotif('jump', ctxFor(remaining));
          res = motif ? place(motif, { scale, intensity: I, accent }) : null;
        }
        if (res && res.ok && motif) lib[letter] = { motif, info: res.info };
        else rest();
      } else if (!done) {
        rest();
      }
    }

    // A section always repeats something. If no copy fit, replay a motif that did.
    if (copies === 0 && focus !== 'break') {
      for (const letter of Object.keys(lib)) {
        const known = lib[letter] as { motif: Motif; info: GroupInfo | null };
        if (known.motif.beats <= endOfSection - rBeats - cursor && tryCopy(known, "'", 1)) break;
      }
    }

    // Fill what the template left.
    let guard = 0;
    while (endOfSection - rBeats - cursor >= 1 && guard++ < 40) {
      const remaining = endOfSection - rBeats - cursor;
      const motif =
        focus === 'break'
          ? singleRun(ctxFor(remaining))
          : makeMotif(secRng.chance(0.3) ? 'flow' : 'jump', ctxFor(remaining));
      const res = motif ? place(motif, { intensity: I }) : null;
      if (!res || !res.ok) rest();
    }

    // The last four beats: a rest, a long slider or two singles.
    if (rBeats > 0 && cursor < endOfSection) {
      const left = endOfSection - cursor;
      if (!secRng.chance(restProb(p))) {
        if (p.sliders > 0 && secRng.chance(0.5)) {
          const spec = makeSliderSpec(ctxFor(left), 3, left - 1);
          if (spec) {
            spec.repeats = 0;
            const m: Motif = {
              tag: 'slider',
              steps: [{ off: 0, dist: jumpDistance(p, 1, I), turn: 0, slider: spec }],
              beats: Math.ceil(spec.passes + 1),
            };
            place(m, { intensity: I });
          }
        } else {
          const m = singleRun(ctxFor(Math.min(2, left)));
          if (m) place(m, { intensity: I });
        }
      }
    }
    cursor = endOfSection;
    sections.push({ start: timeAt(startBeat), end: timeAt(endOfSection), intensity: round1(I * 1000) / 1000, focus });
  }

  // A spinner may not sit in the last 5 s of the map, so drop one that does.
  const tailEnd = (o: HitObject | undefined) => (o ? (o.kind === 'circle' ? o.time : o.endTime) : t0);
  const finalEnd = tailEnd(builder.objects.filter((o) => o.kind !== 'spinner').pop());
  builder.objects = builder.objects.filter((o) => o.kind !== 'spinner' || o.endTime <= finalEnd + 1000 - 5000);
  const objects: HitObject[] = builder.finalize();
  const lastEnd = tailEnd(objects[objects.length - 1]);
  return {
    format: MAP_FORMAT,
    generatorVersion: GENERATOR_VERSION,
    seed: launch.seed >>> 0,
    modeId: 'dynamic',
    beatMs: beat,
    durationMs: round1(lastEnd + 1000),
    health: healthRulesFor(p.density, []),
    objects,
    sections,
    // Beat 0 of the grid, before the rate. applyMods divides it.
    beatOffsetMs: t0,
  };
}
