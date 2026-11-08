// Synthetic plays with chosen biases. Tests plant a weakness here and check that analytics finds it.
// The fake game in dev builds also uses this to hand back a PlayResult.

import { DEFAULT_DIFFICULTY, JUDGMENTS, LEVEL_PRESETS, RECORD_VERSION, windowsForTiming } from '../shared/catalog';
import type {
  HitRecord,
  Judgment,
  LaunchRequest,
  LevelStep,
  MissReason,
  ModId,
  ModeId,
  ModuleId,
  ObjectKind,
  PatternTag,
  PlayResult,
  PlayStatus,
  SliderStats,
  Vec2,
} from '../shared/types';

export interface FixtureOptions {
  seed?: number;
  modeId?: ModeId;
  mods?: ModId[];
  presetLevel?: number | null;
  lengthSec?: number;
  drillId?: string | null;
  startedAt?: number;
  status?: PlayStatus;
  /** Number of objects. */
  objects?: number;
  radius?: number;
  /** Shares of the layout. The rest is single jumps. */
  streamShare?: number;
  sliderShare?: number;
  spinnerShare?: number;
  /** Only jumps, no streams, sliders or spinners. */
  jumpsOnly?: boolean;

  /* player model */
  timingSd?: number;
  timingMean?: number;
  /** Aim noise in radii. */
  aimSd?: number;
  baseMiss?: number;

  /* planted weaknesses */
  /** Mean overshoot (positive) or undershoot (negative), in radii, on spacing >= 4.5 and velocity >= 0.9. */
  longAlong?: number;
  /** Jump spacings in target widths to pick from. Default reaches 7.5, which real maps below Level 7 do not. */
  jumpSpacings?: number[];
  /** Where "long" and "fast" start for longAlong, in widths and units per ms. */
  longFrom?: number;
  fastFrom?: number;
  /** Same for spacing 1 to 2.5. */
  shortAlong?: number;
  /** Mean lateral error in radii when moving in one octant. */
  octantLateral?: { octant: number; mean: number };
  /** Added to timing error of stream notes with a gap under 140 ms. */
  streamOffsetMs?: number;
  /** Multiplier on the timing spread from the ninth tap of a stream. */
  streamFade?: number;
  /** Extra miss chance in the second half of the play. */
  secondHalfDrop?: number;
  /** Extra miss chance on turns of 100 degrees or more (spacing 2.5+), and on turns under 100. */
  sharpExtraMiss?: number;
  wideExtraMiss?: number;
  /** Mean slider lag in radii (negative is behind). */
  sliderLag?: number;
  /** Tracked fraction lost on curved sliders. */
  curvePenalty?: number;
  /** Chance a slider's end is missed although its ticks were kept. */
  endDrop?: number;
  /** Extra miss chance when four or more targets are visible. */
  busyExtraMiss?: number;
  /** The number of visible targets where busyExtraMiss starts. */
  busyFrom?: number;
  /** Aim noise in radii that keeps clicks off center without causing misses. */
  offCenter?: boolean;
  /** Share of spinners that fall short. */
  spinnerFail?: number;
  /**
   * Plants 2.0 movement data (leave time, first motion, correction path). Without this option records carry
   * only the 1.0 movement fields. It uses its own random stream, so the other fields don't change.
   */
  movement?: {
    /** Mean leaveMs / gapMs. Default 0.15. */
    leaveFrac?: number;
    /** Mean primaryAlong in radii on the long, fast jumps (see longFrom and fastFrom). Default 0. */
    firstMotion?: number;
    /** Share of jumps of 2.5 widths or more that get a second motion. Default 0.15. */
    correctionShare?: number;
    /** Mean correction path in radii for those jumps. Default 0.15. */
    correctionPath?: number;
  };
}

/* ---------------------------------------------------------------- rng */

