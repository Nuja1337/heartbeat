// A small hand-made ReplayData for tests, so the data layer doesn't depend on the engine recording replays.

import { DEFAULT_DIFFICULTY, REPLAY_FORMAT, TRACE_OP } from '../../shared/catalog';
import type { CircleObject, InputTrace, LaunchRequest, PlayableMap, ReplayData } from '../../shared/types';

const windows = { crisp: 40, solid: 80, rough: 120, early: 180 };

function tinyMap(): PlayableMap {
  const base = { radius: 50, approachMs: 800, windows, group: 0, number: 1, intensity: 0.5, set: -1 };
  const circles: CircleObject[] = [0, 1, 2].map((i) => ({
    ...base, kind: 'circle', index: i, time: 1000 + i * 500, pos: { x: 200 + i * 120, y: 300 }, pattern: i === 0 ? 'single' : 'jump',
  }));
  return {
    format: 1, generatorVersion: 2, seed: 7, modeId: 'dynamic', beatMs: 500, durationMs: 4000, health: null,
    objects: circles, sections: [{ start: 0, end: 4000, intensity: 0.5, focus: 'mixed' }], mods: [], rate: 1,
  };
}

/** Every time is a multiple of 1/64 ms and every position a multiple of 1/16, as the engine records them. */
function tinyTrace(extraMoves: number): InputTrace {
  type Ev = [op: number, t: number, x: number, y: number];
  const events: Ev[] = [];
  for (let i = 0; i < 3; i++) {
    const t = 1000 + i * 500;
    events.push([TRACE_OP.move, t - 50, 200 + i * 120 - 30, 300]);
    events.push([TRACE_OP.pressAt, t, 200 + i * 120, 300.5]);
    events.push([TRACE_OP.release, t + 40, 0, 0]);
  }
  for (let i = 0; i < extraMoves; i++) events.push([TRACE_OP.move, 3000 + i, 100 + i * 0.5, 200 + (i % 7) * 0.25]);
  events.push([TRACE_OP.advance, 4000, 0, 0]);
  const n = events.length;
  const trace: InputTrace = { count: n, ops: new Uint8Array(n), t: new Float64Array(n), x: new Float32Array(n), y: new Float32Array(n) };
  events.forEach(([op, t, x, y], i) => {
    trace.ops[i] = op;
    trace.t[i] = t;
    trace.x[i] = x;
    trace.y[i] = y;
  });
  return trace;
}

export interface MakeReplayOptions {
  seed?: number;
  /** More move events, to make the replay larger. */
  extraMoves?: number;
  launch?: Partial<LaunchRequest>;
}

export function makeReplayData(o: MakeReplayOptions = {}): ReplayData {
  const launch: LaunchRequest = {
    modeId: 'dynamic', difficulty: { ...DEFAULT_DIFFICULTY }, presetLevel: 3, options: {}, mods: [], seed: o.seed ?? 7, lengthSec: 45,
    levels: {}, drillId: null, source: { kind: 'manual' }, ...o.launch,
  };
  return {
    format: REPLAY_FORMAT, engineVersion: 2, launch, map: tinyMap(), progressMs: 0, status: 'completed', endT: 4000,
    judgments: 'ccs', levels: [], trace: tinyTrace(o.extraMoves ?? 0),
  };
}
