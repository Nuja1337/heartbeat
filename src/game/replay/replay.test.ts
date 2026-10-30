// Determinism: a recorded play, run through a fresh session, gives the same records (PLAN-2 5.1, G1 test 1 and 2).

import { describe, expect, it } from 'vitest';
import { DEFAULT_DIFFICULTY, LEVEL_PRESETS, MODES, TRACE, TRACE_OP } from '../../shared/catalog';
import { decodeReplay, encodeReplay } from '../../shared/replay';
import type { InputInfo, LaunchRequest, ModId, ModeId, PlayResult, ReplayData } from '../../shared/types';
import type { GameSession } from '../engine/session';
import { computeFeatures, extendFeatures } from '../map/features';
import { NOISY_PLAYER } from '../sim/autoplay';
import { runHeadless } from '../sim/headless';
import { launchFor } from '../testing/fixtures';
import { applyTraceEvent, ReplayRunner, sessionForReplay } from './feed';

const dynamic = (level: number, seed: number, mods: ModId[] = []): LaunchRequest =>
  launchFor(LEVEL_PRESETS[level - 1]!.difficulty, seed, 40, mods);

const training = (modeId: ModeId, seed: number, mods: ModId[] = []): LaunchRequest => ({
  ...launchFor(DEFAULT_DIFFICULTY, seed, 40, mods, modeId),
  options: MODES[modeId].defaultOptions,
  levels: { jumps: 4, streams: 4, tracking: 3, spinning: 3 },
});

interface Case {
  label: string;
  launch: LaunchRequest;
}

// 20 plays: Dynamic L3 and L6, Jumps, Streams, Tracking, Spinning and Mix, with and without mods.
const CASES: Case[] = [
  { label: 'dynamic L3 a', launch: dynamic(3, 11) },
  { label: 'dynamic L3 b', launch: dynamic(3, 12, ['mirror']) },
  { label: 'dynamic L3 c', launch: dynamic(3, 13, ['fade']) },
  { label: 'dynamic L6 a', launch: dynamic(6, 21) },
  { label: 'dynamic L6 b', launch: dynamic(6, 22, ['fast']) },
  { label: 'dynamic L6 c', launch: dynamic(6, 23, ['slow', 'mirror']) },
  { label: 'dynamic L6 d', launch: dynamic(6, 24, ['spotlight']) },
  { label: 'jumps a', launch: training('jumps', 31) },
  { label: 'jumps b', launch: training('jumps', 32, ['mirror']) },
  { label: 'streams a', launch: training('streams', 41) },
  { label: 'streams b', launch: training('streams', 42, ['fade']) },
  { label: 'tracking a', launch: training('tracking', 51) },
  { label: 'tracking b', launch: training('tracking', 52, ['mirror']) },
  { label: 'spinning a', launch: training('spinning', 61) },
  { label: 'spinning b', launch: training('spinning', 62) },
  { label: 'mix a', launch: training('mix', 71) },
  { label: 'mix b', launch: training('mix', 72, ['mirror']) },
  { label: 'mix c', launch: training('mix', 73) },
  { label: 'dynamic L3 d', launch: dynamic(3, 14) },
  { label: 'dynamic L6 e', launch: dynamic(6, 25) },
];

const INFO: { startedAt: number; endedAt: number; input: InputInfo } = {
  startedAt: 0,
  endedAt: 0,
  input: { pointer: 'mouse', rawInput: false, unadjusted: false, sensitivity: 1, pointerHz: 1000, displayHz: 240 },
};

const roundTrip = (replay: ReplayData): ReplayData => decodeReplay(encodeReplay(replay));

/** Feed a trace exactly as it was logged. */
function runExact(replay: ReplayData): PlayResult {
  const runner = new ReplayRunner(replay);
  runner.feedAll();
  return runner.session.finish(replay.status, INFO);
}

/** Feed a trace, and also advance the session every `stepMs` ms between the logged calls. */
function runWithAdvances(replay: ReplayData, stepMs: number): PlayResult {
  const session = sessionForReplay(replay);
  const pos = { x: 0, y: 0 };
  const { trace } = replay;
  for (let i = 0; i < trace.count; i++) {
    const t = trace.t[i] as number;
    while (session.now < t) session.advance(Math.min(session.now + stepMs, t));
    applyTraceEvent(session, trace, i, pos);
  }
  return session.finish(replay.status, INFO);
}

/** `exact` is for a re-run of the logged calls as they were; the other kind adds advances, which can move drain. */
function expectSame(a: PlayResult, b: PlayResult, label: string, exact = true): void {
  expect(b.records, label).toEqual(a.records);
  expect(b.score, label).toBe(a.score);
  expect(b.counts, label).toEqual(a.counts);
  expect(b.maxCombo, label).toBe(a.maxCombo);
  expect(b.strayPresses, label).toBe(a.strayPresses);
  expect(b.sliderParts, label).toEqual(a.sliderParts);
  expect(b.playedMs, label).toBe(a.playedMs);
  // Health depends on how drain and gains interleave. The same trace gives the same health bit for bit. Extra
  // advances between the calls can put a 3 ms drain on the other side of a gain that is clamped at full health.
  if (a.healthAtEnd === null) expect(b.healthAtEnd, label).toBeNull();
  else if (exact) expect(b.healthAtEnd, label).toBe(a.healthAtEnd);
  else expect(b.healthAtEnd!, label).toBeCloseTo(a.healthAtEnd, 2);
}

