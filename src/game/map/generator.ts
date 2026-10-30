// The Dynamic map generator (PLAN section 7, PLAN-2 section 6). planStructure decides the phrases, roles, sections
// and spinners; this file fills each phrase with motifs that repeat and vary.

import { MAP_FORMAT } from '../../shared/catalog';
import type { GeneratedMap, HitObject, LaunchRequest, MapSection, SectionFocus } from '../../shared/types';
import { GENERATOR_VERSION } from '../version';
import { deriveParams, jumpDistance, patternWeights, PATTERN_KINDS, restProb } from './difficulty';
import type { GenParams, PatternKind } from './difficulty';
import { MapBuilder } from './placement';
import type { BuilderConfig, GroupInfo, MirrorAxis, Motif } from './placement';
import { makeMotif, makeSliderSpec, singleRun, turnSource } from './patterns';
import type { PatternCtx } from './patterns';
import { planStructure } from './structure';
import type { Phrase, SectionPlan, Structure } from './structure';
import { createRng } from './rng';
import type { Rng } from './rng';
import { healthRulesFor } from '../rules/scoring';

const round1 = (x: number) => Math.round(x * 10) / 10;

/** One bar token of a phrase scheme. `L` names a motif of the section, `v` marks a variation of it. */
interface Tok {
  L: string;
  v: '' | "'" | '"';
  bars: 1 | 2;
}

const t = (L: string, v: Tok['v'] = '', bars: 1 | 2 = 1): Tok => ({ L, v, bars });

const SCHEMES_GENERAL: Tok[][] = [
  [t('A'), t('A', "'"), t('B'), t('A', '"')],
  [t('A'), t('B'), t('A', "'"), t('B', "'")],
  [t('A'), t('A', "'"), t('B'), t('B', "'")],
  [t('A'), t('B'), t('A', "'"), t('C')],
];
const SCHEMES_STREAMS: Tok[][] = [
  [t('S'), t('A'), t('S', "'"), t('A', "'")],
  [t('S', '', 2), t('A'), t('A', "'")],
  [t('S'), t('S', "'"), t('A'), t('S', '"')],
  [t('S'), t('A'), t('S', "'"), t('B')],
];
const SCHEMES_BREAK: Tok[][] = [
  [t('A'), t('A', "'"), t('L', '', 2)],
  [t('A'), t('L', '', 2), t('A', "'")],
];
const SCHEME_BREAK_PLAIN: Tok[] = [t('A'), t('A', "'"), t('A', '"'), t('A')];

const STREAM_KINDS: PatternKind[] = ['stream', 'burst', 'triple', 'cutstream', 'spacedstream'];

function focusBoost(focus: SectionFocus, kind: PatternKind): number {
  switch (focus) {
    case 'jumps':
      return ['jump', 'backforth', 'triangle', 'square', 'star', 'doubles', 'polygon', 'stack'].includes(kind) ? 2 : 1;
    case 'flow':
      return kind === 'flow' ? 4 : 1;
    case 'streams':
      return STREAM_KINDS.includes(kind) ? 4 : 1;
    case 'sliders':
      return kind === 'slider' || kind === 'sliderchain' || kind === 'kick' ? 4 : 1;
    default:
      return 1;
  }
}

export function builderConfigFor(p: GenParams, setIndex = -1, originMs?: number): BuilderConfig {
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
    originMs,
  };
}

/* ------------------------------------------------------------ state */

interface Known {
  motif: Motif;
  info: GroupInfo;
  phrase: number;
}

interface Placed {
  /** Beats after the section start. */
  rel: number;
  info: GroupInfo;
  phrase: number;
}

interface SecState {
  sp: SectionPlan;
  rng: Rng;
  turns: () => number;
  lib: Map<string, Known>;
  /** Kinds already used in the section, so its letters differ from each other. */
  used: Map<PatternKind, number>;
  /** Filled while the first half of a mirrored section is written. */
  events: Placed[] | null;
  /** First beat that may hold content. A spinner pushes it forward. */
  resume: number;
}

interface G {
  p: GenParams;
  builder: MapBuilder;
  beat: number;
  t0: number;
  plan: Structure;
  timeAt: (b: number) => number;
  /** First beat the next section may use, after a spinner that ran past the end of its own. */
  carry: number;
}

