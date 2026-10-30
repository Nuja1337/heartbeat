import { describe, expect, it } from 'vitest';
import { DEFAULT_DIFFICULTY, REPLAY_FORMAT, TRACE_OP } from './catalog';
import { ReplayFormatError, decodeReplay, encodeReplay, isTightBuffer } from './replay';
import type { CircleObject, InputTrace, LaunchRequest, PlayableMap, ReplayData, SliderObject, SpinnerObject } from './types';

/* ------------------------------------------------------------ test helpers */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const windows = { crisp: 40, solid: 80, rough: 120, early: 180 };
const base = { radius: 50, approachMs: 800, windows, group: 0, number: 1, intensity: 0.5, set: -1 };

/** Three objects, one of each kind. Small on purpose, so the streams dominate the container. */
function tinyMap(): PlayableMap {
  const circle: CircleObject = { ...base, kind: 'circle', index: 0, time: 1000, pos: { x: 200, y: 300 }, pattern: 'single' };
  const slider: SliderObject = {
    ...base, kind: 'slider', index: 1, time: 2000, pos: { x: 400, y: 300 }, pattern: 'slider',
    path: [{ type: 'line', to: { x: 600, y: 300 } }], length: 200, velocity: 0.2, repeats: 0, spanMs: 1000, endTime: 3000,
    tickDistance: 50, followRadius: 100, shape: 'straight',
  };
  const spinner: SpinnerObject = {
    ...base, kind: 'spinner', index: 2, time: 4000, pos: { x: 500, y: 312.5 }, pattern: 'spinner', endTime: 5000, rotationsRequired: 3,
  };
  return {
    format: 1, generatorVersion: 2, seed: 7, modeId: 'dynamic', beatMs: 500, durationMs: 6000, health: null,
    objects: [circle, slider, spinner],
    sections: [{ start: 0, end: 6000, intensity: 0.5, focus: 'mixed', role: 'build' }],
    mods: ['mirror'], rate: 1,
  };
}

const launch: LaunchRequest = {
  modeId: 'dynamic', difficulty: { ...DEFAULT_DIFFICULTY }, presetLevel: 4, options: {}, mods: ['mirror'], seed: 7, lengthSec: 60,
  levels: {}, drillId: null, source: { kind: 'manual' },
};

type Ev = [op: number, t: number, x?: number, y?: number];

function traceOf(events: readonly Ev[]): InputTrace {
  const n = events.length;
  const trace: InputTrace = { count: n, ops: new Uint8Array(n), t: new Float64Array(n), x: new Float32Array(n), y: new Float32Array(n) };
  events.forEach(([op, t, x, y], i) => {
    trace.ops[i] = op;
    trace.t[i] = t;
    trace.x[i] = x ?? 0;
    trace.y[i] = y ?? 0;
  });
  return trace;
}

function replayOf(trace: InputTrace, map: PlayableMap = tinyMap()): ReplayData {
  return {
    format: REPLAY_FORMAT, engineVersion: 2, launch, map, progressMs: 6000, status: 'completed', endT: 6000,
    judgments: 'csrm-', levels: [{ set: 0, module: 'jumps', level: 3, success: 0.75, objects: 12 }], trace,
  };
}

function expectSameTrace(a: InputTrace, b: InputTrace): void {
  expect(b.count).toBe(a.count);
  expect(b.ops).toEqual(a.ops.subarray(0, a.count));
  expect(b.t).toEqual(a.t.subarray(0, a.count));
  expect(b.x).toEqual(a.x.subarray(0, a.count));
  expect(b.y).toEqual(a.y.subarray(0, a.count));
}

function roundTrip(data: ReplayData): ReplayData {
  const out = decodeReplay(encodeReplay(data));
  expectSameTrace(data.trace, out.trace);
  const { trace: _a, ...head } = data;
  const { trace: _b, ...outHead } = out;
  expect(outHead).toEqual(JSON.parse(JSON.stringify(head)));
  return out;
}

const hex = (u8: Uint8Array): string => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
const u32 = (n: number): number[] => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

function headerLength(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true);
}

/** Offset of N, which follows the header. */
const bodyOffset = (bytes: Uint8Array): number => 12 + headerLength(bytes);

