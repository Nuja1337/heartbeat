// The shape of a Dynamic map before any object exists (PLAN-2 section 6.1): phrases, roles, intensity,
// sections, focus and spinners. Pure. The generator fills the plan in.

import type { SectionFocus, SectionRole } from '../../shared/types';
import type { GenParams } from './difficulty';
import type { MirrorAxis } from './placement';
import type { Rng } from './rng';

/** A phrase is 16 beats: four bars. */
export const PHRASE_BEATS = 16;

export interface Phrase {
  index: number;
  /** Beat of the grid where it starts. Beat 0 is `t0`. */
  startBeat: number;
  beats: number;
  role: SectionRole;
  intensity: number;
  section: number;
}

export interface SectionPlan {
  index: number;
  role: SectionRole;
  focus: SectionFocus;
  startBeat: number;
  endBeat: number;
  firstPhrase: number;
  phraseCount: number;
  /** Mean of its phrases. */
  intensity: number;
  /** The axis to try for a mirrored second half, or null. */
  mirror: MirrorAxis | null;
}

export interface SpinnerPlan {
  section: number;
  startBeat: number;
  durationMs: number;
  rotations: number;
  /** First beat, on a bar line, where content may start again. A rest's spinner may carry it up to a bar into the next section. */
  resumeBeat: number;
}

export interface Structure {
  phrases: Phrase[];
  sections: SectionPlan[];
  spinners: SpinnerPlan[];
  /** Beat where the content ends. */
  endBeat: number;
}

export interface StructureInput {
  p: GenParams;
  /** Time of beat 0, ms. */
  t0: number;
  /** Time the content may run to, ms. */
  endMs: number;
  /** The Fast or Slow rate the map is generated for. Time rules in seconds scale with it. */
  rate: number;
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const round3 = (x: number) => Math.round(x * 1000) / 1000;
const round1 = (x: number) => Math.round(x * 10) / 10;

/** Roles of P phrases, in order. */
export function layoutRoles(P: number): SectionRole[] {
  if (P <= 1) return ['peak'];
  if (P === 2) return ['intro', 'peak'];
  if (P === 3) return ['intro', 'peak', 'outro'];
  const intro = P >= 12 ? 2 : 1;
  const M = P - intro - 1;
  let b = P < 10 ? 1 : 2;
  let k = b;
  // To fit, trim builds first, then peaks, keeping at least one peak.
  while (M < b + k) {
    if (b > 0) b--;
    else if (k > 1) k--;
    else break;
  }
  const blockSize = b + k + 1;
  const n = Math.max(1, Math.floor((M + 1) / blockSize));
  let extra = M - (n * (b + k) + (n - 1));
  // What does not fill a block goes to the last block, peak first, so its peak is the longest.
  let lastPeak = k;
  let lastBuild = b;
  let toPeak = true;
  while (extra > 0) {
    if (toPeak || b === 0) lastPeak++;
    else lastBuild++;
    toPeak = !toPeak;
    extra--;
  }
  const out: SectionRole[] = Array<SectionRole>(intro).fill('intro');
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    for (let j = 0; j < (last ? lastBuild : b); j++) out.push('build');
    for (let j = 0; j < (last ? lastPeak : k); j++) out.push('peak');
    if (!last) out.push('rest');
  }
  out.push('outro');
  return out;
}

const RANK: Record<SectionRole, number> = { intro: 0, build: 1, peak: 2, rest: 0, outro: 0 };

