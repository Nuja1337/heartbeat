import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/catalog';
import { applyMods } from '../map/mods';
import { fakeAudioContext } from '../testing/fakes';
import { makeCircle, makeMap } from '../testing/fixtures';
import { AudioEngine } from './audio';
import { beatsInWindow, isDownbeat, LOOKAHEAD_MS, Metronome, toContextTime } from './metronome';
import type { OutputStamp } from './metronome';
import type { Bus } from './sounds';

describe('beatsInWindow', () => {
  it('lists the beats in a half-open window', () => {
    expect(beatsInWindow(500, 2000, 2000, 3000, 'beat')).toEqual([2000, 2500]);
    expect(beatsInWindow(500, 2000, 1990, 2010, 'beat')).toEqual([2000]);
    expect(beatsInWindow(500, 2000, 2001, 2499, 'beat')).toEqual([]);
    expect(beatsInWindow(500, 2000, 2001, 2500, 'beat')).toEqual([]);
    expect(beatsInWindow(500, 2000, 2001, 2500.5, 'beat')).toEqual([2500]);
  });

  it('has nothing before beat 0', () => {
    expect(beatsInWindow(500, 2000, 0, 1999, 'beat')).toEqual([]);
    expect(beatsInWindow(500, 2000, 0, 2600, 'beat')).toEqual([2000, 2500]);
  });

  it('keeps only every fourth beat in bar mode, counted from beat 0', () => {
    expect(beatsInWindow(500, 2000, 0, 6100, 'bar')).toEqual([2000, 4000, 6000]);
    expect(beatsInWindow(500, 2000, 2100, 3900, 'bar')).toEqual([]);
    expect(beatsInWindow(500, 2000, 2100, 4100, 'bar')).toEqual([4000]);
  });

  it('is silent when off, or for a bad grid or window', () => {
    expect(beatsInWindow(500, 2000, 0, 9000, 'off')).toEqual([]);
    expect(beatsInWindow(0, 2000, 0, 9000, 'beat')).toEqual([]);
    expect(beatsInWindow(500, 2000, 3000, 3000, 'beat')).toEqual([]);
    expect(beatsInWindow(500, 2000, 4000, 3000, 'beat')).toEqual([]);
  });

  it('covers a run of windows without a gap or a repeat', () => {
    const all: number[] = [];
    const out: number[] = [];
    let end = 0;
    for (let from = 0; from < 20000; from += 16.7) {
      all.push(...beatsInWindow(333.3, 2000.4, from, from + 16.7, 'beat', out));
      end = from + 16.7;
    }
    const want = beatsInWindow(333.3, 2000.4, 0, end, 'beat');
    expect(all.length).toBeGreaterThan(50);
    expect(all.length).toBe(want.length);
    all.forEach((t, i) => expect(t).toBeCloseTo(want[i]!, 6));
  });

  it('reuses the array it is given', () => {
    const out = [1, 2, 3];
    expect(beatsInWindow(500, 0, 0, 1200, 'beat', out)).toBe(out);
    expect(out).toEqual([0, 500, 1000]);
    expect(beatsInWindow(500, 0, 0, 0, 'beat', out)).toBe(out);
    expect(out).toEqual([]);
  });

  it('marks the first beat of each bar as the downbeat', () => {
    expect([0, 1, 2, 3, 4, 5].map((n) => isDownbeat(500, 2000, 2000 + n * 500))).toEqual([true, false, false, false, true, false]);
  });
});

describe('toContextTime', () => {
  it('maps through the output timestamp', () => {
    const stamp: OutputStamp = { contextTime: 12, performanceTime: 50000 };
    expect(toContextTime(50000, stamp, 99, 99999)).toBe(12);
    expect(toContextTime(50250, stamp, 99, 99999)).toBeCloseTo(12.25, 9);
    expect(toContextTime(49900, stamp, 99, 99999)).toBeCloseTo(11.9, 9);
  });

  it('falls back to currentTime and performance.now() without a timestamp, or before output starts', () => {
    expect(toContextTime(51000, null, 7, 50000)).toBeCloseTo(8, 9);
    expect(toContextTime(51000, { contextTime: 0, performanceTime: 0 }, 7, 50000)).toBeCloseTo(8, 9);
  });
});

/* ------------------------------------------------------------- scheduler */

interface Started {
  t: number;
  freq: number;
  stopped: boolean;
}

interface Harness {
  bus: Bus;
  clicks: Started[];
  setNow: (v: number) => void;
}

