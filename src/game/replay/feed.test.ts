import { describe, expect, it } from 'vitest';
import { DEFAULT_DIFFICULTY, LEVEL_PRESETS, MODES, TRACE_OP } from '../../shared/catalog';
import type { LaunchRequest, ReplayData } from '../../shared/types';
import { NOISY_PLAYER } from '../sim/autoplay';
import { runHeadless } from '../sim/headless';
import { launchFor } from '../testing/fixtures';
import { countMismatches, ReplayRunner, replayDuration, sessionForReplay } from './feed';

const dyn = launchFor(LEVEL_PRESETS[2]!.difficulty, 91, 30);
const mix: LaunchRequest = { ...launchFor(DEFAULT_DIFFICULTY, 92, 40, [], 'mix'), options: MODES.mix.defaultOptions, levels: { jumps: 4, streams: 4, tracking: 3 } };

function record(launch: LaunchRequest): { replay: ReplayData; live: ReturnType<typeof runHeadless> } {
  const live = runHeadless({ launch, model: NOISY_PLAYER, stepMs: 5 });
  return { replay: live.result.replay as ReplayData, live };
}

function snapshot(r: ReplayRunner) {
  const s = r.session;
  return {
    score: s.scoring.total(s.map.mods),
    combo: s.scoring.combo,
    maxCombo: s.scoring.maxCombo,
    counts: { ...s.scoring.counts },
    judged: s.records.length,
    judgments: s.judgmentString(),
    stray: s.strayPresses,
    now: s.now,
    records: s.records.slice().sort((a, b) => a.index - b.index),
  };
}

describe('seeking', () => {
  for (const [name, launch] of [['Dynamic', dyn], ['Mix', mix]] as const) {
    it(`${name}: seeking to T and then playing on equals a straight run`, () => {
      const { replay } = record(launch);
      const end = replayDuration(replay);
      for (const frac of [0.1, 0.33, 0.5, 0.8, 0.97]) {
        const T = end * frac;
        const straight = new ReplayRunner(replay);
        straight.feedTo(T);
        const seeked = new ReplayRunner(replay);
        seeked.seekTo(end * 0.9);
        const rebuilt = seeked.seekTo(T);
        expect(rebuilt).toBe(T < end * 0.9);
        expect(snapshot(seeked), `${name} at ${frac}`).toEqual(snapshot(straight));
        // Forward from there.
        straight.feedTo(T + 700);
        seeked.seekTo(T + 700);
        expect(snapshot(seeked), `${name} at ${frac} plus 700`).toEqual(snapshot(straight));
      }
    });

    it(`${name}: a forward seek in one jump equals many small steps`, () => {
      const { replay } = record(launch);
      const end = replayDuration(replay);
      const steps = new ReplayRunner(replay);
      for (let t = 0; t <= end * 0.6; t += 8.3) steps.feedTo(t);
      steps.feedTo(end * 0.6);
      const jump = new ReplayRunner(replay);
      jump.seekTo(end * 0.6);
      expect(snapshot(jump)).toEqual(snapshot(steps));
    });
  }

  it('makes the same calls whatever the route, even when t goes down between two ops', () => {
    const { replay } = record(dyn);
    const { trace } = replay;
    // Count the places where time goes down, to be sure the trace has some.
    let down = 0;
    for (let i = 1; i < trace.count; i++) if ((trace.t[i] as number) < (trace.t[i - 1] as number)) down++;
    expect(down).toBeGreaterThan(0);
    const a = new ReplayRunner(replay);
    const b = new ReplayRunner(replay);
    for (const t of [1000, 5000, 12345.5, 20000]) {
      a.feedTo(t);
      b.seekTo(t);
      expect(b.eventsFed).toBe(a.eventsFed);
    }
  });

  it('runs to the end in one pass with feedAll', () => {
    const { replay, live } = record(dyn);
    const r = new ReplayRunner(replay);
    r.feedAll();
    expect(r.eventsFed).toBe(replay.trace.count);
    expect(snapshot(r).records).toEqual(live.result.records);
    expect(r.judgments()).toBe(replay.judgments);
  });
});

describe('replay duration', () => {
  it('is the end time, or the last logged time when that is later', () => {
    const { replay } = record(dyn);
    expect(replayDuration(replay)).toBeGreaterThanOrEqual(replay.endT);
    const late: ReplayData = {
      ...replay,
      trace: { count: 2, ops: Uint8Array.from([TRACE_OP.move, TRACE_OP.move]), t: Float64Array.from([5, 900]), x: new Float32Array(2), y: new Float32Array(2) },
      endT: 100,
    };
    expect(replayDuration(late)).toBe(900);
    expect(replayDuration({ ...late, endT: 2000 })).toBe(2000);
  });
});

describe('building the session', () => {
  it('copies the object and section lists, because the session empties the one it is given', () => {
    const { replay } = record(mix);
    const n = replay.map.objects.length;
    const sections = replay.map.sections.length;
    sessionForReplay(replay);
    sessionForReplay(replay);
    expect(replay.map.objects).toHaveLength(n);
    expect(replay.map.sections).toHaveLength(sections);
  });

  it('has every object of every set from the start, with no controller', () => {
    const { replay } = record(mix);
    const s = sessionForReplay(replay);
    expect(s.objs).toHaveLength(replay.map.objects.length);
    expect(s.moreSets).toBe(false);
    expect(s.progressMs).toBe(replay.progressMs);
  });
});

describe('mismatches', () => {
  it('counts differing judgments and missing characters', () => {
    expect(countMismatches('cmsr-', 'cmsr-')).toBe(0);
    expect(countMismatches('cmsr-', 'cmcr-')).toBe(1);
    expect(countMismatches('cm', 'cmsr')).toBe(2);
    expect(countMismatches('', '')).toBe(0);
  });

  it('is zero for a replay of the current engine, and counts changes in the log', () => {
    const { replay } = record(dyn);
    const run = new ReplayRunner(replay);
    run.feedAll();
    expect(countMismatches(run.judgments(), replay.judgments)).toBe(0);
    // Drop every press: the same trace now judges differently.
    const keep: number[] = [];
    for (let i = 0; i < replay.trace.count; i++) {
      const op = replay.trace.ops[i] as number;
      if (op < TRACE_OP.pressAt || op >= TRACE_OP.release) keep.push(i);
    }
    const trace = {
      count: keep.length,
      ops: Uint8Array.from(keep.map((i) => replay.trace.ops[i] as number)),
      t: Float64Array.from(keep.map((i) => replay.trace.t[i] as number)),
      x: Float32Array.from(keep.map((i) => replay.trace.x[i] as number)),
      y: Float32Array.from(keep.map((i) => replay.trace.y[i] as number)),
    };
    const broken = new ReplayRunner({ ...replay, trace });
    broken.feedAll();
    expect(countMismatches(broken.judgments(), replay.judgments)).toBeGreaterThan(5);
  });
});