/** Builds a container by hand, independently of the encoder. */
function container(opts: {
  head?: object; n: number; p: number; ops: number[]; t: number[]; x: number[]; y: number[];
  version?: number; flags?: number; reserved?: number[];
}): Uint8Array {
  const { trace: _t, ...head } = replayOf(traceOf([]));
  const header = new TextEncoder().encode(JSON.stringify(opts.head ?? head));
  return Uint8Array.from([
    0x48, 0x42, 0x52, 0x50, opts.version ?? REPLAY_FORMAT, opts.flags ?? 0, ...(opts.reserved ?? [0, 0]),
    ...u32(header.length), ...header, ...u32(opts.n), ...u32(opts.p), ...opts.ops,
    ...u32(opts.t.length), ...opts.t, ...u32(opts.x.length), ...opts.x, ...u32(opts.y.length), ...opts.y,
  ]);
}

function kindOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof ReplayFormatError ? e.kind : `other:${String(e)}`;
  }
  return 'returned';
}

/** Random trace that uses every op, with t that sometimes goes down. */
function randomTrace(rand: () => number, n: number): InputTrace {
  const events: Ev[] = [];
  let t = Math.floor(rand() * 5000) / 64;
  for (let i = 0; i < n; i++) {
    const op = i < 16 ? i : Math.floor(rand() * 16);
    t += (Math.floor(rand() * 400) - (rand() < 0.1 ? 600 : 0)) / 64;
    const positioned = op <= 4;
    events.push([op, t, positioned ? (Math.floor(rand() * 20000) - 4000) / 16 : 0, positioned ? (Math.floor(rand() * 14000) - 2000) / 16 : 0]);
  }
  return traceOf(events);
}

/* ---------------------------------------------------------------- codec */

describe('replay codec round trip', () => {
  it('round-trips 50 random traces that cover every op', () => {
    const rand = rng(1234);
    for (let k = 0; k < 50; k++) {
      const n = 16 + Math.floor(rand() * 400);
      const data = replayOf(randomTrace(rand, n));
      const ops = new Set(data.trace.ops);
      expect(ops.size).toBe(16);
      roundTrip(data);
    }
  });

  it('writes a tight buffer, and decodes a view with a byte offset', () => {
    const bytes = encodeReplay(replayOf(randomTrace(rng(5), 40)));
    expect(isTightBuffer(bytes)).toBe(true);
    const padded = new Uint8Array(bytes.length + 7);
    padded.set(bytes, 3);
    const view = padded.subarray(3, 3 + bytes.length);
    expect(isTightBuffer(view)).toBe(false);
    expect(decodeReplay(view).trace.count).toBe(40);
  });

  it('ignores trace array space past count', () => {
    const data = replayOf(randomTrace(rng(6), 30));
    const longer = { ...data.trace, count: 20 };
    const out = decodeReplay(encodeReplay({ ...data, trace: longer }));
    expect(out.trace.count).toBe(20);
    expect(out.trace.t).toEqual(data.trace.t.subarray(0, 20));
  });
});

describe('replay codec golden bytes', () => {
  // Frozen after review. If this fails the format changed: bump REPLAY_FORMAT instead of editing the hex.
  const events: Ev[] = [
    [TRACE_OP.move, 0, 10.5, 20.25],
    [TRACE_OP.pressAt + 1, 100.5, 11, 21],
    [TRACE_OP.advance, 120],
    [TRACE_OP.release + 2, 130.25],
    [TRACE_OP.press, 100],
  ];
  const data = replayOf(traceOf(events));
  // Prefix: "HBRP", version 1, flags 0, reserved 0, H = 1591. Body: N = 5, P = 2, ops 0 2 13 11 5, then the three streams.
  const GOLDEN_PREFIX = '484252500100000037060000';
  const GOLDEN_BODY =
    '05000000' + '02000000' + '00020d0b05' + '09000000' + '00c064ff509f09bf28' + '04000000' + 'd002bf02' + '04000000' + '8805ef04';

  it('matches the frozen bytes', () => {
    const bytes = encodeReplay(data);
    const h = headerLength(bytes);
    expect(hex(bytes.subarray(0, 12))).toBe(GOLDEN_PREFIX);
    expect(hex(bytes.subarray(12 + h))).toBe(GOLDEN_BODY);
    const { trace: _t, ...head } = data;
    expect(JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + h)))).toEqual(JSON.parse(JSON.stringify(head)));
  });

  it('decodes the frozen bytes back to the replay', () => {
    roundTrip(data);
  });
});