/* ---------------------------------------------------------- schemes */

function schemeFor(g: G, st: SecState, ph: Phrase, bars: number): Tok[] {
  const rng = st.rng.fork(`scheme${ph.index}`);
  const focus = st.sp.focus;
  let base: Tok[];
  if (focus === 'break') {
    base = g.p.sliders > 0 && g.p.sliderVelocity * g.beat * 2 >= 2.5 * g.p.radius ? rng.pick(SCHEMES_BREAK) : SCHEME_BREAK_PLAIN;
  } else if (focus === 'streams' && g.p.streams > 0) {
    base = rng.pick(SCHEMES_STREAMS);
    // Long streams take two bars.
    if (g.p.streamMaxLength <= 12) base = base.map((x) => (x.L === 'S' ? { ...x, bars: 1 as const } : x));
  } else {
    base = rng.pick(SCHEMES_GENERAL);
  }
  const out: Tok[] = [];
  let used = 0;
  for (const tok of base) {
    if (used + tok.bars > bars) {
      if (used < bars) out.push({ ...tok, bars: 1 });
      used = bars;
      break;
    }
    out.push(tok);
    used += tok.bars;
  }
  // Longer phrases (an outro with a tail) restate the first motif.
  while (used < bars) {
    out.push(t('A', used % 2 === 0 ? '"' : "'"));
    used++;
  }
  return out;
}

/* ----------------------------------------------------------- motifs */

function patternCtx(g: G, st: SecState, intensity: number, maxBeats: number): PatternCtx {
  return { rng: st.rng, p: g.p, intensity, maxBeats, turns: st.turns };
}

function pickKind(g: G, st: SecState, letter: string, intensity: number, maxBeats: number): PatternKind {
  const focus = st.sp.focus;
  const p = g.p;
  if (focus === 'break') return 'single';
  const w = patternWeights(p, intensity);
  const weights = PATTERN_KINDS.map((k) => {
    if (w[k] <= 0) return 0;
    // Streams belong to the S letters of a streams section and nowhere else in it.
    if (focus === 'streams' && STREAM_KINDS.includes(k)) return letter === 'S' ? w[k] * 4 : 0;
    return w[k] * focusBoost(focus, k);
  });
  if (focus === 'streams' && letter === 'S') {
    for (let i = 0; i < PATTERN_KINDS.length; i++) if (!STREAM_KINDS.includes(PATTERN_KINDS[i] as PatternKind)) weights[i] = 0;
    // A one-bar S holds a short stream, a burst or a triple.
    if (maxBeats < 3) for (const k of ['stream', 'cutstream', 'spacedstream'] as const) weights[PATTERN_KINDS.indexOf(k)] = 0;
    if (weights.every((x) => x === 0)) return 'stream';
  }
  const kind = PATTERN_KINDS[st.rng.weighted(weights.map((w, i) => w * 0.3 ** (st.used.get(PATTERN_KINDS[i] as PatternKind) ?? 0)))] as PatternKind;
  st.used.set(kind, (st.used.get(kind) ?? 0) + 1);
  return kind;
}

/** A single long slider for the rest. */
function longSliderMotif(g: G, st: SecState, intensity: number, maxBeats: number): Motif | null {
  const ctx = patternCtx(g, st, intensity, maxBeats);
  const spec = makeSliderSpec(ctx, 3, Math.min(4, maxBeats - 1));
  if (!spec) return null;
  const total = spec.passes * (spec.repeats + 1);
  return {
    tag: 'slider',
    steps: [{ off: 0, dist: jumpDistance(g.p, 1, intensity), turn: st.turns(), slider: spec }],
    beats: Math.ceil(total + 1),
  };
}

interface Flags {
  /** Last token of the phrase. */
  last: boolean;
  /** Leave the last beat empty. */
  short: boolean;
  /** The last token of the map. */
  ending: boolean;
  /** Scale of the connecting jump and the jumps in it. */
  scale: number;
}