/** A bus on a context whose clock the test drives. Records every sine start. */
function clockedBus(stamp?: () => OutputStamp): Harness {
  const clicks: Started[] = [];
  const ctx = fakeAudioContext({ oscillators: 0, sources: 0 }) as unknown as Record<string, unknown>;
  let now = 0;
  Object.defineProperty(ctx, 'currentTime', { get: () => now });
  if (stamp) ctx.getOutputTimestamp = stamp;
  const create = ctx.createOscillator as () => { frequency: { value: number }; start: (t: number) => void; stop: () => void };
  ctx.createOscillator = () => {
    const o = create();
    const rec: Started = { t: Number.NaN, freq: 0, stopped: false };
    clicks.push(rec);
    o.start = (t: number) => {
      rec.t = t;
      rec.freq = o.frequency.value;
    };
    // The click stops itself 20 ms after it starts, with a stop call that has a time. A stop with none is the pause.
    o.stop = ((when?: number) => {
      if (when === undefined) rec.stopped = true;
    }) as never;
    return o as never;
  };
  const c = ctx as unknown as AudioContext;
  const gain = () => c.createGain();
  const bus: Bus = { ctx: c, hits: gain(), effects: gain(), ambient: gain(), metronome: gain(), noise: c.createBuffer(1, 48000, 48000), live: { n: 0, max: 24 } };
  return { bus, clicks, setNow: (v: number) => (now = v) };
}

type Grid = { beatMs: number; beatOffsetMs: number | undefined };

/** Run frames of 16 ms play time. perf = playT + base, and the context clock reads perf / 1000. */
function frames(m: Metronome, h: Harness, grid: Grid, mode: 'off' | 'beat' | 'bar', offsetMs: number, from: number, to: number, base = 10000): void {
  for (let playT = from; playT < to; playT += 16) {
    h.setNow((playT + base) / 1000);
    m.update(h.bus, grid, mode, offsetMs, playT, playT + base);
  }
}