describe('replay codec rejection', () => {
  const good = encodeReplay(replayOf(traceOf([[0, 0, 1, 1], [1, 5, 2, 2], [13, 6], [9, 7], [5, 8]])));
  const withByte = (i: number, v: number): Uint8Array => {
    const c = good.slice();
    c[i] = v;
    return c;
  };

  it('rejects bad magic and short input', () => {
    expect(kindOf(() => decodeReplay(withByte(0, 0x47)))).toBe('damaged');
    expect(kindOf(() => decodeReplay(withByte(3, 0)))).toBe('damaged');
    expect(kindOf(() => decodeReplay(new Uint8Array(0)))).toBe('damaged');
    expect(kindOf(() => decodeReplay(good.subarray(0, 11)))).toBe('damaged');
  });

  it('calls a newer version, non-zero flags and non-zero reserved bytes "newer"', () => {
    expect(kindOf(() => decodeReplay(withByte(4, REPLAY_FORMAT + 1)))).toBe('newer');
    expect(kindOf(() => decodeReplay(withByte(4, 255)))).toBe('newer');
    expect(kindOf(() => decodeReplay(withByte(5, 1)))).toBe('newer');
    expect(kindOf(() => decodeReplay(withByte(6, 1)))).toBe('newer');
    expect(kindOf(() => decodeReplay(withByte(7, 0x80)))).toBe('newer');
    expect(kindOf(() => decodeReplay(withByte(4, 0)))).toBe('damaged');
  });

  it('uses the two documented messages', () => {
    expect(() => decodeReplay(withByte(4, 9))).toThrow('This replay was made by a newer version of Heartbeat.');
    expect(() => decodeReplay(withByte(0, 0))).toThrow('This replay is damaged.');
  });

  it('rejects every truncation', () => {
    for (let len = 0; len < good.length; len++) expect(kindOf(() => decodeReplay(good.subarray(0, len))), `length ${len}`).toBe('damaged');
  });

  it('rejects trailing bytes', () => {
    const longer = new Uint8Array(good.length + 1);
    longer.set(good);
    expect(kindOf(() => decodeReplay(longer))).toBe('damaged');
  });

  it('rejects unknown ops', () => {
    const at = bodyOffset(good) + 8;
    expect(kindOf(() => decodeReplay(withByte(at, 16)))).toBe('damaged');
    expect(kindOf(() => decodeReplay(withByte(at, 255)))).toBe('damaged');
    expect(kindOf(() => decodeReplay(withByte(at, 15)))).toBe('damaged'); // resume is a valid op, but P no longer matches
  });

  it('rejects a P that does not match the ops', () => {
    const at = bodyOffset(good) + 4;
    expect(kindOf(() => decodeReplay(withByte(at, 3)))).toBe('damaged');
    expect(kindOf(() => decodeReplay(withByte(at, 1)))).toBe('damaged');
    expect(kindOf(() => decodeReplay(withByte(at, 6)))).toBe('damaged');
  });

  it('rejects lengths larger than the bytes that remain, before allocating', () => {
    const o = bodyOffset(good);
    const n = 5;
    const patched = (at: number): Uint8Array => {
      const c = good.slice();
      c.set([255, 255, 255, 255], at);
      return c;
    };
    expect(kindOf(() => decodeReplay(patched(8)))).toBe('damaged'); // H
    expect(kindOf(() => decodeReplay(patched(o)))).toBe('damaged'); // N
    expect(kindOf(() => decodeReplay(patched(o + 4)))).toBe('damaged'); // P
    const lt = o + 8 + n;
    expect(kindOf(() => decodeReplay(patched(lt)))).toBe('damaged'); // LT
    const lx = lt + 4 + new DataView(good.buffer).getUint32(lt, true);
    expect(kindOf(() => decodeReplay(patched(lx)))).toBe('damaged'); // LX
    const ly = lx + 4 + new DataView(good.buffer).getUint32(lx, true);
    expect(kindOf(() => decodeReplay(patched(ly)))).toBe('damaged'); // LY
  });

  it('rejects a varint longer than 8 bytes', () => {
    const nine = [0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x01];
    const c = container({ n: 1, p: 0, ops: [13], t: nine, x: [], y: [] });
    expect(kindOf(() => decodeReplay(c))).toBe('damaged');
    // Eight bytes are allowed, but not a value of 2^53 or more.
    const tooBig = container({ n: 1, p: 0, ops: [13], t: [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x10], x: [], y: [] });
    expect(kindOf(() => decodeReplay(tooBig))).toBe('damaged');
    // 2^53 - 1 is the largest value. It zigzags to -2^52, which is a safe integer.
    const biggestOk = container({ n: 1, p: 0, ops: [13], t: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f], x: [], y: [] });
    expect(kindOf(() => decodeReplay(biggestOk))).toBe('returned');
  });

  it('rejects a varint that runs past its stream, a stream with spare bytes, and a non-minimal varint', () => {
    expect(kindOf(() => decodeReplay(container({ n: 1, p: 0, ops: [13], t: [0x80], x: [], y: [] })))).toBe('damaged');
    expect(kindOf(() => decodeReplay(container({ n: 1, p: 0, ops: [13], t: [0x02, 0x00], x: [], y: [] })))).toBe('damaged');
    expect(kindOf(() => decodeReplay(container({ n: 1, p: 0, ops: [13], t: [0x82, 0x00], x: [], y: [] })))).toBe('damaged');
    expect(kindOf(() => decodeReplay(container({ n: 2, p: 0, ops: [13, 13], t: [0x02], x: [], y: [] })))).toBe('damaged');
    expect(kindOf(() => decodeReplay(container({ n: 1, p: 0, ops: [13], t: [0x02], x: [], y: [] })))).toBe('returned');
  });

  it('rejects a damaged or incomplete header', () => {
    const { trace: _t, ...head } = replayOf(traceOf([]));
    const c = (h: unknown): Uint8Array => container({ head: h as object, n: 0, p: 0, ops: [], t: [], x: [], y: [] });
    expect(kindOf(() => decodeReplay(c(head)))).toBe('returned');
    expect(kindOf(() => decodeReplay(c({ ...head, map: null })))).toBe('damaged');
    expect(kindOf(() => decodeReplay(c({ ...head, endT: 'x' })))).toBe('damaged');
    expect(kindOf(() => decodeReplay(c([1, 2])))).toBe('damaged');
    const notJson = Uint8Array.from([0x48, 0x42, 0x52, 0x50, 1, 0, 0, 0, ...u32(3), 0x7b, 0x7b, 0x7b, ...u32(0), ...u32(0), ...u32(0), ...u32(0), ...u32(0)]);
    expect(kindOf(() => decodeReplay(notJson))).toBe('damaged');
    const badUtf8 = Uint8Array.from([0x48, 0x42, 0x52, 0x50, 1, 0, 0, 0, ...u32(2), 0xc3, 0x28, ...u32(0), ...u32(0), ...u32(0), ...u32(0), ...u32(0)]);
    expect(kindOf(() => decodeReplay(badUtf8))).toBe('damaged');
  });
});

