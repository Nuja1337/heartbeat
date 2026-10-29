import { describe, expect, it } from 'vitest';
import { TRACE_OP } from '../../shared/catalog';
import { pressOp, qp, qt, releaseOp, TraceRecorder } from './recorder';

describe('quantizing', () => {
  it('snaps times to 1/64 ms and positions to 1/16', () => {
    expect(qt(1)).toBe(1);
    expect(qt(1.01)).toBe(1.015625);
    expect(qt(1 / 128)).toBe(1 / 64);
    expect(qp(0.03)).toBe(0);
    expect(qp(0.04)).toBe(0.0625);
    expect(qp(100.04)).toBe(100.0625);
    expect(qp(-0.01)).toBe(0);
  });

  it('turns -0 into +0', () => {
    expect(Object.is(qt(-0), 0)).toBe(true);
    expect(Object.is(qt(-0.001), 0)).toBe(true);
    expect(Object.is(qp(-0.01), 0)).toBe(true);
    expect(Object.is(qp(-0), 0)).toBe(true);
  });

  it('is idempotent', () => {
    for (const v of [0.3, 17.123456, 99999.999, -4.2]) {
      expect(qt(qt(v))).toBe(qt(v));
      expect(qp(qp(v))).toBe(qp(v));
    }
  });
});

describe('op codes', () => {
  it('add the slot to the base op', () => {
    expect(pressOp('key1', true)).toBe(TRACE_OP.pressAt);
    expect(pressOp('mouse2', true)).toBe(TRACE_OP.pressAt + 3);
    expect(pressOp('key2', false)).toBe(TRACE_OP.press + 1);
    expect(releaseOp('mouse1')).toBe(TRACE_OP.release + 2);
  });
});

describe('TraceRecorder', () => {
  it('returns what was recorded, across several chunks', () => {
    const rec = new TraceRecorder(8);
    for (let i = 0; i < 29; i++) rec.record(i % 16, i * 0.5, i % 3, -i);
    expect(rec.count).toBe(29);
    const tr = rec.toTrace();
    expect(tr.count).toBe(29);
    expect(tr.ops.length).toBe(29);
    for (let i = 0; i < 29; i++) {
      expect(tr.ops[i]).toBe(i % 16);
      expect(tr.t[i]).toBe(i * 0.5);
      expect(tr.x[i]).toBe(i % 3);
      expect(tr.y[i]).toBe(-i);
    }
  });

  it('gives an empty trace when nothing was recorded', () => {
    const tr = new TraceRecorder(4).toTrace();
    expect(tr.count).toBe(0);
    expect(tr.t.length).toBe(0);
  });

  it('handles a count that fills the chunks exactly', () => {
    const rec = new TraceRecorder(4);
    for (let i = 0; i < 8; i++) rec.record(13, i, 0, 0);
    const tr = rec.toTrace();
    expect(Array.from(tr.t)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps recording after a trace was taken', () => {
    const rec = new TraceRecorder(4);
    rec.record(13, 1, 0, 0);
    const a = rec.toTrace();
    rec.record(13, 2, 0, 0);
    expect(a.count).toBe(1);
    expect(rec.toTrace().count).toBe(2);
  });

  it('allocates the next chunk before the current one is full', () => {
    const rec = new TraceRecorder(100);
    const spareOf = () => (rec as unknown as { spare: unknown }).spare;
    for (let i = 0; i < 74; i++) rec.record(13, i, 0, 0);
    expect(spareOf()).toBeNull();
    rec.record(13, 74, 0, 0);
    expect(spareOf()).not.toBeNull();
    for (let i = 75; i < 100; i++) rec.record(13, i, 0, 0);
    const spare = spareOf();
    rec.record(13, 100, 0, 0);
    // The chunk that was ready is the one in use now, and a new spare is not made until 75% of it is used.
    expect((rec as unknown as { cur: unknown }).cur).toBe(spare);
    expect(spareOf()).toBeNull();
  });
});