/** Intensity of each phrase: the role's curve, jitter, then a pass that keeps neighbours within 0.2. */
export function phraseIntensities(roles: readonly SectionRole[], rng: Rng): number[] {
  const out: number[] = [];
  let buildLen = 0;
  let buildPos = 0;
  let peakSeen = 0;
  roles.forEach((role, i) => {
    let v: number;
    if (role === 'intro') {
      v = roles[i - 1] === 'intro' ? 0.6 : 0.5;
    } else if (role === 'build') {
      if (roles[i - 1] !== 'build') {
        buildLen = 0;
        while (roles[i + buildLen] === 'build') buildLen++;
        buildPos = 0;
      }
      v = buildLen === 1 ? 0.765 : 0.65 + (0.23 * buildPos) / (buildLen - 1);
      buildPos++;
    } else if (role === 'peak') {
      v = peakSeen === 0 ? 0.95 : 1;
      peakSeen++;
    } else if (role === 'rest') {
      v = 0.35;
    } else {
      v = 0.6;
    }
    out.push(v);
  });
  const jitter = rng.fork('curve');
  for (let i = 0; i < out.length; i++) out[i] = clamp((out[i] as number) + jitter.range(-0.03, 0.03), 0.3, 1);
  // Neighbours differ by 0.2 or less, except into or out of a rest and into the outro, which are meant to drop.
  const free = (i: number) => roles[i] === 'rest' || roles[i - 1] === 'rest' || roles[i] === 'outro';
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (let i = 1; i < out.length; i++) {
      const gap = (out[i] as number) - (out[i - 1] as number);
      if (free(i) || Math.abs(gap) <= 0.2) continue;
      // The lower-ranked phrase gives way, so peaks and builds keep their level.
      const moveEarlier = RANK[roles[i - 1] as SectionRole] <= RANK[roles[i] as SectionRole];
      if (moveEarlier) out[i - 1] = clamp((out[i] as number) - Math.sign(gap) * 0.198, 0.3, 1);
      else out[i] = clamp((out[i - 1] as number) + Math.sign(gap) * 0.198, 0.3, 1);
      moved = true;
    }
    if (!moved) break;
  }
  return out.map(round3);
}

/** Weights for the section focus, in the order jumps, flow, streams, sliders, mixed. */
export function focusWeights(p: GenParams, role: SectionRole, intensity: number, previous: SectionFocus | null): number[] {
  const w = [
    3,
    Math.max(0.6, 3 - 0.2 * p.complexity),
    p.streams > 0 ? 0.5 * p.streams * (0.5 + intensity) : 0,
    p.sliders > 0 ? 0.5 * p.sliders * (1.5 - intensity) : 0,
    2,
  ];
  if (role === 'peak') {
    if (p.streams >= 6) w[2] = (w[2] as number) * 1.5;
    else w[0] = (w[0] as number) * 1.5;
  } else if (role === 'intro') {
    w[1] = (w[1] as number) * 1.5;
    w[3] = (w[3] as number) * 1.5;
  } else if (role === 'outro') {
    w[4] = (w[4] as number) * 2;
  }
  // Neighbouring sections read as different parts when their focus differs.
  const FOCI: SectionFocus[] = ['jumps', 'flow', 'streams', 'sliders', 'mixed'];
  const at = previous ? FOCI.indexOf(previous) : -1;
  if (at >= 0) w[at] = (w[at] as number) * 0.4;
  return w;
}

const FOCI: SectionFocus[] = ['jumps', 'flow', 'streams', 'sliders', 'mixed'];

/** Spinner length and turns: 8 or 12 beats clamped to 1.5 to 4.5 s, at 1.1 turns per beat per minute. */
export function spinnerShape(p: GenParams, k: 2 | 3): { durationMs: number; rotations: number } {
  const dur0 = clamp(k * 4 * p.beatMs, 1500, 4500);
  const rpm = 1.1 * p.bpm;
  const rotations = Math.max(0.5, Math.round(((dur0 / 1000) * rpm * 2) / 60) / 2);
  // The duration follows the turns, so the demand is the rpm to within the clamp.
  const durationMs = round1(clamp((rotations * 60000) / rpm, 1500, 4500));
  return { durationMs, rotations };
}

