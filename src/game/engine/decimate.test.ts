import { describe, expect, it } from 'vitest';
import { TRACE } from '../../shared/catalog';
import type { InputSlot, Vec2 } from '../../shared/types';
import { Decimator, MIN_GAP_MS } from './decimate';
import type { DecimatorTarget } from './decimate';

type Call =
  | ['move', number, number, number]
  | ['press', InputSlot, number, Vec2 | null]
  | ['release', InputSlot, number]
  | ['advance', number]
  | ['pause', number];

function rig() {
  const calls: Call[] = [];
  const target: DecimatorTarget = {
    move: (t, p) => calls.push(['move', t, p.x, p.y]),
    press: (slot, t, p) => calls.push(['press', slot, t, p ? { x: p.x, y: p.y } : null]),
    release: (slot, t) => calls.push(['release', slot, t]),
    advance: (t) => calls.push(['advance', t]),
    notePause: (t) => calls.push(['pause', t]),
  };
  return { calls, dec: new Decimator(target) };
}

describe('Decimator', () => {
  it('uses the sample cap from the contract', () => {
    expect(MIN_GAP_MS).toBe(1000 / TRACE.maxSampleHz);
    expect(MIN_GAP_MS).toBe(0.5);
  });

  it('feeds at most 2000 samples a second from an 8 kHz stream', () => {
    const { calls, dec } = rig();
    for (let i = 0; i < 8000; i++) dec.move(i * 0.125, i, 0);
    const times = calls.flatMap((c) => (c[0] === 'move' ? [c[1]] : []));
    expect(times.length).toBeLessThanOrEqual(2000);
    expect(times.length).toBeGreaterThan(1900);
    for (let i = 1; i < times.length; i++) expect((times[i] as number) - (times[i - 1] as number)).toBeGreaterThanOrEqual(0.5);
  });

  it('passes a 1 kHz stream through untouched', () => {
    const { calls, dec } = rig();
    for (let i = 0; i < 100; i++) dec.move(i, i, 2 * i);
    expect(calls).toHaveLength(100);
  });

  it('holds a close sample as pending and lets a newer one replace it', () => {
    const { calls, dec } = rig();
    dec.move(10, 1, 1);
    dec.move(10.1, 2, 2);
    dec.move(10.2, 3, 3);
    expect(calls).toEqual([['move', 10, 1, 1]]);
    dec.flush();
    expect(calls).toEqual([
      ['move', 10, 1, 1],
      ['move', 10.2, 3, 3],
    ]);
    dec.flush();
    expect(calls).toHaveLength(2);
  });

  it('flushes the pending sample before a press, a release, an advance and a pause', () => {
    const calls = (act: (d: Decimator) => void): Call[] => {
      const r = rig();
      r.dec.move(10, 1, 1);
      r.dec.move(10.25, 5, 6);
      act(r.dec);
      return r.calls;
    };
    const pending: Call = ['move', 10.25, 5, 6];
    expect(calls((d) => d.press('key1', 10.3, null, null))).toEqual([['move', 10, 1, 1], pending, ['press', 'key1', 10.3, null]]);
    expect(calls((d) => d.press('mouse1', 10.3, 7, 8))).toEqual([['move', 10, 1, 1], pending, ['press', 'mouse1', 10.3, { x: 7, y: 8 }]]);
    expect(calls((d) => d.release('key2', 10.3))).toEqual([['move', 10, 1, 1], pending, ['release', 'key2', 10.3]]);
    expect(calls((d) => d.advance(11))).toEqual([['move', 10, 1, 1], pending, ['advance', 11]]);
    expect(calls((d) => d.notePause(11))).toEqual([['move', 10, 1, 1], pending, ['pause', 11]]);
  });

  it('feeds no extra move when nothing is pending', () => {
    const { calls, dec } = rig();
    dec.move(10, 1, 1);
    dec.press('key1', 11, null, null);
    dec.advance(12);
    expect(calls.map((c) => c[0])).toEqual(['move', 'press', 'advance']);
  });

  it('moveNow flushes and then feeds its own sample', () => {
    const { calls, dec } = rig();
    dec.move(10, 1, 1);
    dec.move(10.1, 2, 2);
    dec.moveNow(10.2, 3, 3);
    expect(calls).toEqual([
      ['move', 10, 1, 1],
      ['move', 10.1, 2, 2],
      ['move', 10.2, 3, 3],
    ]);
  });

  it('measures the gap from the last sample that went through', () => {
    const { calls, dec } = rig();
    dec.move(0, 0, 0);
    dec.move(0.3, 1, 0);
    dec.move(0.6, 2, 0);
    expect(calls).toEqual([
      ['move', 0, 0, 0],
      ['move', 0.6, 2, 0],
    ]);
  });
});
