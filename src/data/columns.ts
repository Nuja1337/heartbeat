// Packs HitRecords into typed-array columns for storage, and back. Enums are stored as indexes into
// the append-only arrays below. Null is NaN for floats and 255 for small ints.

import type { HitRecord, InputSlot, Judgment, MissReason, ObjectKind, PatternTag, SliderStats, SpinnerStats } from '../shared/types';
import type { ColumnArray, ColumnTable } from './schema';

/* Append-only. Never reorder or remove. */
export const KINDS: ObjectKind[] = ['circle', 'slider', 'spinner'];
export const PATTERNS: PatternTag[] = [
  'single',
  'jump',
  'backforth',
  'triangle',
  'square',
  'star',
  'flow',
  'stream',
  'burst',
  'doubles',
  'slider',
  'spinner',
  'stack',
  'cutstream',
  'spacedstream',
  'polygon',
];
export const JUDGMENT_ORDER: Judgment[] = ['crisp', 'solid', 'rough', 'miss'];
export const MISS_REASONS: MissReason[] = ['none', 'aim', 'early', 'skipped', 'tracking', 'spin'];
export const INPUT_SLOTS: InputSlot[] = ['key1', 'key2', 'mouse1', 'mouse2'];
export const SHAPES: SliderStats['shape'][] = ['straight', 'arc', 'curve'];

export type ColType = 'f32' | 'u8' | 'u16' | 'i16';
const NULL_U8 = 255;

export const OBJECT_COLUMNS = {
  index: 'u16',
  kind: 'u8',
  pattern: 'u8',
  set: 'i16',
  judgment: 'u8',
  headJudgment: 'u8',
  missReason: 'u8',
  input: 'u8',
  comboBefore: 'u16',
  afterPause: 'u8',
  time: 'f32',
  endTime: 'f32',
  x: 'f32',
  y: 'f32',
  radius: 'f32',
  approachMs: 'f32',
  crispMs: 'f32',
  timingError: 'f32',
  hitX: 'f32',
  hitY: 'f32',
  along: 'f32',
  lateral: 'f32',
  radial: 'f32',
  distance: 'f32',
  gapMs: 'f32',
  velocity: 'f32',
  spacing: 'f32',
  turnAngle: 'f32',
  direction: 'f32',
  progress: 'f32',
  runIndex: 'u16',
  runLength: 'u16',
  visibleCount: 'u8',
  arriveMs: 'f32',
  efficiency: 'f32',
  peakSpeed: 'f32',
  corrections: 'u8',
  leaveMs: 'f32',
  primaryAlong: 'f32',
  primaryLateral: 'f32',
  primaryEndMs: 'f32',
  correctionPath: 'f32',
} as const satisfies Record<string, ColType>;

export const SLIDER_COLUMNS = {
  row: 'u16',
  ticksHit: 'u16',
  ticksTotal: 'u16',
  endHit: 'u8',
  trackedFraction: 'f32',
  meanDistance: 'f32',
  meanLag: 'f32',
  lateralRms: 'f32',
  breaks: 'u16',
  firstLossAt: 'f32',
  shape: 'u8',
  length: 'f32',
  velocity: 'f32',
  repeats: 'u8',
  followRadius: 'f32',
} as const satisfies Record<string, ColType>;

export const SPINNER_COLUMNS = {
  row: 'u16',
  rotations: 'f32',
  rotationsRequired: 'f32',
  meanRpm: 'f32',
  peakRpm: 'f32',
  rpmSd: 'f32',
  heldMs: 'f32',
  durationMs: 'f32',
} as const satisfies Record<string, ColType>;

export type ColumnSpec = Record<string, ColType>;

/** Small-int columns whose field can be null. Their null is 255. Any other missing small int is 0. */
const NULLABLE_U8 = new Set(['headJudgment', 'missReason', 'input', 'corrections']);

/** What a column that is missing from a stored table reads as. */
export function missingValue(name: string, type: ColType): number {
  if (type === 'f32') return NaN;
  if (type === 'u8') return NULLABLE_U8.has(name) ? NULL_U8 : 0;
  return 0;
}