export function planStructure(input: StructureInput, rng: Rng): Structure {
  const { p, t0, endMs } = input;
  const beat = p.beatMs;
  const body = Math.max(0, Math.floor((endMs - t0) / beat));
  let P = Math.floor(body / PHRASE_BEATS);
  const tail = body - P * PHRASE_BEATS;
  let endBeat: number;
  if (P < 1) {
    P = 1;
    endBeat = Math.max(8, body);
  } else {
    endBeat = P * PHRASE_BEATS + (tail >= 4 ? tail : 0);
  }
  const roles = layoutRoles(P);
  const intens = phraseIntensities(roles, rng);

  const phrases: Phrase[] = roles.map((role, i) => ({
    index: i,
    startBeat: i * PHRASE_BEATS,
    beats: i === roles.length - 1 ? endBeat - i * PHRASE_BEATS : PHRASE_BEATS,
    role,
    intensity: intens[i] as number,
    section: 0,
  }));

  // Sections are runs of one role.
  const sections: SectionPlan[] = [];
  for (const ph of phrases) {
    const last = sections[sections.length - 1];
    if (last && last.role === ph.role) {
      last.phraseCount++;
      last.endBeat = ph.startBeat + ph.beats;
    } else {
      sections.push({
        index: sections.length,
        role: ph.role,
        focus: 'mixed',
        startBeat: ph.startBeat,
        endBeat: ph.startBeat + ph.beats,
        firstPhrase: ph.index,
        phraseCount: 1,
        intensity: 0,
        mirror: null,
      });
    }
    ph.section = sections.length - 1;
  }
  let prevFocus: SectionFocus | null = null;
  for (const s of sections) {
    const mine = phrases.slice(s.firstPhrase, s.firstPhrase + s.phraseCount);
    s.intensity = round3(mine.reduce((a, b) => a + b.intensity, 0) / mine.length);
    const fr = rng.fork(`focus${s.index}`);
    s.focus = s.role === 'rest' ? 'break' : (FOCI[fr.weighted(focusWeights(p, s.role, s.intensity, prevFocus))] as SectionFocus);
    prevFocus = s.focus;
    // Mirrored second halves: build and peak sections with an even number of phrases.
    if ((s.role === 'build' || s.role === 'peak') && s.phraseCount >= 2 && s.phraseCount % 2 === 0 && p.complexity >= 4) {
      const mr = rng.fork(`mirror${s.index}`);
      if (mr.chance(0.25)) s.mirror = (['v', 'h', 'c'] as const)[mr.weighted([0.6, 0.25, 0.15])] as MirrorAxis;
    }
  }

  const spinners = planSpinners(input, rng, sections, endBeat);
  return { phrases, sections, spinners, endBeat };
}

function planSpinners(input: StructureInput, rng: Rng, sections: SectionPlan[], endBeat: number): SpinnerPlan[] {
  const { p, t0, rate } = input;
  if (p.spinners < 1) return [];
  const beat = p.beatMs;
  const lead = Math.max(1, Math.ceil(400 / beat - 1e-9));
  const timeAt = (b: number) => round1(t0 + b * beat);
  const cands: { section: number; startBeat: number; prob: number }[] = [];
  const lastIdx = sections.length - 1;
  for (const s of sections) {
    if (s.role === 'rest' && s.index < lastIdx)
      cands.push({ section: s.index, startBeat: s.startBeat + lead, prob: Math.min(1, 0.15 * p.spinners) });
  }
  // The start of the last build before the final peak.
  let finalPeak = -1;
  sections.forEach((s) => {
    if (s.role === 'peak') finalPeak = s.index;
  });
  const before = sections[finalPeak - 1];
  if (finalPeak > 0 && before && before.role === 'build' && before.index < lastIdx) {
    cands.push({ section: before.index, startBeat: before.startBeat + lead, prob: Math.min(1, 0.05 * p.spinners) });
  }
  cands.sort((a, b) => a.startBeat - b.startBeat);
  const out: SpinnerPlan[] = [];
  let lastStart = -Infinity;
  const contentEnd = timeAt(endBeat - 8);
  for (const c of cands) {
    const r = rng.fork(`spin${c.section}`);
    const hit = r.chance(c.prob);
    const k = r.pick([2, 3] as const);
    if (!hit) continue;
    const sec = sections[c.section] as SectionPlan;
    if (sec.role === 'intro' || sec.role === 'outro') continue;
    const st = timeAt(c.startBeat);
    const { durationMs, rotations } = spinnerShape(p, k);
    if (st < 8000 * rate || st - lastStart < 30000 * rate) continue;
    if (st + durationMs > contentEnd - 5000 * rate) continue;
    const after = st + durationMs + Math.max(2 * beat, 600) + 0.2;
    let resume = Math.ceil((after - t0) / beat - 1e-9);
    resume += (4 - (resume % 4)) % 4;
    // A build keeps at least one bar after the spinner. A rest may end with it, and the next section starts up to a bar late.
    if (sec.role === 'build' && resume > sec.endBeat - 4) continue;
    if (sec.role === 'rest' && resume > sec.endBeat + 4) continue;
    out.push({ section: c.section, startBeat: c.startBeat, durationMs, rotations, resumeBeat: resume });
    lastStart = st;
  }
  return out;
}
