// The rules a generated Dynamic map must hold (PLAN section 7, PLAN-2 section 6.4), as checks over the final objects.
// Used by the generator tests. Everything here reads the finished map, never the generator's own state.

import { PLAYFIELD, PLAYFIELD_CENTER } from '../../shared/catalog';
import type { GeneratedMap, HitObject, SliderObject } from '../../shared/types';
import { minCurvatureRadius, flattenPath, samplePath, arcThrough } from '../map/path';
import type { FlatPath } from '../map/path';

export const endTime = (o: HitObject) => (o.kind === 'circle' ? o.time : o.endTime);

/** Dense samples of an object's shape as x, y pairs: its center, or its slider body. */
export function shape(o: HitObject, step = 8): number[] {
  if (o.kind !== 'slider') return [o.pos.x, o.pos.y];
  return Array.from(samplePath(flattenPath(o.pos, o.path), step));
}

function minDist(a: number[], b: number[]): number {
  let best = Infinity;
  for (let i = 0; i < a.length; i += 2) for (let j = 0; j < b.length; j += 2) best = Math.min(best, Math.hypot(a[i]! - b[j]!, a[i + 1]! - b[j + 1]!));
  return best;
}

/** Notes of a stream or burst are close together by design. */
export const isStreamish = (o: HitObject) => o.pattern === 'stream' || o.pattern === 'burst' || o.pattern === 'cutstream';

/** Patterns whose 1/4-beat notes rule 11 does not count. */
const QUARTER_OK = new Set(['stream', 'cutstream', 'spacedstream', 'burst']);