function placeToken(g: G, st: SecState, ph: Phrase, tok: Tok, barStart: number, f: Flags): void {
  const I = ph.intensity;
  const maxBeats = tok.bars * 4 - (f.short ? 1 : 0);
  const time = g.timeAt(barStart);
  const rel = barStart - st.sp.startBeat;
  const record = (res: { ok: boolean; info: GroupInfo | null }) => {
    if (res.ok && res.info) st.events?.push({ rel, info: res.info, phrase: ph.index });
    return res.ok;
  };
  const place = (m: Motif, o: Parameters<MapBuilder['addMotif']>[2]) => {
    const res = g.builder.addMotif(m, time, o);
    record(res);
    return res;
  };

  if (f.ending) {
    // The map ends on a downbeat: a long slider, or one note.
    let m: Motif | null = null;
    if (g.p.sliders > 0 && st.rng.chance(0.5)) m = longSliderMotif(g, st, I, 4);
    if (m && m.steps[0]) (m.steps[0].slider as NonNullable<typeof m.steps[0]['slider']>).repeats = 0;
    if (!m || !place(m, { intensity: I }).ok) {
      const one: Motif = { tag: 'single', steps: [{ off: 0, dist: jumpDistance(g.p, 1, I), turn: st.turns() * 0.6 }], beats: 1 };
      place(one, { intensity: I });
    }
    return;
  }

  const copyAttempts = (known: Known, variant: Tok['v']): boolean => {
    const attempts: Parameters<MapBuilder['addMotif']>[2][] = [];
    const base = { scale: f.scale, intensity: I, requireFull: true };
    const mirror: Parameters<MapBuilder['addMotif']>[2] = { ...base, mirror: { source: known.info, axis: 'v' } };
    attempts.push({ ...base, negate: true });
    if (variant === '"') attempts.unshift(mirror);
    else attempts.push(mirror);
    for (const shift of [25, -25, 50, -50, 80, -80]) attempts.push({ ...base, negate: true, turnShift: shift });
    for (const s of [0.9, 0.8]) for (const shift of [0, 40, -40]) attempts.push({ ...base, scale: f.scale * s, negate: true, turnShift: shift });
    for (const o of attempts) {
      // The mirror option replays absolute positions, so it never takes a scale.
      if (place(known.motif, o).ok) return true;
    }
    return false;
  };

  const known = st.lib.get(tok.L);
  const restating = known !== undefined && (tok.v !== '' || known.phrase !== ph.index);
  if (known && restating && known.motif.beats <= maxBeats) {
    if (copyAttempts(known, tok.v === '' ? "'" : tok.v)) return;
    if (place(known.motif, { negate: true, scale: f.scale, intensity: I }).ok) return;
  }

  // A new motif for this letter.
  const accent = 1.2;
  const ctx = patternCtx(g, st, I, maxBeats);
  let motif: Motif | null = null;
  if (st.sp.focus === 'break') {
    motif = tok.L === 'L' ? longSliderMotif(g, st, I, maxBeats) : singleRun(ctx);
  } else {
    motif = makeMotif(pickKind(g, st, tok.L, I, maxBeats), ctx);
  }
  let res = motif ? place(motif, { scale: f.scale, intensity: I, accent }) : null;
  if (!res || !res.ok) {
    motif = st.sp.focus === 'break' ? singleRun(patternCtx(g, st, I, Math.min(maxBeats, 4))) : makeMotif('jump', ctx);
    res = motif ? place(motif, { scale: f.scale, intensity: I, accent }) : null;
  }
  if (res && res.ok && res.info && motif) st.lib.set(tok.L, { motif, info: res.info, phrase: ph.index });
}

function genPhrase(g: G, st: SecState, ph: Phrase): void {
  const sp = st.sp;
  const bars = Math.floor(ph.beats / 4);
  const tokens = schemeFor(g, st, ph, bars);
  const lastPhraseOfMap = ph.index === g.plan.phrases.length - 1;
  const nextRole = g.plan.phrases[ph.index + 1]?.role;
  const lastOfSection = ph.index === sp.firstPhrase + sp.phraseCount - 1;
  // Where the phrase ends, a breath before a rest, and now and then elsewhere.
  const breath = lastOfSection && nextRole === 'rest' ? true : st.rng.chance(restProb(g.p) * (ph.role === 'peak' ? 0.5 : 1));
  const emptyLastBar = ph.role === 'intro' && !lastPhraseOfMap && st.rng.chance(0.5);
  let bar = 0;
  tokens.forEach((tok, ti) => {
    const barStart = ph.startBeat + 4 * bar;
    bar += tok.bars;
    const last = ti === tokens.length - 1;
    if (barStart < st.resume) return;
    if (emptyLastBar && last) return;
    const buildLead = last && lastOfSection && sp.role === 'build';
    placeToken(g, st, ph, tok, barStart, {
      last,
      short: last && breath && !lastPhraseOfMap,
      ending: last && lastPhraseOfMap,
      scale: buildLead ? 1.1 : 1,
    });
  });
}

