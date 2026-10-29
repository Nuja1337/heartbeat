import { describe, expect, it } from 'vitest';
import { CursorBuffer, HoldLog } from '../engine/cursor';
import { decomposeAim, movementMetrics } from './records';

describe('decomposeAim', () => {
  it('gives positive along for overshoot', () => {
    const d = decomposeAim({ x: 110, y: 100 }, { x: 100, y: 100 }, 0);
    expect(d.along).toBeCloseTo(10, 9);
    expect(d.lateral).toBeCloseTo(0, 9);
    expect(decomposeAim({ x: 90, y: 100 }, { x: 100, y: 100 }, 0).along).toBeCloseTo(-10, 9);
  });

  it('gives positive lateral to the right of the movement, with y pointing down', () => {
    // Moving right, the right-hand side is down the screen.
    expect(decomposeAim({ x: 100, y: 110 }, { x: 100, y: 100 }, 0).lateral).toBeCloseTo(10, 9);
    // Moving down, the right-hand side is toward the left of the screen.
    expect(decomposeAim({ x: 90, y: 100 }, { x: 100, y: 100 }, 90).lateral).toBeCloseTo(10, 9);
    expect(decomposeAim({ x: 100, y: 110 }, { x: 100, y: 100 }, 90).along).toBeCloseTo(10, 9);
  });
});

function trace(points: (t: number) => [number, number], from: number, to: number): CursorBuffer {
  const buf = new CursorBuffer(2048);
  for (let t = from; t <= to; t++) {
    const [x, y] = points(t);
    buf.push(t, x, y);
  }
  return buf;
}

const mj = (u: number) => u * u * u * (10 - 15 * u + 6 * u * u);

describe('movementMetrics', () => {
  it('reports a clean straight move', () => {
    const buf = trace((t) => [100 + 300 * mj(Math.min(1, Math.max(0, (t - 1000) / 300))), 100], 900, 1400);
    const m = movementMetrics(buf, 1000, 1330, { x: 400, y: 100 }, 40, 1350);
    expect(m.efficiency!).toBeGreaterThan(0.99);
    expect(m.corrections).toBe(0);
    expect(m.peakSpeed!).toBeGreaterThan(1.5 * 300 / 300 * 0.9);
    // The cursor was inside the target (radius 40) from about 15 ms before 1330, and the object is at 1350.
    expect(m.arriveMs!).toBeLessThan(0);
  });

  it('lowers efficiency for a detour', () => {
    const buf = trace((t) => [100 + 300 * mj((t - 1000) / 400), 100 + 150 * Math.sin(((t - 1000) / 400) * Math.PI)], 900, 1500);
    const m = movementMetrics(buf, 1000, 1400, { x: 400, y: 100 }, 40, 1400);
    expect(m.efficiency!).toBeLessThan(0.95);
  });

  it('counts a second speed peak as a correction', () => {
    const buf = trace((t) => {
      if (t < 1000) return [100, 100];
      if (t < 1300) return [100 + 250 * mj((t - 1000) / 300), 100];
      if (t < 1360) return [350, 100];
      return [350 + 50 * mj(Math.min(1, (t - 1360) / 120)), 100];
    }, 900, 1600);
    const m = movementMetrics(buf, 1000, 1500, { x: 400, y: 100 }, 20, 1500);
    expect(m.corrections!).toBeGreaterThanOrEqual(1);
  });

  it('reports nothing for an empty window', () => {
    const buf = new CursorBuffer(16);
    expect(movementMetrics(buf, 0, 100, { x: 0, y: 0 }, 10, 100).efficiency).toBeNull();
  });
});

describe('CursorBuffer', () => {
  it('interpolates and clamps', () => {
    const b = new CursorBuffer(8);
    b.push(0, 0, 0);
    b.push(10, 100, 50);
    const p = { x: 0, y: 0 };
    expect(b.positionAt(5, p)).toEqual({ x: 50, y: 25 });
    expect(b.positionAt(-5, p)).toEqual({ x: 0, y: 0 });
    expect(b.positionAt(99, p)).toEqual({ x: 100, y: 50 });
  });

  it('drops the oldest samples when full', () => {
    const b = new CursorBuffer(4);
    for (let i = 0; i < 10; i++) b.push(i, i, 0);
    expect(b.size).toBe(4);
    expect(b.tAt(0)).toBe(6);
    expect(b.lowerBound(8)).toBe(2);
    expect(b.positionAt(7.5, { x: 0, y: 0 }).x).toBeCloseTo(7.5, 9);
  });

  it('never goes back in time', () => {
    const b = new CursorBuffer(4);
    b.push(10, 1, 1);
    b.push(5, 2, 2);
    expect(b.tAt(1)).toBe(10);
  });
});

describe('HoldLog', () => {
  it('answers for past times', () => {
    const h = new HoldLog();
    h.set(100, 1);
    h.set(200, 3);
    h.set(300, 0);
    expect(h.maskAt(50)).toBe(0);
    expect(h.heldAt(100)).toBe(true);
    expect(h.maskAt(250)).toBe(3);
    expect(h.heldAt(300)).toBe(false);
  });
});
