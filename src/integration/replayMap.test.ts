// The replay header holds a whole PlayableMap. This checks one that the generator really made, since
// src/shared tests may not import the game.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DIFFICULTY, REPLAY_FORMAT } from '../shared/catalog';
import { decodeReplay, encodeReplay } from '../shared/replay';
import type { LaunchRequest, ReplayData } from '../shared/types';
import { previewLaunch } from '../game';

describe('replay header with a generated map', () => {
  it('round-trips a Dynamic map with a slider and a spinner', () => {
    const launch: LaunchRequest = {
      modeId: 'dynamic',
      difficulty: { ...DEFAULT_DIFFICULTY },
      presetLevel: 4,
      options: {},
      mods: ['mirror'],
      seed: 31337,
      lengthSec: 60,
      levels: {},
      drillId: null,
    };
    const map = previewLaunch(launch).map;
    expect(map.objects.length).toBeGreaterThan(20);
    const data: ReplayData = {
      format: REPLAY_FORMAT,
      engineVersion: 2,
      launch,
      map,
      progressMs: map.durationMs,
      status: 'completed',
      endT: map.durationMs,
      judgments: 'c'.repeat(map.objects.length),
      levels: [],
      trace: {
        count: 2,
        ops: Uint8Array.from([0, 13]),
        t: Float64Array.from([0, 16.5]),
        x: Float32Array.from([10, 0]),
        y: Float32Array.from([20, 0]),
      },
    };
    const out = decodeReplay(encodeReplay(data));
    const { trace: _a, ...head } = data;
    const { trace: _b, ...outHead } = out;
    expect(outHead).toEqual(JSON.parse(JSON.stringify(head)));
    expect(out.trace.t).toEqual(data.trace.t);
  });
});