export function makeArray(type: ColType, count: number): ColumnArray {
  switch (type) {
    case 'f32':
      return new Float32Array(count);
    case 'u8':
      return new Uint8Array(count);
    case 'u16':
      return new Uint16Array(count);
    case 'i16':
      return new Int16Array(count);
  }
}

/** The value a missing column or null entry takes. */
export function nullFor(type: ColType): number {
  return type === 'f32' ? NaN : type === 'u8' ? NULL_U8 : 0;
}

function emptyTable(spec: ColumnSpec, count: number): ColumnTable {
  const columns: Record<string, ColumnArray> = {};
  for (const [name, type] of Object.entries(spec)) columns[name] = makeArray(type, count);
  return { count, columns };
}

const f = (v: number | null | undefined): number => (v === null || v === undefined ? NaN : v);
const u8 = (v: number | null | undefined): number => (v === null || v === undefined ? NULL_U8 : Math.min(254, Math.max(0, Math.round(v))));
const enumIndex = <T>(list: readonly T[], v: T | null): number => {
  if (v === null) return NULL_U8;
  const i = list.indexOf(v);
  return i < 0 ? NULL_U8 : i;
};
const fromEnum = <T>(list: readonly T[], i: number, fallback: T): T => list[i] ?? fallback;
const fromEnumOrNull = <T>(list: readonly T[], i: number): T | null => (i === NULL_U8 ? null : (list[i] ?? null));
const nn = (v: number): number | null => (Number.isNaN(v) ? null : v);

export function packRecords(records: readonly HitRecord[]): { objects: ColumnTable; sliders: ColumnTable; spinners: ColumnTable } {
  const nObj = records.length;
  const sliderRows: number[] = [];
  const spinnerRows: number[] = [];
  records.forEach((r, i) => {
    if (r.slider) sliderRows.push(i);
    if (r.spinner) spinnerRows.push(i);
  });
  const objects = emptyTable(OBJECT_COLUMNS, nObj);
  const sliders = emptyTable(SLIDER_COLUMNS, sliderRows.length);
  const spinners = emptyTable(SPINNER_COLUMNS, spinnerRows.length);
  const o = objects.columns;
  records.forEach((r, i) => {
    o.index![i] = r.index;
    o.kind![i] = enumIndex(KINDS, r.kind);
    o.pattern![i] = enumIndex(PATTERNS, r.pattern);
    o.set![i] = r.set;
    o.judgment![i] = enumIndex(JUDGMENT_ORDER, r.judgment);
    o.headJudgment![i] = enumIndex(JUDGMENT_ORDER, r.headJudgment);
    o.missReason![i] = enumIndex(MISS_REASONS, r.missReason);
    o.input![i] = enumIndex(INPUT_SLOTS, r.input);
    o.comboBefore![i] = Math.min(65535, r.comboBefore);
    o.afterPause![i] = r.afterPause ? 1 : 0;
    o.time![i] = r.time;
    o.endTime![i] = r.endTime;
    o.x![i] = r.pos.x;
    o.y![i] = r.pos.y;
    o.radius![i] = r.radius;
    o.approachMs![i] = r.approachMs;
    o.crispMs![i] = r.crispMs;
    o.timingError![i] = f(r.timingError);
    o.hitX![i] = f(r.hit?.x);
    o.hitY![i] = f(r.hit?.y);
    o.along![i] = f(r.aimAlong);
    o.lateral![i] = f(r.aimLateral);
    o.radial![i] = f(r.aimRadial);
    o.distance![i] = f(r.features.distance);
    o.gapMs![i] = f(r.features.gapMs);
    o.velocity![i] = f(r.features.velocity);
    o.spacing![i] = f(r.features.spacing);
    o.turnAngle![i] = f(r.features.turnAngle);
    o.direction![i] = f(r.features.direction);
    o.progress![i] = r.features.progress;
    o.runIndex![i] = Math.min(65535, r.features.runIndex);
    o.runLength![i] = Math.min(65535, r.features.runLength);
    o.visibleCount![i] = Math.min(254, r.features.visibleCount);
    o.arriveMs![i] = f(r.movement.arriveMs);
    o.efficiency![i] = f(r.movement.efficiency);
    o.peakSpeed![i] = f(r.movement.peakSpeed);
    o.corrections![i] = u8(r.movement.corrections);
    o.leaveMs![i] = f(r.movement.leaveMs);
    o.primaryAlong![i] = f(r.movement.primaryAlong);
    o.primaryLateral![i] = f(r.movement.primaryLateral);
    o.primaryEndMs![i] = f(r.movement.primaryEndMs);
    o.correctionPath![i] = f(r.movement.correctionPath);
  });
  const s = sliders.columns;
  sliderRows.forEach((row, k) => {
    const st = records[row]!.slider!;
    s.row![k] = row;
    s.ticksHit![k] = st.ticksHit;
    s.ticksTotal![k] = st.ticksTotal;
    s.endHit![k] = st.endHit ? 1 : 0;
    s.trackedFraction![k] = st.trackedFraction;
    s.meanDistance![k] = st.meanDistance;
    s.meanLag![k] = st.meanLag;
    s.lateralRms![k] = st.lateralRms;
    s.breaks![k] = st.breaks;
    s.firstLossAt![k] = f(st.firstLossAt);
    s.shape![k] = enumIndex(SHAPES, st.shape);
    s.length![k] = st.length;
    s.velocity![k] = st.velocity;
    s.repeats![k] = Math.min(254, st.repeats);
    s.followRadius![k] = st.followRadius;
  });
  const p = spinners.columns;
  spinnerRows.forEach((row, k) => {
    const st = records[row]!.spinner!;
    p.row![k] = row;
    p.rotations![k] = st.rotations;
    p.rotationsRequired![k] = st.rotationsRequired;
    p.meanRpm![k] = st.meanRpm;
    p.peakRpm![k] = st.peakRpm;
    p.rpmSd![k] = st.rpmSd;
    p.heldMs![k] = st.heldMs;
    p.durationMs![k] = st.durationMs;
  });
  return { objects, sliders, spinners };
}