describe('replay codec vectors', () => {
  it('N = 0', () => {
    const out = roundTrip(replayOf(traceOf([])));
    expect(out.trace.count).toBe(0);
    expect(out.trace.ops.length).toBe(0);
    const bytes = encodeReplay(replayOf(traceOf([])));
    expect(hex(bytes.subarray(bodyOffset(bytes)))).toBe('00000000' + '00000000' + '00000000' + '00000000' + '00000000');
  });

  it('first t = 0, decreasing t, duplicate t', () => {
    roundTrip(replayOf(traceOf([[13, 0], [13, 0], [13, 0]])));
    roundTrip(replayOf(traceOf([[13, 50], [0, 40, 3, 4], [1, 10, 5, 6], [13, 10], [9, 10], [13, 0], [13, 1000]])));
    roundTrip(replayOf(traceOf([[0, 7, 1, 1], [0, 7, 1, 1], [0, 7, 1, 1]])));
  });

  it('negative and off-field positions', () => {
    roundTrip(replayOf(traceOf([[0, 0, -50.5, -0.0625], [1, 1, 5000.0625, -10000.9375], [0, 2, 1048576, -1048576], [0, 3, 0, 625]])));
  });

  it('writes -0 as +0', () => {
    const out = decodeReplay(encodeReplay(replayOf(traceOf([[0, -0, -0, -0], [13, -0]]))));
    expect(Object.is(out.trace.t[0], 0)).toBe(true);
    expect(Object.is(out.trace.x[0], 0)).toBe(true);
    expect(Object.is(out.trace.y[0], 0)).toBe(true);
    expect(Object.is(out.trace.t[1], 0)).toBe(true);
  });

  it('t at and beyond 2^31 / 64 ms', () => {
    const edge = 2 ** 31 / 64;
    roundTrip(replayOf(traceOf([[13, edge - 1 / 64], [13, edge], [13, edge + 1 / 64], [0, edge * 3 + 0.5, 1, 1], [13, 2 ** 40 / 64], [13, 2 ** 45]])));
  });

  it('more than 2 x 65536 events', () => {
    const rand = rng(99);
    const n = 2 * 65536 + 4321;
    const data = replayOf(randomTrace(rand, n));
    const out = roundTrip(data);
    expect(out.trace.count).toBe(n);
  });

  it('rejects P that disagrees with the ops', () => {
    expect(kindOf(() => decodeReplay(container({ n: 2, p: 2, ops: [0, 13], t: [0, 0], x: [0, 0], y: [0, 0] })))).toBe('damaged');
    expect(kindOf(() => decodeReplay(container({ n: 2, p: 0, ops: [0, 13], t: [0, 0], x: [], y: [] })))).toBe('damaged');
    expect(kindOf(() => decodeReplay(container({ n: 2, p: 1, ops: [0, 13], t: [0, 0], x: [0], y: [0] })))).toBe('returned');
  });

  it('throws on an off-grid t or position', () => {
    for (const t of [0.01, 1 / 128, NaN, Infinity, -Infinity, 2 ** 47]) {
      expect(() => encodeReplay(replayOf(traceOf([[13, t]]))), `t ${t}`).toThrow(RangeError);
    }
    for (const v of [0.03, 1 / 32, NaN, Infinity]) {
      expect(() => encodeReplay(replayOf(traceOf([[0, 1, v, 1]]))), `x ${v}`).toThrow(RangeError);
      expect(() => encodeReplay(replayOf(traceOf([[1, 1, 1, v]]))), `y ${v}`).toThrow(RangeError);
    }
  });

  it('does not check x and y of events that carry no position', () => {
    const t = traceOf([[13, 1], [5, 2]]);
    t.x[0] = 0.123;
    t.y[1] = NaN;
    const out = decodeReplay(encodeReplay(replayOf(t)));
    expect(out.trace.x[0]).toBe(0);
    expect(out.trace.y[1]).toBe(0);
  });

  it('throws on an unknown op or a short array', () => {
    expect(() => encodeReplay(replayOf(traceOf([[16, 1]])))).toThrow(RangeError);
    const t = traceOf([[13, 1], [13, 2]]);
    expect(() => encodeReplay(replayOf({ ...t, count: 3 }))).toThrow(RangeError);
  });
});

