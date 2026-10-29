import { describe, expect, it } from 'vitest';
import { windowsForTiming } from '../../shared/catalog';
import { classifyError, insideTarget, nearestAimPress, resolvePress } from './judge';
import type { Target } from './judge';

const w = windowsForTiming(5); // 40, 80, 120, early 180

function target(time: number, x = 100, y = 100, radius = 40): Target {
  return { time, x, y, radius, windows: w, judged: false };
}

describe('classifyError', () => {
  it('includes the window edges', () => {
    expect(classifyError(40, w)).toBe('crisp');
    expect(classifyError(-40, w)).toBe('crisp');
    expect(classifyError(40.01, w)).toBe('solid');
    expect(classifyError(80, w)).toBe('solid');
    expect(classifyError(-120, w)).toBe('rough');
    expect(classifyError(120.01, w)).toBeNull();
  });

  it('calls a press in the early band an early miss', () => {
    expect(classifyError(-120.01, w)).toBe('early');
    expect(classifyError(-180, w)).toBe('early');
  });

  it('ignores presses earlier than that', () => {
    expect(classifyError(-180.01, w)).toBeNull();
  });
});

describe('insideTarget', () => {
  it('counts the radius edge as inside', () => {
    expect(insideTarget(140, 100, target(0))).toBe(true);
    expect(insideTarget(140.01, 100, target(0))).toBe(false);
  });
});

describe('resolvePress', () => {
  it('hits the first target under the cursor', () => {
    const r = resolvePress([target(1000)], 0, 1010, 100, 100);
    expect(r.kind).toBe('hit');
    expect(r.index).toBe(0);
    expect(r.error).toBe(10);
  });

  it('is an early miss between early and rough', () => {
    const r = resolvePress([target(1000)], 0, 1000 - 150, 100, 100);
    expect(r.kind).toBe('early');
    expect(r.index).toBe(0);
  });

  it('is stray when no window is open', () => {
    const r = resolvePress([target(1000)], 0, 500, 100, 100);
    expect(r.kind).toBe('stray');
  });

  it('is stray when the cursor is off the target', () => {
    const r = resolvePress([target(1000)], 0, 1000, 400, 400);
    expect(r.kind).toBe('stray');
    expect(r.near).toEqual([]);
  });

  it('lists targets a stray press came close to', () => {
    const r = resolvePress([target(1000)], 0, 1000, 100 + 100, 100);
    expect(r.kind).toBe('stray');
    expect(r.near).toEqual([0]);
  });

  it('skips an earlier target that is already past its time', () => {
    const a = target(1000, 100, 100);
    const b = target(1060, 300, 100);
    const r = resolvePress([a, b], 0, 1070, 300, 100);
    expect(r.kind).toBe('hit');
    expect(r.index).toBe(1);
    expect(r.skipped).toEqual([0]);
  });

  it('absorbs a press when an earlier target is still ahead', () => {
    const a = target(1100, 100, 100);
    const b = target(1160, 300, 100);
    const r = resolvePress([a, b], 0, 1050, 300, 100);
    expect(r.kind).toBe('absorbed');
    expect(r.skipped).toEqual([]);
  });

  it('ignores judged targets', () => {
    const a = target(1000);
    a.judged = true;
    const r = resolvePress([a], 0, 1000, 100, 100);
    expect(r.kind).toBe('stray');
  });
});

describe('nearestAimPress', () => {
  it('keeps the press closest to the center', () => {
    const a = { t: 1, x: 0, y: 0, dist: 90, slot: 'key1' as const };
    const b = { t: 2, x: 0, y: 0, dist: 60, slot: 'key2' as const };
    expect(nearestAimPress(null, a)).toBe(a);
    expect(nearestAimPress(a, b)).toBe(b);
    expect(nearestAimPress(b, a)).toBe(b);
  });
});
