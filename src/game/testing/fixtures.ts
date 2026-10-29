// Small builders for hand-made objects in tests.

import { PLAYFIELD_CENTER, windowsForTiming } from '../../shared/catalog';
import type { CircleObject, GeneratedMap, HitObject, PathSegment, SliderObject, SpinnerObject, Vec2 } from '../../shared/types';
import { GENERATOR_VERSION } from '../version';
import { flattenPath } from '../map/path';

const base = (index: number, time: number, pos: Vec2, radius: number) => ({
  index,
  time,
  pos: { x: pos.x, y: pos.y },
  radius,
  approachMs: 800,
  windows: windowsForTiming(5),
  group: 0,
  number: index + 1,
  pattern: 'single' as const,
  intensity: 0.5,
  set: -1,
});

export function makeCircle(index: number, time: number, x: number, y: number, radius = 50): CircleObject {
  return { ...base(index, time, { x, y }, radius), kind: 'circle' };
}

export function makeSlider(
  index: number,
  time: number,
  start: Vec2,
  path: PathSegment[],
  opts: { radius?: number; spanMs?: number; repeats?: number; tickDistance?: number } = {},
): SliderObject {
  const radius = opts.radius ?? 50;
  const flat = flattenPath(start, path);
  const spanMs = opts.spanMs ?? 500;
  const repeats = opts.repeats ?? 0;
  return {
    ...base(index, time, start, radius),
    kind: 'slider',
    pattern: 'slider',
    path,
    length: flat.length,
    velocity: flat.length / spanMs,
    repeats,
    spanMs,
    endTime: time + spanMs * (repeats + 1),
    tickDistance: opts.tickDistance ?? 75,
    followRadius: 2 * radius,
    shape: 'straight',
  };
}

export function makeSpinner(index: number, time: number, durationMs: number, rotationsRequired: number): SpinnerObject {
  return {
    ...base(index, time, PLAYFIELD_CENTER, 60),
    kind: 'spinner',
    pattern: 'spinner',
    endTime: time + durationMs,
    rotationsRequired,
  };
}

export function makeMap(objects: HitObject[], extra: Partial<GeneratedMap> = {}): GeneratedMap {
  const last = objects[objects.length - 1];
  const end = last ? (last.kind === 'circle' ? last.time : last.endTime) : 0;
  return {
    format: 1,
    generatorVersion: GENERATOR_VERSION,
    seed: 1,
    modeId: 'dynamic',
    beatMs: 500,
    durationMs: end + 1000,
    health: null,
    objects,
    sections: [],
    ...extra,
  };
}

import { DEFAULT_DIFFICULTY } from '../../shared/catalog';
import type { DifficultySettings, LaunchRequest, ModId, ModeId } from '../../shared/types';

export function launchFor(
  difficulty: DifficultySettings = DEFAULT_DIFFICULTY,
  seed = 1,
  lengthSec = 90,
  mods: ModId[] = [],
  modeId: ModeId = 'dynamic',
): LaunchRequest {
  return { modeId, difficulty, presetLevel: null, options: {}, mods, seed, lengthSec, levels: {}, drillId: null };
}