/** Reads a column, or the null value when the stored table lacks it. */
function reader(table: ColumnTable, spec: ColumnSpec): (name: string, i: number) => number {
  return (name, i) => {
    const col = table.columns[name];
    if (col) return col[i] ?? NaN;
    return missingValue(name, spec[name] ?? 'f32');
  };
}

export function unpackRecords(detail: { objects: ColumnTable; sliders: ColumnTable; spinners: ColumnTable }): HitRecord[] {
  const o = reader(detail.objects, OBJECT_COLUMNS);
  const sl = reader(detail.sliders, SLIDER_COLUMNS);
  const sp = reader(detail.spinners, SPINNER_COLUMNS);
  const sliderAt = new Map<number, SliderStats>();
  for (let k = 0; k < detail.sliders.count; k++) {
    sliderAt.set(sl('row', k), {
      ticksHit: sl('ticksHit', k),
      ticksTotal: sl('ticksTotal', k),
      endHit: sl('endHit', k) === 1,
      trackedFraction: sl('trackedFraction', k),
      meanDistance: sl('meanDistance', k),
      meanLag: sl('meanLag', k),
      lateralRms: sl('lateralRms', k),
      breaks: sl('breaks', k),
      firstLossAt: nn(sl('firstLossAt', k)),
      shape: fromEnum(SHAPES, sl('shape', k), 'straight'),
      length: sl('length', k),
      velocity: sl('velocity', k),
      repeats: sl('repeats', k),
      followRadius: sl('followRadius', k),
    });
  }
  const spinnerAt = new Map<number, SpinnerStats>();
  for (let k = 0; k < detail.spinners.count; k++) {
    spinnerAt.set(sp('row', k), {
      rotations: sp('rotations', k),
      rotationsRequired: sp('rotationsRequired', k),
      meanRpm: sp('meanRpm', k),
      peakRpm: sp('peakRpm', k),
      rpmSd: sp('rpmSd', k),
      heldMs: sp('heldMs', k),
      durationMs: sp('durationMs', k),
    });
  }
  const out: HitRecord[] = [];
  for (let i = 0; i < detail.objects.count; i++) {
    const hitX = o('hitX', i);
    const hitY = o('hitY', i);
    const corr = o('corrections', i);
    out.push({
      index: o('index', i),
      kind: fromEnum(KINDS, o('kind', i), 'circle'),
      pattern: fromEnum(PATTERNS, o('pattern', i), 'single'),
      set: o('set', i),
      time: o('time', i),
      endTime: o('endTime', i),
      pos: { x: o('x', i), y: o('y', i) },
      radius: o('radius', i),
      approachMs: o('approachMs', i),
      crispMs: o('crispMs', i),
      judgment: fromEnum(JUDGMENT_ORDER, o('judgment', i), 'miss'),
      headJudgment: fromEnumOrNull(JUDGMENT_ORDER, o('headJudgment', i)),
      missReason: fromEnumOrNull(MISS_REASONS, o('missReason', i)),
      timingError: nn(o('timingError', i)),
      hit: Number.isNaN(hitX) || Number.isNaN(hitY) ? null : { x: hitX, y: hitY },
      aimAlong: nn(o('along', i)),
      aimLateral: nn(o('lateral', i)),
      aimRadial: nn(o('radial', i)),
      input: fromEnumOrNull(INPUT_SLOTS, o('input', i)),
      comboBefore: o('comboBefore', i),
      afterPause: o('afterPause', i) === 1,
      features: {
        distance: nn(o('distance', i)),
        gapMs: nn(o('gapMs', i)),
        velocity: nn(o('velocity', i)),
        spacing: nn(o('spacing', i)),
        turnAngle: nn(o('turnAngle', i)),
        direction: nn(o('direction', i)),
        runIndex: o('runIndex', i),
        runLength: o('runLength', i),
        visibleCount: o('visibleCount', i),
        progress: nn(o('progress', i)) ?? 0,
      },
      movement: {
        arriveMs: nn(o('arriveMs', i)),
        efficiency: nn(o('efficiency', i)),
        corrections: corr === NULL_U8 ? null : corr,
        peakSpeed: nn(o('peakSpeed', i)),
        leaveMs: nn(o('leaveMs', i)),
        primaryAlong: nn(o('primaryAlong', i)),
        primaryLateral: nn(o('primaryLateral', i)),
        primaryEndMs: nn(o('primaryEndMs', i)),
        correctionPath: nn(o('correctionPath', i)),
      },
      slider: sliderAt.get(i) ?? null,
      spinner: spinnerAt.get(i) ?? null,
    });
  }
  return out;
}