describe('replay codec fuzz', () => {
  const source = encodeReplay(replayOf(randomTrace(rng(42), 120), tinyMap()));

  /** The structure a decoded replay must have, whatever its values. */
  function expectWellFormed(d: ReplayData): void {
    const n = d.trace.count;
    expect(d.trace.ops.length).toBe(n);
    expect(d.trace.t.length).toBe(n);
    expect(d.trace.x.length).toBe(n);
    expect(d.trace.y.length).toBe(n);
    for (const op of d.trace.ops) expect(op).toBeLessThanOrEqual(15);
  }

  it('throws ReplayFormatError for every truncation of a random container', () => {
    const rand = rng(7);
    for (let i = 0; i < 500; i++) {
      const len = Math.floor(rand() * source.length);
      expect(kindOf(() => decodeReplay(source.slice(0, len))), `length ${len}`).toMatch(/^(damaged|newer)$/);
    }
  });

  it('never throws anything but ReplayFormatError for a flipped byte, and never hangs', () => {
    // There is no checksum, so a flip inside a value (a digit in the header, a stream byte that stays a valid
    // varint) can still decode. What must hold: either a ReplayFormatError, or a well-formed replay.
    const rand = rng(8);
    let rejected = 0;
    for (let i = 0; i < 500; i++) {
      const at = Math.floor(rand() * source.length);
      const c = source.slice();
      c[at] = (c[at]! ^ (1 + Math.floor(rand() * 255))) & 255;
      try {
        expectWellFormed(decodeReplay(c));
      } catch (e) {
        expect(e, `byte ${at}`).toBeInstanceOf(ReplayFormatError);
        rejected++;
      }
    }
    expect(rejected).toBeGreaterThan(50);
  });

  it('always rejects a changed byte in the 12-byte prefix', () => {
    const rand = rng(9);
    for (let at = 0; at < 12; at++) {
      for (let k = 0; k < 20; k++) {
        const c = source.slice();
        c[at] = (c[at]! ^ (1 + Math.floor(rand() * 255))) & 255;
        expect(kindOf(() => decodeReplay(c)), `byte ${at}`).toMatch(/^(damaged|newer)$/);
      }
    }
  });

  it('always rejects a changed length field or op byte', () => {
    const o = bodyOffset(source);
    const n = new DataView(source.buffer, source.byteOffset).getUint32(o, true);
    const rand = rng(10);
    for (let k = 0; k < 100; k++) {
      const at = o + Math.floor(rand() * 8); // N or P
      const c = source.slice();
      c[at] = (c[at]! ^ (1 + Math.floor(rand() * 255))) & 255;
      expect(kindOf(() => decodeReplay(c)), `byte ${at}`).toMatch(/^(damaged|newer)$/);
    }
    // An op byte that becomes unknown, or switches between positioned and not, is rejected.
    for (let i = 0; i < n; i++) {
      const c = source.slice();
      c[o + 8 + i] = c[o + 8 + i]! <= 4 ? 13 : 0;
      expect(kindOf(() => decodeReplay(c)), `op ${i}`).toBe('damaged');
    }
  });
});