/** Replay the first half of a section with every position mirrored. All or nothing. */
function mirrorSecondHalf(g: G, st: SecState, half: number): boolean {
  const sp = st.sp;
  const events = st.events as Placed[];
  if (events.length === 0) return false;
  const halfBeats = half * 16;
  const axes: MirrorAxis[] = [sp.mirror as MirrorAxis, ...(['v', 'h', 'c'] as const).filter((a) => a !== sp.mirror)];
  const snap = g.builder.snapshot();
  for (const axis of axes) {
    let ok = true;
    for (const ev of events) {
      const ph = g.plan.phrases[ev.phrase + half] as Phrase;
      const res = g.builder.addMotif(ev.info.motif, g.timeAt(sp.startBeat + ev.rel + halfBeats), { mirror: { source: ev.info, axis }, intensity: ph.intensity });
      if (!res.ok) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
    g.builder.restore(snap);
  }
  return false;
}

function genSection(g: G, sp: SectionPlan, rng: Rng): boolean {
  const st: SecState = { sp, rng, turns: turnSource(rng.fork('turns'), g.p), lib: new Map(), used: new Map(), events: null, resume: Math.max(sp.startBeat, g.carry) };
  const spin = g.plan.spinners.find((s) => s.section === sp.index);
  const first = g.plan.phrases[sp.firstPhrase] as Phrase;
  if (spin) {
    g.builder.addSpinner(g.timeAt(spin.startBeat), spin.durationMs, spin.rotations, first.intensity);
    st.resume = spin.resumeBeat;
    g.carry = spin.resumeBeat;
  }
  const mirrorable = sp.mirror !== null && !spin;
  const half = sp.phraseCount / 2;
  if (mirrorable) st.events = [];
  let mirrored = false;
  for (let i = 0; i < sp.phraseCount; i++) {
    if (mirrorable && i === half) {
      mirrored = mirrorSecondHalf(g, st, half);
      st.events = null;
      if (mirrored) break;
    }
    genPhrase(g, st, g.plan.phrases[sp.firstPhrase + i] as Phrase);
  }
  return mirrored;
}

/** Generate a whole Dynamic map. `rate` is the Fast or Slow rate, used only for the lead-in. */
export function generateDynamic(launch: LaunchRequest, rate = 1): GeneratedMap {
  const p = deriveParams(launch.difficulty, launch.mods);
  const rng = createRng(launch.seed).fork('dynamic');
  const beat = p.beatMs;
  const t0 = Math.round(rate * Math.max(2000, p.approachMs / rate + 1200) * 10) / 10;
  const lengthMs = Math.max(20000, launch.lengthSec * 1000 * rate);
  const endMs = lengthMs - 1000 * rate;
  const plan = planStructure({ p, t0, endMs, rate }, rng.fork('structure'));
  const builder = new MapBuilder(builderConfigFor(p, -1, t0), rng.fork('place'));
  const g: G = { p, builder, beat, t0, plan, timeAt: (b) => round1(t0 + b * beat), carry: 0 };

  const sections: MapSection[] = [];
  for (const sp of plan.sections) {
    const mirrored = genSection(g, sp, rng.fork(`sec${sp.index}`));
    sections.push({
      start: g.timeAt(sp.startBeat),
      end: g.timeAt(sp.endBeat),
      intensity: sp.intensity,
      focus: sp.focus,
      role: sp.role,
      ...(mirrored ? { mirrored: true } : {}),
    });
  }

  const objects: HitObject[] = builder.finalize();
  const tailEnd = (o: HitObject | undefined) => (o ? (o.kind === 'circle' ? o.time : o.endTime) : t0);
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