function rng(seed: number) {
  let a = seed >>> 0 || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = (mean = 0, sd = 1) => {
    const u = Math.max(next(), 1e-9);
    const v = next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
  const range = (lo: number, hi: number) => lo + (hi - lo) * next();
  return { next, normal, pick, range };
}

/* ------------------------------------------------------------- layout */

interface Slot {
  kind: ObjectKind;
  pattern: PatternTag;
  time: number;
  endTime: number;
  pos: Vec2;
  /** Position the cursor leaves from for the next object. */
  endPos: Vec2;
  shape: SliderStats['shape'];
  repeats: number;
  length: number;
  velocity: number;
}

const FIELD = { w: 1000, h: 625 };
const deg = (rad: number) => ((rad * 180) / Math.PI + 360) % 360;
const fold = (d: number) => {
  const x = Math.abs(((d % 360) + 360) % 360);
  return x > 180 ? 360 - x : x;
};

function layout(o: Required<Pick<FixtureOptions, 'objects' | 'radius'>> & FixtureOptions, r: ReturnType<typeof rng>): Slot[] {
  const radius = o.radius;
  const slots: Slot[] = [];
  let t = 2000;
  let pos: Vec2 = { x: 500, y: 312.5 };
  const place = (from: Vec2, dist: number, angle: number): Vec2 => {
    const x = from.x + Math.cos(angle) * dist;
    const y = from.y + Math.sin(angle) * dist;
    return { x: Math.min(FIELD.w - radius, Math.max(radius, x)), y: Math.min(FIELD.h - radius, Math.max(radius, y)) };
  };
  while (slots.length < o.objects) {
    const roll = r.next();
    const streamShare = o.jumpsOnly ? 0 : (o.streamShare ?? 0.25);
    const sliderShare = o.jumpsOnly ? 0 : (o.sliderShare ?? 0.08);
    const spinnerShare = o.jumpsOnly ? 0 : (o.spinnerShare ?? 0.015);
    if (roll < spinnerShare) {
      t += 600;
      slots.push({
        kind: 'spinner',
        pattern: 'spinner',
        time: t,
        endTime: t + 3000,
        pos: { x: 500, y: 312.5 },
        endPos: { x: 500, y: 312.5 },
        shape: 'straight',
        repeats: 0,
        length: 0,
        velocity: 0,
      });
      pos = { x: 500, y: 312.5 };
      t += 3000 + 500;
    } else if (roll < spinnerShare + sliderShare) {
      const span = r.pick([600, 800, 1000]);
      const repeats = r.pick([0, 0, 1]);
      const velocity = 0.42;
      const length = velocity * span;
      const head = place(pos, r.range(2, 5) * 2 * radius, r.range(0, Math.PI * 2));
      const tail = place(head, length, r.range(0, Math.PI * 2));
      const shape = r.pick<SliderStats['shape']>(['straight', 'arc', 'curve']);
      t += 500;
      const total = span * (repeats + 1);
      slots.push({
        kind: 'slider',
        pattern: 'slider',
        time: t,
        endTime: t + total,
        pos: head,
        endPos: repeats % 2 === 1 ? head : tail,
        shape,
        repeats,
        length,
        velocity,
      });
      pos = repeats % 2 === 1 ? head : tail;
      t += total + 250;
    } else if (roll < spinnerShare + sliderShare + streamShare / 6) {
      const len = r.pick([5, 6, 8, 10, 12, 14]);
      const gap = r.pick([90, 100, 115, 130]);
      const base = r.range(0, Math.PI * 2);
      const turn = r.range(-0.15, 0.15);
      t += 400;
      for (let i = 0; i < len && slots.length < o.objects; i++) {
        const next = place(pos, radius * 0.9, base + turn * i);
        slots.push({
          kind: 'circle',
          pattern: 'stream',
          time: t,
          endTime: t,
          pos: next,
          endPos: next,
          shape: 'straight',
          repeats: 0,
          length: 0,
          velocity: 0,
        });
        pos = next;
        t += gap;
      }
    } else {
      const gap = r.pick([250, 300, 375, 450, 500]);
      const spacing = r.pick(o.jumpSpacings ?? [1.5, 2, 3, 4, 5, 5.5, 6, 7.5]);
      const next = place(pos, spacing * 2 * radius, r.range(0, Math.PI * 2));
      t += gap;
      slots.push({
        kind: 'circle',
        pattern: 'jump',
        time: t,
        endTime: t,
        pos: next,
        endPos: next,
        shape: 'straight',
        repeats: 0,
        length: 0,
        velocity: 0,
      });
      pos = next;
    }
  }
  return slots;
}

/* ------------------------------------------------------------ records */

const worse = (a: Judgment, b: Judgment): Judgment => {
  const order: Judgment[] = ['crisp', 'solid', 'rough', 'miss'];
  return order[Math.max(order.indexOf(a), order.indexOf(b))]!;
};

export interface Fixture {
  result: PlayResult;
  records: HitRecord[];
}

export function makeFixture(options: FixtureOptions = {}): Fixture {
  const o = options;
  const r = rng(o.seed ?? 1);
  const radius = o.radius ?? 50;
  const objects = o.objects ?? 200;
  const slots = layout({ ...o, objects, radius }, r);
  const mv = rng((o.seed ?? 1) + 7919);
  const windows = windowsForTiming(5);
  const duration = slots[slots.length - 1]!.endTime + 1000;
  const modeId = o.modeId ?? 'dynamic';
  const mods = o.mods ?? [];
  const startedAt = o.startedAt ?? 1_700_000_000_000;

  /* features */
  let prevEnd: Vec2 | null = null;
  let prevEndTime = 0;
  let prevDir: number | null = null;
  const feats = slots.map((s, i) => {
    const gapMs = i === 0 ? null : s.time - prevEndTime;
    const afterSpinner = i > 0 && slots[i - 1]!.kind === 'spinner';
    const distance = prevEnd && !afterSpinner ? Math.hypot(s.pos.x - prevEnd.x, s.pos.y - prevEnd.y) : null;
    const direction = distance !== null && distance >= 0.5 * radius ? deg(Math.atan2(s.pos.y - prevEnd!.y, s.pos.x - prevEnd!.x)) : null;
    const turnAngle = direction !== null && prevDir !== null ? fold(direction - prevDir) : null;
    prevDir = direction;
    prevEnd = s.endPos;
    prevEndTime = s.endTime;
    return {
      distance,
      gapMs,
      velocity: distance !== null && gapMs ? distance / gapMs : null,
      spacing: distance !== null ? distance / (2 * radius) : null,
      turnAngle,
      direction,
      runIndex: 0,
      runLength: 0,
      visibleCount: 0,
      progress: s.time / duration,
    };
  });
  // Runs of 3+ objects with equal gaps under 160 ms.
  let i = 0;
  while (i < slots.length) {
    const g = feats[i + 1]?.gapMs ?? null;
    let j = i;
    if (g !== null && g < 160) {
      j = i + 1;
      while (j + 1 < slots.length && feats[j + 1]!.gapMs === g) j++;
    }
    const len = j - i + 1;
    if (len >= 3) {
      for (let k = i; k <= j; k++) {
        feats[k]!.runIndex = k - i + 1;
        feats[k]!.runLength = len;
      }
    }
    i = j + 1;
  }
  slots.forEach((s, idx) => {
    feats[idx]!.visibleCount = slots.filter((o2) => o2.time - 800 <= s.time && o2.endTime >= s.time).length;
  });

  /* judging */
  const records: HitRecord[] = [];
  let combo = 0;
  let maxCombo = 0;
  let score = 0;
  let strayPresses = 0;
  slots.forEach((s, idx) => {
    const f = feats[idx]!;
    const progress = f.progress;
    let judgment: Judgment;
    let headJudgment: Judgment | null = null;
    let missReason: MissReason | null = null;
    let timingError: number | null = null;
    let hit: Vec2 | null = null;
    let along: number | null = null;
    let lateral: number | null = null;
    let radial: number | null = null;
    let slider: SliderStats | null = null;
    let spinner: HitRecord['spinner'] = null;
    const isStream = f.runLength >= 3 && f.spacing !== null && f.spacing < 1.6;

    if (s.kind === 'spinner') {
      const required = 8;
      const failed = r.next() < (o.spinnerFail ?? 0.02);
      const rotations = failed ? required * r.range(0.2, 0.6) : required * r.range(1, 1.3);
      const q = rotations / required;
      judgment = q >= 1 ? 'crisp' : q >= 0.75 ? 'solid' : q >= 0.5 ? 'rough' : 'miss';
      missReason = judgment === 'miss' ? 'spin' : null;
      spinner = {
        rotations,
        rotationsRequired: required,
        meanRpm: (rotations / 3) * 60,
        peakRpm: (rotations / 3) * 60 * 1.2,
        rpmSd: 15,
        heldMs: 2900,
        durationMs: 3000,
      };
    } else {
      // Miss chance without a press.
      let pMiss = o.baseMiss ?? 0.04;
      if (progress > 0.5) pMiss += o.secondHalfDrop ?? 0;
      if (f.turnAngle !== null && f.spacing !== null && f.spacing >= 1.5)
        pMiss += f.turnAngle >= 100 ? (o.sharpExtraMiss ?? 0) : (o.wideExtraMiss ?? 0);
      if (f.visibleCount >= (o.busyFrom ?? 4)) pMiss += o.busyExtraMiss ?? 0;
      const noPress = r.next() < pMiss;

      let sd = o.timingSd ?? 25;
      let bias = o.timingMean ?? 0;
      if (isStream && f.gapMs !== null && f.gapMs < 140) bias += o.streamOffsetMs ?? 0;
      if (isStream && f.runIndex >= 9) sd *= o.streamFade ?? 1;
      const err = r.normal(bias, sd);

      const aimSd = o.aimSd ?? 0.28;
      let alongMean = 0;
      if (f.spacing !== null && f.velocity !== null) {
        if (f.spacing >= (o.longFrom ?? 4.5) && f.velocity >= (o.fastFrom ?? 0.9)) alongMean = o.longAlong ?? 0;
        else if (f.spacing >= 1 && f.spacing < 2.5) alongMean = o.shortAlong ?? 0;
      }
      let latMean = 0;
      if (o.octantLateral && f.direction !== null && Math.floor(((f.direction + 22.5) % 360) / 45) % 8 === o.octantLateral.octant) {
        latMean = o.octantLateral.mean;
      }
      let a: number;
      let l: number;
      if (o.offCenter) {
        // Uniform over most of the target: nearly every click hits, few land near the center.
        const spread = 0.97 * Math.sqrt(r.next());
        const angle = r.range(0, Math.PI * 2);
        a = spread * Math.cos(angle);
        l = spread * Math.sin(angle);
      } else {
        a = r.normal(alongMean, aimSd);
        l = r.normal(latMean, aimSd);
      }
      const rad = Math.hypot(a, l);
      const onTarget = rad <= 1;

      if (noPress) {
        judgment = 'miss';
        missReason = 'none';
      } else {
        timingError = err;
        const phi = f.direction !== null ? (f.direction * Math.PI) / 180 : 0;
        const dx = a * Math.cos(phi) - l * Math.sin(phi);
        const dy = a * Math.sin(phi) + l * Math.cos(phi);
        hit = { x: s.pos.x + dx * radius, y: s.pos.y + dy * radius };
        radial = rad * radius;
        if (f.direction !== null) {
          along = a * radius;
          lateral = l * radius;
        }
        const abs = Math.abs(err);
        if (!onTarget) {
          judgment = 'miss';
          missReason = 'aim';
        } else if (abs <= windows.crisp) judgment = 'crisp';
        else if (abs <= windows.solid) judgment = 'solid';
        else if (abs <= windows.rough) judgment = 'rough';
        else {
          judgment = 'miss';
          missReason = err < 0 && err >= -windows.early ? 'early' : 'none';
        }
      }
      if (s.kind === 'slider') {
        headJudgment = judgment;
        const tracked = Math.min(1, Math.max(0, r.normal(0.94 - (s.shape === 'curve' ? (o.curvePenalty ?? 0) : 0), 0.05)));
        const endHit = r.next() >= (o.endDrop ?? 0.03);
        const ticksTotal = 3 * (s.repeats + 1);
        const ticksHit = Math.round(ticksTotal * Math.min(1, tracked + (o.endDrop ? 0.05 : 0)));
        const f2 = tracked;
        const trackJudgment: Judgment = f2 >= 0.98 ? 'crisp' : f2 >= 0.75 ? 'solid' : f2 >= 0.4 ? 'rough' : 'miss';
        judgment = worse(judgment, trackJudgment);
        if (judgment === 'miss' && missReason === null) missReason = 'tracking';
        slider = {
          ticksHit,
          ticksTotal,
          endHit,
          trackedFraction: tracked,
          meanDistance: 14,
          meanLag: (o.sliderLag ?? 0.05) * radius + r.normal(0, 0.05 * radius),
          lateralRms: 10,
          breaks: tracked < 0.9 ? 1 : 0,
          firstLossAt: tracked < 0.9 ? 0.6 : null,
          shape: s.shape,
          length: s.length,
          velocity: s.velocity,
          repeats: s.repeats,
          followRadius: 2 * radius,
        };
      }
    }

    const w = JUDGMENTS[judgment].weight;
    const comboBefore = combo;
    if (judgment === 'miss') {
      combo = 0;
    } else {
      combo++;
      maxCombo = Math.max(maxCombo, combo);
    }
    score += Math.round(
      100 * w * (0.8 + 0.2 * (radial === null ? 0 : Math.max(0, 1 - (radial / radius) ** 2))) * (1 + Math.min(comboBefore, 50) / 100),
    );
    if (s.kind !== 'spinner' && judgment === 'miss' && missReason === 'aim') strayPresses++;

    function movementFor(): HitRecord['movement'] {
      const base: HitRecord['movement'] = {
        arriveMs: timingError === null ? null : -r.range(20, 120),
        efficiency: timingError === null ? null : r.range(0.7, 0.95),
        corrections: timingError === null ? null : r.pick([0, 0, 1, 2]),
        peakSpeed: f.velocity === null ? null : f.velocity * 1.8,
      };
      const m = o.movement;
      if (!m || timingError === null || s.kind === 'spinner' || f.gapMs === null) return base;
      const longFast = f.spacing !== null && f.velocity !== null && f.spacing >= (o.longFrom ?? 4.5) && f.velocity >= (o.fastFrom ?? 0.9);
      const leaveFrac = Math.min(0.95, Math.max(0.02, mv.normal(m.leaveFrac ?? 0.15, 0.08)));
      const primary = f.direction === null ? null : ((longFast ? (m.firstMotion ?? 0) : 0) + mv.normal(0, 0.25)) * radius;
      const longer = f.spacing !== null && f.spacing >= 2.5;
      const corrected = longer && mv.next() < (m.correctionShare ?? 0.15);
      const path = corrected ? Math.max(0.05, mv.normal(m.correctionPath ?? 0.15, 0.1)) : mv.range(0, 0.1);
      return {
        ...base,
        corrections: corrected ? 1 : 0,
        leaveMs: f.gapMs * leaveFrac,
        primaryAlong: primary,
        primaryLateral: primary === null ? null : mv.normal(0, 0.25) * radius,
        primaryEndMs: -mv.range(30, 100),
        correctionPath: path * radius,
      };
    }

    records.push({
      index: idx,
      kind: s.kind,
      pattern: s.pattern,
      set: -1,
      time: s.time,
      endTime: s.endTime,
      pos: s.pos,
      radius,
      approachMs: 800,
      crispMs: windows.crisp,
      judgment,
      headJudgment,
      missReason,
      timingError,
      hit,
      aimAlong: along,
      aimLateral: lateral,
      aimRadial: radial,
      input: timingError === null ? null : idx % 2 === 0 ? 'key1' : 'key2',
      comboBefore,
      afterPause: false,
      features: f,
      movement: movementFor(),
      slider,
      spinner,
    });
  });

  const counts = { crisp: 0, solid: 0, rough: 0, miss: 0 };
  for (const rec of records) counts[rec.judgment]++;
  const accuracy = records.reduce((m, rec) => m + JUDGMENTS[rec.judgment].weight, 0) / records.length;
  const kindCounts: Record<ObjectKind, number> = { circle: 0, slider: 0, spinner: 0 };
  for (const rec of records) kindCounts[rec.kind]++;

  const preset = o.presetLevel === undefined ? 4 : o.presetLevel;
  const difficulty = preset ? { ...LEVEL_PRESETS[preset - 1]!.difficulty } : { ...DEFAULT_DIFFICULTY };
  const lengthSec = o.lengthSec ?? Math.round(duration / 1000);
  const launch: LaunchRequest = {
    modeId,
    difficulty,
    presetLevel: modeId === 'dynamic' ? preset : null,
    options: {},
    mods,
    seed: (o.seed ?? 1) >>> 0,
    lengthSec,
    levels: {},
    drillId: o.drillId ?? null,
  };

  const levels: LevelStep[] = [];
  const finalLevels: Partial<Record<ModuleId, number>> = {};
  const moduleIds: ModuleId[] = ['jumps', 'angles', 'streams', 'tracking', 'spinning', 'precision', 'reading', 'timing'];
  if ((moduleIds as string[]).includes(modeId)) {
    const m = modeId as ModuleId;
    const start = 3 + r.range(-0.5, 0.5);
    for (let k = 0; k < 4; k++)
      levels.push({
        set: k,
        module: m,
        level: start + k * 0.25,
        success: 0.75 + r.range(-0.05, 0.1),
        objects: Math.floor(records.length / 4),
      });
    finalLevels[m] = Math.round((start + 0.5) * 20) / 20;
  }

  const playedMs = Math.round(duration);
  const result: PlayResult = {
    recordVersion: RECORD_VERSION,
    engineVersion: 1,
    launch,
    map: {
      format: 1,
      generatorVersion: 1,
      seed: launch.seed,
      beatMs: 60000 / difficulty.bpm,
      durationMs: duration,
      rate: mods.includes('fast') ? 1.25 : mods.includes('slow') ? 0.8 : 1,
      mods,
      health:
        modeId === 'dynamic' ? { drainPerSec: 0.02, missPenalty: 0.08, partPenalty: 0.03, canFail: true, failOnFirstMiss: false } : null,
      counts: kindCounts,
    },
    startedAt,
    endedAt: startedAt + playedMs,
    playedMs,
    status: o.status ?? 'completed',
    score,
    accuracy,
    maxCombo,
    counts,
    sliderParts: {
      hit: records.reduce((m, rec) => m + (rec.slider?.ticksHit ?? 0), 0),
      total: records.reduce((m, rec) => m + (rec.slider?.ticksTotal ?? 0), 0),
    },
    strayPresses,
    pauses: 0,
    levels,
    finalLevels,
    healthAtEnd: modeId === 'dynamic' ? 0.7 : null,
    input: { pointer: 'mouse', rawInput: false, unadjusted: false, sensitivity: 1, pointerHz: 1000, displayHz: 144 },
    records,
  };
  return { result, records };
}

/** Plays spread over several days, newest last. Each call adds `seedStep` to the seed. */
export function makeHistory(
  count: number,
  base: FixtureOptions,
  opts: { endAt: number; spacingMs?: number; seedStart?: number; vary?: (i: number) => FixtureOptions } = { endAt: Date.now() },
): Fixture[] {
  const spacing = opts.spacingMs ?? 3_600_000 * 6;
  const out: Fixture[] = [];
  for (let i = 0; i < count; i++) {
    const startedAt = opts.endAt - (count - 1 - i) * spacing - 120_000;
    out.push(makeFixture({ ...base, ...(opts.vary?.(i) ?? {}), seed: (opts.seedStart ?? 100) + i, startedAt }));
  }
  return out;
}