describe('replay size', () => {
  /** Minimum-jerk reaches between random targets with dwell, 1 kHz samples with timing jitter, hand tremor, frame advances. */
  function humanTrace(seconds: number): InputTrace {
    const rand = rng(2024);
    const gauss = (): number => (rand() + rand() + rand() + rand() - 2) * 1.2;
    const events: Ev[] = [];
    let from = { x: 500, y: 312.5 };
    let to = { x: 500, y: 312.5 };
    let moveStart = 0;
    let moveEnd = 0;
    let dwellEnd = 0;
    let releaseAt = -1;
    let last = 0;
    const total = seconds * 1000;
    for (let ms = 0; ms < total; ms++) {
      if (ms >= dwellEnd) {
        from = to;
        to = { x: 50 + rand() * 900, y: 50 + rand() * 525 };
        moveStart = ms;
        moveEnd = ms + 220 + rand() * 220;
        dwellEnd = moveEnd + 120 + rand() * 260;
        events.push([TRACE_OP.press + Math.floor(rand() * 4), last + 0.25]);
        releaseAt = ms + 30;
      }
      if (releaseAt >= 0 && ms >= releaseAt) {
        events.push([TRACE_OP.release + Math.floor(rand() * 4), last + 0.25]);
        releaseAt = -1;
      }
      const tau = Math.min(1, Math.max(0, (ms - moveStart) / (moveEnd - moveStart)));
      const s = 10 * tau ** 3 - 15 * tau ** 4 + 6 * tau ** 5;
      const t = Math.max(last + 1 / 64, Math.round((ms + (rand() - 0.5) * 0.08) * 64) / 64);
      last = t;
      const q = (v: number): number => Math.round((v + gauss() * 0.06) * 16) / 16;
      events.push([TRACE_OP.move, t, q(from.x + (to.x - from.x) * s), q(from.y + (to.y - from.y) * s)]);
      if (ms % 4 === 0) events.push([TRACE_OP.advance, t + 0.5]);
    }
    return traceOf(events);
  }

  it('encodes a 120 s, 1 kHz human-like path at 4 bytes per event or less', () => {
    const data = replayOf(humanTrace(120));
    const bytes = encodeReplay(data);
    const body = bytes.length - bodyOffset(bytes);
    const perEvent = body / data.trace.count;
    expect(data.trace.count).toBeGreaterThan(120_000);
    expect(perEvent).toBeLessThanOrEqual(4); // measured 3.60 on this path
    expect(bytes.length / data.trace.count).toBeLessThanOrEqual(4); // header included
    expectSameTrace(data.trace, decodeReplay(bytes).trace);
  });
});