/** Tables as plain arrays rounded to 2 decimals, for export files. NaN becomes null. */
export function tableToJson(table: ColumnTable): { count: number; columns: Record<string, (number | null)[]> } {
  const columns: Record<string, (number | null)[]> = {};
  for (const [name, col] of Object.entries(table.columns)) {
    const isFloat = col instanceof Float32Array;
    const arr: (number | null)[] = new Array(col.length);
    for (let i = 0; i < col.length; i++) {
      const v = col[i]!;
      arr[i] = Number.isNaN(v) ? null : isFloat ? Math.round(v * 100) / 100 : v;
    }
    columns[name] = arr;
  }
  return { count: table.count, columns };
}

/** Reverse of tableToJson. Unknown columns are dropped and missing ones filled with nulls. */
export function tableFromJson(raw: unknown, spec: ColumnSpec): ColumnTable {
  const src = raw as { count?: unknown; columns?: Record<string, unknown> } | null | undefined;
  const count = typeof src?.count === 'number' && src.count >= 0 ? Math.floor(src.count) : 0;
  const table = emptyTable(spec, count);
  for (const [name, type] of Object.entries(spec)) {
    const input = src?.columns?.[name];
    const out = table.columns[name]!;
    if (!Array.isArray(input)) {
      out.fill(missingValue(name, type));
      continue;
    }
    for (let i = 0; i < count; i++) {
      const v = input[i];
      out[i] = typeof v === 'number' ? v : missingValue(name, type);
    }
  }
  return table;
}