describe('Metronome scheduler', () => {
  const grid: Grid = { beatMs: 500, beatOffsetMs: 2000 };

  it('schedules each beat once, on the audio clock, a window ahead', () => {
    const h = clockedBus();
    frames(new Metronome(), h, grid, 'beat', 0, 0, 4000);
    const times = h.clicks.map((c) => c.t);
    expect(times.length).toBeGreaterThanOrEqual(5);
    times.forEach((t, i) => expect(t).toBeCloseTo((2000 + i * 500 + 10000) / 1000, 6));
    expect(new Set(times).size).toBe(times.length);
  });

  it('uses the output timestamp when the context has one', () => {
    // The speakers are 40 ms behind the context clock: at performance 10000 ms the output is at context 9.96 s.
    const h = clockedBus(() => ({ contextTime: 9.96, performanceTime: 10000 }));
    frames(new Metronome(), h, grid, 'beat', 0, 1800, 2300);
    expect(h.clicks).toHaveLength(1);
    // Play time 2000 is perf 12000, which is context 9.96 + 2.0.
    expect(h.clicks[0]!.t).toBeCloseTo(9.96 + 2000 / 1000, 6);
  });

  it('starts every click offsetMs early, and finds the beats that moves into the window', () => {
    const none = clockedBus();
    frames(new Metronome(), none, grid, 'beat', 0, 0, 3200);
    const early = clockedBus();
    frames(new Metronome(), early, grid, 'beat', 120, 0, 3200);
    expect(early.clicks.length).toBeGreaterThanOrEqual(none.clicks.length);
    early.clicks.forEach((c, i) => expect(c.t, `click ${i}`).toBeCloseTo(none.clicks[i]!.t - 0.12, 6));
    // A large offset must still schedule: a beat at 2000 starts at 1700 and is found from play time 1550.
    const big = clockedBus();
    frames(new Metronome(), big, grid, 'beat', 300, 0, 2100);
    expect(big.clicks.length).toBeGreaterThanOrEqual(1);
    expect(big.clicks[0]!.t).toBeCloseTo((2000 - 300 + 10000) / 1000, 6);
  });

  it('accepts a negative offset, which plays the click later', () => {
    const h = clockedBus();
    frames(new Metronome(), h, grid, 'beat', -100, 0, 2300);
    expect(h.clicks[0]!.t).toBeCloseTo((2000 + 100 + 10000) / 1000, 6);
  });

  it('is silent without a beat offset, and when off', () => {
    const a = clockedBus();
    frames(new Metronome(), a, { beatMs: 500, beatOffsetMs: undefined }, 'beat', 0, 0, 5000);
    expect(a.clicks).toHaveLength(0);
    const b = clockedBus();
    frames(new Metronome(), b, grid, 'off', 0, 0, 5000);
    expect(b.clicks).toHaveLength(0);
  });

  it('clicks every fourth beat in bar mode, and the downbeat is higher than the rest', () => {
    const h = clockedBus();
    frames(new Metronome(), h, grid, 'bar', 0, 0, 8200);
    expect(h.clicks).toHaveLength(4);
    h.clicks.forEach((c, i) => expect(c.t).toBeCloseTo((2000 + i * 2000 + 10000) / 1000, 6));
    const all = clockedBus();
    frames(new Metronome(), all, grid, 'beat', 0, 0, 4200);
    expect(all.clicks.map((c) => c.freq).slice(0, 5)).toEqual([2200, 1600, 1600, 1600, 2200]);
  });

  it('skips a beat more than 5 ms in the past, and plays one 4 ms in the past at once', () => {
    const late = clockedBus();
    late.setNow((2006 + 10000) / 1000);
    new Metronome().update(late.bus, grid, 'beat', 0, 2006, 2006 + 10000);
    expect(late.clicks).toHaveLength(0);
    const ok = clockedBus();
    ok.setNow((2004 + 10000) / 1000);
    new Metronome().update(ok.bus, grid, 'beat', 0, 2004, 2004 + 10000);
    expect(ok.clicks).toHaveLength(1);
    // It plays now instead of at a time that has gone by.
    expect(ok.clicks[0]!.t).toBeCloseTo((2004 + 10000) / 1000, 6);
  });

  it('stops what is scheduled on a pause and stays on the beat after the resume', () => {
    const h = clockedBus();
    const m = new Metronome();
    // Play time 2400: the beat at 2500 is inside the window and scheduled.
    frames(m, h, grid, 'beat', 0, 1600, 2401);
    const before = h.clicks.filter((c) => Math.abs(c.t - 12.5) < 1e-6);
    expect(before).toHaveLength(1);
    m.stop();
    expect(before[0]!.stopped).toBe(true);
    const sofar = h.clicks.length;
    // The pause lasts 5000 ms, so perf time is 5000 ms ahead for the same play time.
    for (let playT = 2400; playT < 3100; playT += 16) {
      h.setNow((playT + 15000) / 1000);
      m.update(h.bus, grid, 'beat', 0, playT, playT + 15000);
    }
    const after = h.clicks.slice(sofar);
    // The stopped beat is scheduled again, on the new perf time, and so are the ones after it.
    expect(after.length).toBeGreaterThanOrEqual(2);
    after.forEach((c, i) => expect(c.t).toBeCloseTo((2500 + i * 500 + 15000) / 1000, 6));
  });

  it('stays on the beat through Fast and Slow', () => {
    for (const [mod, rate] of [['fast', 1.25], ['slow', 0.8]] as const) {
      const map = applyMods(makeMap([makeCircle(0, 2000, 100, 100)], { beatMs: 500, beatOffsetMs: 2000 }), [mod]);
      const g: Grid = { beatMs: map.beatMs, beatOffsetMs: map.beatOffsetMs };
      expect(g.beatMs).toBeCloseTo(500 / rate, 9);
      const h = clockedBus();
      frames(new Metronome(), h, g, 'beat', 0, 0, 5000);
      expect(h.clicks.length).toBeGreaterThan(4);
      h.clicks.forEach((c, i) => expect(c.t * 1000 - 10000, `${mod} click ${i}`).toBeCloseTo(map.beatOffsetMs! + i * map.beatMs, 4));
    }
  });

  it('keeps no more than 8 clicks to stop', () => {
    const h = clockedBus();
    const m = new Metronome();
    // A dense grid, many clicks in each window.
    frames(m, h, { beatMs: 20, beatOffsetMs: 0 }, 'beat', 0, 0, 1000);
    expect(h.clicks.length).toBeGreaterThan(40);
    m.stop();
    expect(h.clicks.filter((c) => c.stopped).length).toBeLessThanOrEqual(8);
  });

  it('looks 150 ms ahead', () => {
    expect(LOOKAHEAD_MS).toBe(150);
    const h = clockedBus();
    h.setNow(10);
    new Metronome().update(h.bus, grid, 'beat', 0, 1860, 11860);
    expect(h.clicks).toHaveLength(1);
    const far = clockedBus();
    new Metronome().update(far.bus, grid, 'beat', 0, 1840, 11840);
    expect(far.clicks).toHaveLength(0);
  });
});

describe('AudioEngine.tickMetronome', () => {
  const grid: Grid = { beatMs: 500, beatOffsetMs: 2000 };

  it('follows the metronome setting and the grid', () => {
    const log = { oscillators: 0, sources: 0 };
    const mk = (metronome: 'off' | 'beat' | 'bar') => {
      const a = new AudioEngine({ ...DEFAULT_SETTINGS.audio, metronome }, () => fakeAudioContext(log));
      a.resume();
      return a;
    };
    mk('off').tickMetronome(grid, 1900, 5000);
    expect(log.oscillators).toBe(0);
    mk('beat').tickMetronome({ beatMs: 500, beatOffsetMs: undefined }, 1900, 5000);
    expect(log.oscillators).toBe(0);
    mk('beat').tickMetronome(grid, 1900, 5000);
    expect(log.oscillators).toBe(1);
  });

  it('stops the clicks when quieted, and schedules the beat again after', () => {
    const log = { oscillators: 0, sources: 0 };
    const a = new AudioEngine({ ...DEFAULT_SETTINGS.audio, metronome: 'beat' }, () => fakeAudioContext(log));
    a.resume();
    a.tickMetronome(grid, 1900, 5000);
    a.quiet();
    a.tickMetronome(grid, 1900, 9000);
    expect(log.oscillators).toBe(2);
  });
});