describe('replay determinism', () => {
  it('reproduces 20 noisy plays from the encoded trace, whatever the advance step', () => {
    expect(CASES).toHaveLength(20);
    for (const c of CASES) {
      for (const stepMs of [1, 7]) {
        const label = `${c.label} (step ${stepMs} ms)`;
        const { result } = runHeadless({ launch: c.launch, model: NOISY_PLAYER, stepMs });
        const replay = result.replay;
        expect(replay, label).toBeDefined();
        const decoded = roundTrip(replay as ReplayData);
        expect(decoded.trace.count, label).toBe((replay as ReplayData).trace.count);
        expect(decoded.judgments, label).toBe((replay as ReplayData).judgments);
        expect(result.records.length, label).toBeGreaterThan(3);
        expectSame(result, runExact(decoded), `${label} exact`);
        // The original advanced every 7 ms and the re-run advances every 1 ms, or the other way round.
        expectSame(result, runWithAdvances(decoded, stepMs === 7 ? 1 : 7), `${label} other step`, false);
      }
    }
  });

  it('reproduces plays that pause and resume, so ops 14 and 15 are compared too', () => {
    let marked = 0;
    for (const c of CASES.filter((_, i) => i % 3 === 0)) {
      const label = `${c.label} with pauses`;
      const { result } = runHeadless({ launch: c.launch, model: NOISY_PLAYER, stepMs: 4, pauses: [2500, 6100, 11000, 17000, 24000] });
      const replay = decodeReplay(encodeReplay(result.replay as ReplayData));
      const ops = Array.from(replay.trace.ops);
      const pauseOps = ops.filter((o) => o === TRACE_OP.pause).length;
      expect(pauseOps, label).toBeGreaterThan(2);
      expect(ops.filter((o) => o === TRACE_OP.resume).length, label).toBe(pauseOps);
      expect(result.pauses, label).toBe(pauseOps);
      marked += result.records.filter((r) => r.afterPause).length;
      expectSame(result, runExact(replay), `${label} exact`);
      expectSame(result, runWithAdvances(replay, 1), `${label} other step`, false);
    }
    expect(marked).toBeGreaterThan(0);
  });

  it('puts every logged time on the 1/64 ms grid and every position on the 1/16 grid', () => {
    for (const c of CASES.slice(0, 8)) {
      const replay = runHeadless({ launch: c.launch, model: NOISY_PLAYER, stepMs: 3 }).result.replay as ReplayData;
      const { trace } = replay;
      let positioned = 0;
      for (let i = 0; i < trace.count; i++) {
        const t = trace.t[i] as number;
        expect(Number.isInteger(t * TRACE.timeSteps), `${c.label} t[${i}] = ${t}`).toBe(true);
        expect(Object.is(t, -0), `${c.label} t[${i}] is -0`).toBe(false);
        const op = trace.ops[i] as number;
        if (op <= 4) {
          positioned++;
          expect(Number.isInteger((trace.x[i] as number) * TRACE.posSteps), `${c.label} x[${i}]`).toBe(true);
          expect(Number.isInteger((trace.y[i] as number) * TRACE.posSteps), `${c.label} y[${i}]`).toBe(true);
        } else {
          expect(trace.x[i], `${c.label} x[${i}] of an unpositioned op`).toBe(0);
          expect(trace.y[i], `${c.label} y[${i}] of an unpositioned op`).toBe(0);
        }
      }
      expect(positioned).toBeGreaterThan(0);
    }
  });

  it('records the replay header the way PLAN-2 5.1 says', () => {
    const { result, session } = runHeadless({ launch: training('mix', 81), model: NOISY_PLAYER, stepMs: 2 });
    const r = result.replay as ReplayData;
    expect(r.format).toBe(1);
    expect(r.engineVersion).toBe(result.engineVersion);
    expect(r.endT).toBe(result.playedMs);
    expect(r.endT).toBe(session.now);
    expect(r.status).toBe(result.status);
    expect(r.progressMs).toBe(session.progressMs);
    expect(r.launch).toBe(result.launch);
    expect(r.levels).toEqual(result.levels);
    expect(r.levels.length).toBeGreaterThan(1);
    expect(r.judgments).toHaveLength(session.objs.length);
    expect(r.map.objects).toHaveLength(session.map.objects.length);
    expect(r.map.objects).not.toBe(session.map.objects);
    expect(r.map.sections).toHaveLength(session.map.sections.length);
    expect(r.map.sections).not.toBe(session.map.sections);
    const counts = { c: 0, s: 0, r: 0, m: 0 };
    for (const ch of r.judgments) if (ch !== '-') counts[ch as 'c']++;
    expect(counts).toEqual({ c: result.counts.crisp, s: result.counts.solid, r: result.counts.rough, m: result.counts.miss });
  });

  it('leaves the replay out when recording is off', () => {
    const { result } = runHeadless({ launch: dynamic(3, 5), model: NOISY_PLAYER, record: false });
    expect(result.replay).toBeUndefined();
  });
});

describe('features of adaptive sets', () => {
  const full = (s: GameSession): unknown => {
    const out: unknown[] = [];
    extendFeatures(s.map.objects, out as never, 0, s.progressMs);
    return out;
  };

  it('match a full computation over the finished map', () => {
    for (const c of CASES) {
      if (!MODES[c.launch.modeId].adaptive) continue;
      const { session } = runHeadless({ launch: c.launch, model: NOISY_PLAYER, stepMs: 4 });
      expect(session.features, c.label).toEqual(full(session));
    }
  });

  it('match computeFeatures when the map length is the progress length', () => {
    for (const c of CASES) {
      if (MODES[c.launch.modeId].adaptive) continue;
      const { session } = runHeadless({ launch: c.launch, model: NOISY_PLAYER, stepMs: 4 });
      expect(session.features, c.label).toEqual(computeFeatures(session.map));
    }
  });
});
