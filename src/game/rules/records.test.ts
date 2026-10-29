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

  it('reports nothing when the buffer no longer reaches back to the window', () => {
    const buf = new CursorBuffer(64);
    for (let t = 0; t <= 200; t++) buf.push(t, 100 + t, 100);
    const m = movementMetrics(buf, 10, 190, { x: 290, y: 100 }, 40, 190);
    expect(m).toEqual({
      arriveMs: null, efficiency: null, corrections: null, peakSpeed: null,
      leaveMs: null, primaryAlong: null, primaryLateral: null, primaryEndMs: null, correctionPath: null,
    });
    // A window inside what was kept still works.
    expect(movementMetrics(buf, 160, 190, { x: 290, y: 100 }, 40, 190).efficiency).not.toBeNull();
  });

  it('reports nothing for an empty window', () => {
    const buf = new CursorBuffer(16);
    expect(movementMetrics(buf, 0, 100, { x: 0, y: 0 }, 10, 100).efficiency).toBeNull();
  });
});

describe('movement metrics from 2.0', () => {
  const R = 40;
  const TARGET = { x: 400, y: 100 };
  const NULLS = { leaveMs: null, primaryAlong: null, primaryLateral: null, primaryEndMs: null, correctionPath: null };

  /** The cursor sits at 100,100 until `start`, then moves along x in the given steps. */
  function path(start: number, steps: { span: number; to: number; y?: number }[], hold: number, tail = 100) {
    const buf = new CursorBuffer(4096);
    let x0 = 100;
    let y0 = 100;
    let t0 = start;
    const legs = steps.map((st) => {
      const leg = { t0, t1: t0 + st.span, x0, x1: st.to, y0, y1: st.y ?? y0 };
      t0 += st.span;
      x0 = st.to;
      y0 = st.y ?? y0;
      return leg;
    });
    const end = t0 + hold;
    for (let t = start - 100; t <= end + tail; t++) {
      let x = 100;
      let y = 100;
      for (const l of legs) {
        if (t >= l.t1) {
          x = l.x1;
          y = l.y1;
        } else if (t >= l.t0) {
          const k = mj((t - l.t0) / (l.t1 - l.t0));
          x = l.x0 + (l.x1 - l.x0) * k;
          y = l.y0 + (l.y1 - l.y0) * k;
          break;
        }
      }
      buf.push(t, x, y);
    }
    return { buf, end };
  }

  it('fixture 1: one clean move ends at the target with nothing to correct', () => {
    const { buf, end } = path(1000, [{ span: 300, to: 400 }], 30);
    const m = movementMetrics(buf, 1000, end, TARGET, R, end, 0);
    expect(Math.abs(m.primaryAlong!)).toBeLessThanOrEqual(0.05 * R);
    expect(Math.abs(m.primaryLateral!)).toBeLessThanOrEqual(0.05 * R);
    expect(m.correctionPath!).toBeLessThanOrEqual(0.05 * R);
    expect(m.primaryEndMs!).toBeLessThanOrEqual(0);
  });

  it('fixture 2: a move that stops at 70% and then corrects', () => {
    // 300 units away. The first motion stops at 310, 90 units short.
    const { buf, end } = path(1000, [{ span: 300, to: 310 }, { span: 60, to: 310 }, { span: 250, to: 400 }], 20);
    const m = movementMetrics(buf, 1000, end, TARGET, R, end, 0);
    const d = 300;
    expect(m.primaryAlong!).toBeGreaterThan(-0.3 * d * 1.05);
    expect(m.primaryAlong!).toBeLessThan(-0.3 * d * 0.95);
    expect(m.correctionPath!).toBeGreaterThan(0.3 * d * 0.95);
    expect(m.correctionPath!).toBeLessThan(0.3 * d * 1.05);
    expect(Math.abs(m.primaryLateral!)).toBeLessThan(1);
    // The first motion ended about when its 300 ms were up.
    expect(m.primaryEndMs!).toBeLessThan(-160);
  });

  it('fixture 3: an 80 ms delayed start gives a leave time of 80 ms, give or take one speed window', () => {
    const { buf, end } = path(1080, [{ span: 100, to: 400 }], 60);
    const m = movementMetrics(buf, 1000, end, TARGET, R, end, 0);
    expect(m.leaveMs!).toBeGreaterThanOrEqual(72);
    expect(m.leaveMs!).toBeLessThanOrEqual(88);
  });

  it('leaves at once when the cursor is already moving', () => {
    const { buf, end } = path(1000, [{ span: 100, to: 400 }], 60);
    const m = movementMetrics(buf, 1000, end, TARGET, R, end, 0);
    expect(m.leaveMs!).toBeLessThanOrEqual(8);
  });

  it('ignores motion away from the target when it looks for the start', () => {
    // The cursor drifts left first, then goes for the target at 1200.
    const buf = new CursorBuffer(4096);
    for (let t = 900; t <= 1700; t++) {
      let x = 100;
      if (t >= 1000 && t < 1200) x = 100 - 40 * mj((t - 1000) / 200);
      else if (t >= 1200) x = 60 + 340 * mj(Math.min(1, (t - 1200) / 250));
      buf.push(t, x, 100);
    }
    const m = movementMetrics(buf, 1000, 1500, TARGET, R, 1500, 0);
    // The drift is slower than 10% of the peak speed only at its ends; the pull to the right starts near 1200.
    expect(m.leaveMs!).toBeGreaterThan(150);
  });

  it('gives a positive lateral when the first motion ends right of the path', () => {
    // Moving right (0 degrees), so down the screen is the right-hand side.
    const { buf, end } = path(1000, [{ span: 300, to: 400, y: 130 }, { span: 100, to: 400, y: 100 }], 20);
    const m = movementMetrics(buf, 1000, end, TARGET, R, end, 0);
    expect(m.primaryLateral!).toBeGreaterThan(15);
  });

  it('keeps along and lateral null without a direction, and the rest of the metrics', () => {
    const { buf, end } = path(1000, [{ span: 300, to: 310 }, { span: 60, to: 310 }, { span: 250, to: 400 }], 20);
    const m = movementMetrics(buf, 1000, end, TARGET, R, end, null);
    expect(m.primaryAlong).toBeNull();
    expect(m.primaryLateral).toBeNull();
    expect(m.leaveMs).not.toBeNull();
    expect(m.primaryEndMs).not.toBeNull();
    expect(m.correctionPath).not.toBeNull();
  });

  it('is null when the peak speed is under 0.05 units per ms', () => {
    // 4 units over 200 ms: a peak near 0.04.
    const buf = new CursorBuffer(1024);
    for (let t = 0; t <= 400; t++) buf.push(t, 100 + 4 * mj(Math.min(1, t / 200)), 100);
    const m = movementMetrics(buf, 0, 300, TARGET, R, 300, 0);
    expect(m.peakSpeed!).toBeLessThan(0.05);
    expect(m).toMatchObject(NULLS);
  });

  it('is null with fewer than 3 speed samples', () => {
    const buf = new CursorBuffer(64);
    for (let t = 0; t <= 30; t++) buf.push(t, 100 + 10 * t, 100);
    const m = movementMetrics(buf, 0, 20, TARGET, R, 20, 0);
    expect(m.peakSpeed).not.toBeNull();
    expect(m).toMatchObject(NULLS);
  });

  it('is null when there was no movement at all', () => {
    const buf = new CursorBuffer(64);
    for (let t = 0; t <= 100; t++) buf.push(t, 100, 100);
    expect(movementMetrics(buf, 0, 100, TARGET, R, 100, 0)).toMatchObject(NULLS);
  });

  it('ends the first motion at the press when the speed never dips and rises', () => {
    // Still speeding up at the press.
    const buf = new CursorBuffer(1024);
    for (let t = 0; t <= 200; t++) buf.push(t, 100 + 0.002 * t * t, 100);
    const m = movementMetrics(buf, 0, 200, TARGET, R, 200, 0);
    expect(m.primaryEndMs).toBe(0);
    expect(m.correctionPath).toBeCloseTo(0, 6);
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