function crossing(pts: number[], a: number, b: number): boolean {
  const [ax, ay, bx, by] = [pts[2 * a]!, pts[2 * a + 1]!, pts[2 * a + 2]!, pts[2 * a + 3]!];
  const [cx, cy, dx, dy] = [pts[2 * b]!, pts[2 * b + 1]!, pts[2 * b + 2]!, pts[2 * b + 3]!];
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Problems with one slider's body: crossing, tight bends, leaving the field, doubling back. */
export function sliderShapeProblems(s: SliderObject, label: string): string[] {
  const out: string[] = [];
  const r = s.radius;
  const follow = s.followRadius;
  const flat: FlatPath = flattenPath(s.pos, s.path);
  const pts = Array.from(samplePath(flat, 4));
  const n = pts.length / 2;
  // 1. No crossing. A single line cannot cross itself, and its collinear samples would only give rounding noise.
  const isLine = s.path.length === 1 && s.path[0]!.type === 'line';
  for (let a = 0; a < (isLine ? 0 : n - 1); a++) {
    for (let b = a + 2; b < n - 1; b++) {
      if (crossing(pts, a, b)) {
        out.push(`self cross ${label}`);
        a = n;
        break;
      }
    }
  }
  // 2. Radius of curvature, from the definition and from the samples.
  const exact = minCurvatureRadius(s.pos, s.path);
  if (exact < follow * 0.99) out.push(`curvature ${label} ${exact.toFixed(1)} < ${follow}`);
  const h = 0.35 * follow;
  const at = (d: number): [number, number] => {
    const t = Math.max(0, Math.min(flat.length, d)) / flat.length;
    const k = Math.min(n - 1, Math.round(t * (n - 1)));
    return [pts[2 * k]!, pts[2 * k + 1]!];
  };
  for (let d = h; d <= flat.length - h; d += h / 2) {
    const [ax, ay] = at(d - h);
    const [bx, by] = at(d);
    const [cx, cy] = at(d + h);
    const area2 = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
    if (area2 < 1e-6) continue;
    const R = (Math.hypot(bx - ax, by - ay) * Math.hypot(cx - bx, cy - by) * Math.hypot(cx - ax, cy - ay)) / (2 * area2);
    if (R < 0.8 * follow) {
      out.push(`sampled curvature ${label} ${R.toFixed(1)}`);
      break;
    }
  }
  // 3. Inside the field.
  for (let k = 0; k < n; k++) {
    const x = pts[2 * k]!;
    const y = pts[2 * k + 1]!;
    if (x < r + 8 - 0.01 || x > PLAYFIELD.width - r - 8 + 0.01 || y < r + 8 - 0.01 || y > PLAYFIELD.height - r - 8 + 0.01) {
      out.push(`body out of bounds ${label}`);
      break;
    }
  }
  // 4. No doubling back: the direction of travel stays within 100 degrees of the line from head to tail,
  //    and parts far apart along the path keep clear of each other.
  const cx = pts[2 * n - 2]! - pts[0]!;
  const cy = pts[2 * n - 1]! - pts[1]!;
  const cl = Math.hypot(cx, cy);
  for (let k = 0; k < n - 1; k++) {
    const dx = pts[2 * k + 2]! - pts[2 * k]!;
    const dy = pts[2 * k + 3]! - pts[2 * k + 1]!;
    const l = Math.hypot(dx, dy);
    if (l < 1e-9 || cl < 1e-9) continue;
    const ang = (Math.acos(Math.max(-1, Math.min(1, (dx * cx + dy * cy) / (l * cl)))) * 180) / Math.PI;
    if (ang > 100.5) {
      out.push(`doubles back ${label} ${ang.toFixed(0)}`);
      break;
    }
  }
  const step = flat.length / (n - 1);
  const gap = Math.ceil((4 * r) / step);
  fold: for (let a = 0; a < n; a++) {
    for (let b = a + gap; b < n; b++) {
      if (Math.hypot(pts[2 * a]! - pts[2 * b]!, pts[2 * a + 1]! - pts[2 * b + 1]!) < 1.95 * r) {
        out.push(`folds back ${label}`);
        break fold;
      }
    }
  }
  // 5. A zigzag bends 60 to 100 degrees at each corner (PLAN-2 4.11). A bend gentler than that is not a zigzag.
  if (sliderFamily(s) === 'zigzag') {
    const heads: number[] = [];
    let from = s.pos;
    for (const seg of s.path) {
      if (seg.type === 'line') heads.push(Math.atan2(seg.to.y - from.y, seg.to.x - from.x));
      from = seg.to;
    }
    for (let k = 1; k < heads.length; k++) {
      let bend = Math.abs(((heads[k]! - heads[k - 1]!) * 180) / Math.PI) % 360;
      if (bend > 180) bend = 360 - bend;
      // The ends of the arcs are rounded to a tenth of a unit, which moves a short leg's heading a little.
      if (bend < 58.5 || bend > 101.5) out.push(`zigzag bend ${label} ${bend.toFixed(1)}`);
    }
  }
  // 6. The shape label matches the segments.
  const kinds = s.path.map((p) => p.type);
  const want = kinds.length === 1 && kinds[0] === 'line' ? 'straight' : kinds.length === 1 && kinds[0] === 'arc' ? 'arc' : 'curve';
  if (s.shape !== want) out.push(`shape label ${label} ${s.shape} vs ${want}`);
  return out;
}

/** Which drawing a slider uses, read from its segments. */
export function sliderFamily(s: SliderObject): 'straight' | 'arc' | 'cubic' | 'wave' | 'hook' | 'zigzag' {
  const kinds = s.path.map((p) => p.type);
  if (kinds.length === 1) return kinds[0] === 'line' ? 'straight' : kinds[0] === 'arc' ? 'arc' : 'cubic';
  if (kinds.every((k) => k === 'cubic')) return 'wave';
  if (kinds.filter((k) => k === 'line').length >= 2) return 'zigzag';
  return 'hook';
}

export interface RuleOptions {
  /** Hit-object lengths of the launch, for the 8 s and 5 s spinner rules. Defaults to the map's own end. */
  checkPhrases?: boolean;
}

/**
 * Every rule. Returns a list of violations, empty when the map is clean.
 * `rate` is the Fast or Slow rate the map was generated for. The map is in source time, which is play time times the
 * rate, so the rules that are written in seconds of play (spinner start and end) scale with it.
 */
export function violations(map: GeneratedMap, rate = 1): string[] {
  const out: string[] = [];
  const objs = map.objects;
  const first = objs[0];
  if (!first) return ['empty'];
  const r = first.radius;
  const eps = 0.02 * r;
  const cache = objs.map((o) => shape(o));
  const beat = map.beatMs;
  const t0 = map.beatOffsetMs ?? 0;
  const minGap = Math.max(beat / 4 - 0.1, 50);

  if (Math.hypot(first.pos.x - PLAYFIELD_CENTER.x, first.pos.y - PLAYFIELD_CENTER.y) > 100.01) out.push('first object far from center');

  objs.forEach((o, i) => {
    if (o.index !== i) out.push(`index ${i}`);
    if (Math.abs(o.time * 10 - Math.round(o.time * 10)) > 1e-6) out.push(`time grid ${i}`);
    if (o.kind !== 'spinner') {
      for (let k = 0; k < cache[i]!.length; k += 2) {
        const x = cache[i]![k]!;
        const y = cache[i]![k + 1]!;
        if (x < r + 8 - 0.01 || x > PLAYFIELD.width - r - 8 + 0.01 || y < r + 8 - 0.01 || y > PLAYFIELD.height - r - 8 + 0.01) {
          out.push(`bounds ${i}`);
          break;
        }
      }
    }
  });

  const sameStack = (a: HitObject, b: HitObject) => a.pattern === 'stack' && b.pattern === 'stack' && a.group === b.group;

  for (let i = 1; i < objs.length; i++) {
    const a = objs[i - 1]!;
    const b = objs[i]!;
    if (b.time - endTime(a) < minGap - 1e-6) out.push(`gap ${i}`);
    if (a.kind === 'spinner' || b.kind === 'spinner') continue;
    if (sameStack(a, b)) {
      // Rule 9: a stack shares one position exactly.
      if (a.pos.x !== b.pos.x || a.pos.y !== b.pos.y) out.push(`stack moved ${i}`);
      continue;
    }
    if (a.kind === 'slider') {
      if (minDist(cache[i - 1]!, cache[i]!) < 2.1 * r - eps) out.push(`after slider ${i}`);
    } else if (isStreamish(a) && isStreamish(b) && a.group === b.group) {
      if (Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) < 0.6 * r - 0.01) out.push(`stream spacing ${i}`);
    } else if (Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) < 2.2 * r - 0.01) {
      out.push(`jump ${i}`);
    }
    // Rule 9: the object after a stack keeps 2.2 radii from it.
    if (a.pattern === 'stack' && b.pattern !== 'stack' && Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) < 2.2 * r - 0.01) out.push(`after stack ${i}`);
  }

  // Visible together.
  for (let j = 2; j < objs.length; j++) {
    const b = objs[j]!;
    if (b.kind === 'spinner') continue;
    for (let i = j - 2; i >= 0; i--) {
      const a = objs[i]!;
      if (a.time + 8000 < b.time - b.approachMs) break;
      if (a.kind === 'spinner') continue;
      if (b.time - b.approachMs > endTime(a) + 100) continue;
      if (sameStack(a, b)) continue;
      const d = minDist(cache[i]!, cache[j]!);
      if (isStreamish(a) && isStreamish(b) && a.group === b.group) {
        const s = Math.hypot(objs[j - 1]!.pos.x - objs[j - 2]!.pos.x, objs[j - 1]!.pos.y - objs[j - 2]!.pos.y);
        const need = Math.min(2.1 * r, 0.8 * (j - i) * s) - eps;
        if (d < need) out.push(`fold-back ${i},${j}`);
      } else if (d < 2.1 * r - eps) {
        out.push(`near ${i},${j}`);
      }
    }
  }

  // Sliders: length and timing, then the shape rules.
  objs.forEach((o, i) => {
    if (o.kind === 'slider') {
      const s: SliderObject = o;
      const flat = flattenPath(s.pos, s.path);
      if (s.length < 2.4 * r - 0.01 || s.length > 600.01) out.push(`slider length ${i}`);
      if (Math.abs(flat.length - s.length) / s.length > 0.005) out.push(`slider flat ${i}`);
      if (Math.abs(s.spanMs * s.velocity - s.length) > 0.01 * s.length) out.push(`slider span ${i}`);
      if (Math.abs(s.endTime - (s.time + s.spanMs * (s.repeats + 1))) > 0.2) out.push(`slider end ${i}`);
      let p = s.pos;
      for (const seg of s.path) {
        if (seg.type === 'arc') {
          const arc = arcThrough(p, seg.through, seg.to);
          if (arc) {
            const chord = Math.hypot(seg.to.x - p.x, seg.to.y - p.y);
            const mid = { x: (p.x + seg.to.x) / 2, y: (p.y + seg.to.y) / 2 };
            const sag = Math.hypot(seg.through.x - mid.x, seg.through.y - mid.y);
            if (sag / chord > 0.6 + 1e-6) out.push(`sagitta ${i}`);
          }
        }
        p = seg.to;
      }
      out.push(...sliderShapeProblems(s, String(i)));
    }
    if (o.kind === 'spinner') {
      const prev = objs[i - 1];
      const next = objs[i + 1];
      if (o.time < 8000 * rate - 1e-6) out.push(`spinner early ${i}`);
      if (o.endTime > map.durationMs - 5000 * rate + 0.5) out.push(`spinner late ${i}`);
      if (prev && o.time - endTime(prev) < Math.max(beat, 400) - 1e-6) out.push(`spinner before ${i}`);
      if (!next) out.push(`spinner last ${i}`);
      if (next) {
        if (next.time - o.endTime < Math.max(2 * beat, 600) - 1e-6) out.push(`spinner after ${i}`);
        if (Math.hypot(next.pos.x - PLAYFIELD_CENTER.x, next.pos.y - PLAYFIELD_CENTER.y) > 250.01) out.push(`spinner next far ${i}`);
      }
      const dur = o.endTime - o.time;
      if (dur < 1500 - 0.2 || dur > 4500 + 0.2) out.push(`spinner duration ${i}`);
    }
  });

  // Rule 10: a jump is at most 1.6 times the one before at the same gap, unless it lands on a bar downbeat.
  const endAt = (o: HitObject) => (o.kind === 'slider' ? (o.repeats % 2 === 0 ? o.path[o.path.length - 1]!.to : o.pos) : o.pos);
  const isDown = (time: number) => {
    const bars = (time - t0) / (beat * 4);
    return Math.abs(bars - Math.round(bars)) * 4 < 0.05;
  };
  for (let i = 2; i < objs.length; i++) {
    const a = objs[i - 2]!;
    const b = objs[i - 1]!;
    const c = objs[i]!;
    if (a.kind === 'spinner' || b.kind === 'spinner' || c.kind === 'spinner') continue;
    const ea = endAt(a);
    const eb = endAt(b);
    const d1 = Math.hypot(b.pos.x - ea.x, b.pos.y - ea.y);
    const d2 = Math.hypot(c.pos.x - eb.x, c.pos.y - eb.y);
    const g1 = b.time - endTime(a);
    const g2 = c.time - endTime(b);
    if (Math.abs(g1 - g2) > 1.5 || d1 < 2.2 * r || d2 < 2.2 * r || isDown(c.time)) continue;
    if (d2 > 1.6 * d1 + 0.5) out.push(`rule 10 at ${i}: ${d1.toFixed(0)} then ${d2.toFixed(0)}`);
  }

  // Rule 11: at most 3 consecutive 1/4-beat notes outside the stream motifs.
  let run = 1;
  for (let i = 1; i < objs.length; i++) {
    const a = objs[i - 1]!;
    const b = objs[i]!;
    const quarter = Math.abs(b.time - endTime(a) - beat / 4) < 0.35 && !QUARTER_OK.has(a.pattern) && !QUARTER_OK.has(b.pattern);
    run = quarter ? run + 1 : 1;
    if (run > 3) {
      out.push(`rule 11 at ${i}`);
      break;
    }
  }

  // Rule 12: motifs start on a beat. Spinners aside, the first note of every group sits on the grid.
  const seen = new Set<number>();
  objs.forEach((o, i) => {
    if (o.kind === 'spinner' || seen.has(o.group)) return;
    seen.add(o.group);
    const b = (o.time - t0) / beat;
    if (Math.abs(b - Math.round(b)) * beat > 0.25) out.push(`rule 12 motif ${i} starts off the beat`);
  });

  // Rule 13 (PLAN-2 6.4): neighbouring phrases differ in intensity by 0.2 or less, except into or out of a rest and
  // into the outro. The outro is a cool-down after the last peak, so its drop is intended.
  const phraseMs = 16 * beat;
  const roleAt = (t: number) => map.sections.find((s) => t >= s.start - 0.01 && t < s.end - 0.01)?.role;
  let prevI: number | null = null;
  let prevRole: string | undefined;
  let prevPhrase = -1;
  for (const o of objs) {
    if (o.kind === 'spinner') continue;
    const ph = Math.floor((o.time - t0 + 0.2) / phraseMs);
    if (ph === prevPhrase) continue;
    const role = roleAt(o.time);
    if (prevI !== null && ph === prevPhrase + 1 && role !== 'rest' && prevRole !== 'rest' && role !== 'outro' && Math.abs(o.intensity - prevI) > 0.2 + 0.002) {
      out.push(`rule 13 at phrase ${ph}: ${prevI} to ${o.intensity}`);
    }
    prevI = o.intensity;
    prevRole = role;
    prevPhrase = ph;
  }
  return out;
}
