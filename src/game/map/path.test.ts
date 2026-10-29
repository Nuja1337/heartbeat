import { describe, expect, it } from 'vitest';
import type { PathSegment, Vec2 } from '../../shared/types';
import { arcThrough, cubicPoint, flattenPath, pathLength, pointAt, samplePath, selfIntersects, tangentAt } from './path';

describe('path', () => {
  it('measures a line', () => {
    expect(pathLength({ x: 0, y: 0 }, [{ type: 'line', to: { x: 3, y: 4 } }])).toBeCloseTo(5, 9);
  });

  it('chains line pieces', () => {
    const fp = flattenPath({ x: 0, y: 0 }, [
      { type: 'line', to: { x: 10, y: 0 } },
      { type: 'line', to: { x: 10, y: 20 } },
    ]);
    expect(fp.length).toBeCloseTo(30, 9);
  });

  it('finds the circle through three points', () => {
    const arc = arcThrough({ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 });
    expect(arc).not.toBeNull();
    expect(arc!.cx).toBeCloseTo(0, 9);
    expect(arc!.cy).toBeCloseTo(0, 9);
    expect(arc!.radius).toBeCloseTo(1, 9);
    expect(Math.abs(arc!.sweep)).toBeCloseTo(Math.PI, 9);
  });

  it('measures an arc by its radius', () => {
    const len = pathLength({ x: 100, y: 0 }, [{ type: 'arc', through: { x: 0, y: 100 }, to: { x: -100, y: 0 } }]);
    expect(Math.abs(len - Math.PI * 100)).toBeLessThan(Math.PI * 100 * 0.002);
  });

  it('takes the long way when the middle point is on it', () => {
    const arc = arcThrough({ x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 });
    expect(arc!.sweep).toBeLessThan(0);
    expect(Math.abs(arc!.sweep)).toBeCloseTo(Math.PI, 9);
  });

  it('falls back to a line for collinear points', () => {
    expect(arcThrough({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 })).toBeNull();
    const len = pathLength({ x: 0, y: 0 }, [{ type: 'arc', through: { x: 5, y: 0 }, to: { x: 10, y: 0 } }]);
    expect(len).toBeCloseTo(10, 9);
  });

  it('matches a brute force cubic length within 0.5%', () => {
    const p0 = { x: 50, y: 60 };
    const seg: PathSegment = { type: 'cubic', c1: { x: 300, y: -40 }, c2: { x: -100, y: 380 }, to: { x: 420, y: 300 } };
    const len = pathLength(p0, [seg]);
    let brute = 0;
    let prev: Vec2 = p0;
    const q = { x: 0, y: 0 };
    for (let i = 1; i <= 10000; i++) {
      cubicPoint(p0, seg.c1, seg.c2, seg.to, i / 10000, q);
      brute += Math.hypot(q.x - prev.x, q.y - prev.y);
      prev = { x: q.x, y: q.y };
    }
    expect(Math.abs(len - brute) / brute).toBeLessThan(0.005);
  });

  it('moves forward monotonically with pointAt', () => {
    const fp = flattenPath({ x: 0, y: 0 }, [{ type: 'cubic', c1: { x: 200, y: 0 }, c2: { x: 0, y: 200 }, to: { x: 200, y: 200 } }]);
    const p = { x: 0, y: 0 };
    let travelled = 0;
    let last = { x: 0, y: 0 };
    for (let i = 0; i <= 200; i++) {
      pointAt(fp, (fp.length * i) / 200, p);
      const step = Math.hypot(p.x - last.x, p.y - last.y);
      expect(step).toBeGreaterThanOrEqual(0);
      travelled += step;
      last = { x: p.x, y: p.y };
    }
    expect(travelled).toBeCloseTo(fp.length, 0);
  });

  it('clamps pointAt to the ends', () => {
    const fp = flattenPath({ x: 0, y: 0 }, [{ type: 'line', to: { x: 10, y: 0 } }]);
    const p = { x: 0, y: 0 };
    expect(pointAt(fp, -5, p).x).toBe(0);
    expect(pointAt(fp, 99, p).x).toBe(10);
  });

  it('gives the direction of travel', () => {
    const fp = flattenPath({ x: 0, y: 0 }, [{ type: 'line', to: { x: 0, y: 10 } }]);
    const t = tangentAt(fp, 3, { x: 0, y: 0 });
    expect(t.x).toBeCloseTo(0, 9);
    expect(t.y).toBeCloseTo(1, 9);
  });

  it('samples at no more than the step', () => {
    const fp = flattenPath({ x: 0, y: 0 }, [{ type: 'line', to: { x: 100, y: 0 } }]);
    expect(samplePath(fp, 20).length / 2).toBeGreaterThanOrEqual(6);
  });

  it('detects a crossing path', () => {
    const cross = flattenPath({ x: 0, y: 0 }, [
      { type: 'line', to: { x: 10, y: 10 } },
      { type: 'line', to: { x: 10, y: 0 } },
      { type: 'line', to: { x: 0, y: 10 } },
    ]);
    expect(selfIntersects(cross)).toBe(true);
    const fine = flattenPath({ x: 0, y: 0 }, [{ type: 'arc', through: { x: 50, y: 20 }, to: { x: 100, y: 0 } }]);
    expect(selfIntersects(fine)).toBe(false);
  });
});
