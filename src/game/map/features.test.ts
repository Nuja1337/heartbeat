import { describe, expect, it } from 'vitest';
import { makeCircle, makeMap, makeSlider, makeSpinner } from '../testing/fixtures';
import { computeFeatures } from './features';

describe('features', () => {
  it('has no distance for the first object', () => {
    const f = computeFeatures(makeMap([makeCircle(0, 1000, 100, 100)]));
    expect(f[0]!.distance).toBeNull();
    expect(f[0]!.gapMs).toBeNull();
    expect(f[0]!.velocity).toBeNull();
    expect(f[0]!.turnAngle).toBeNull();
  });

  it('measures distance, gap, velocity and spacing', () => {
    const f = computeFeatures(makeMap([makeCircle(0, 1000, 100, 100), makeCircle(1, 1200, 400, 500, 50)]));
    expect(f[1]!.distance).toBeCloseTo(500, 9);
    expect(f[1]!.gapMs).toBe(200);
    expect(f[1]!.velocity).toBeCloseTo(2.5, 9);
    expect(f[1]!.spacing).toBeCloseTo(5, 9);
  });

  it('gives direction in degrees with 0 as right and 90 as down', () => {
    const f = computeFeatures(
      makeMap([makeCircle(0, 1000, 100, 100), makeCircle(1, 1300, 300, 100), makeCircle(2, 1600, 300, 300), makeCircle(3, 1900, 100, 300)]),
    );
    expect(f[1]!.direction).toBeCloseTo(0, 6);
    expect(f[2]!.direction).toBeCloseTo(90, 6);
    expect(f[3]!.direction).toBeCloseTo(180, 6);
  });

  it('gives turn 0 for a straight line and 180 for a reversal', () => {
    const f = computeFeatures(
      makeMap([makeCircle(0, 1000, 100, 300), makeCircle(1, 1300, 300, 300), makeCircle(2, 1600, 500, 300), makeCircle(3, 1900, 100, 300)]),
    );
    expect(f[2]!.turnAngle).toBeCloseTo(0, 6);
    expect(f[3]!.turnAngle).toBeCloseTo(180, 6);
  });

  it('gives a right-angle turn', () => {
    const f = computeFeatures(makeMap([makeCircle(0, 1000, 100, 100), makeCircle(1, 1300, 300, 100), makeCircle(2, 1600, 300, 300)]));
    expect(f[2]!.turnAngle).toBeCloseTo(90, 6);
  });

  it('skips direction and turn for very short moves', () => {
    const f = computeFeatures(makeMap([makeCircle(0, 1000, 100, 100), makeCircle(1, 1300, 110, 100), makeCircle(2, 1600, 400, 100)]));
    expect(f[1]!.direction).toBeNull();
    expect(f[2]!.turnAngle).toBeNull();
  });

  it('measures the turn after a slider from the way it leaves', () => {
    // The head is reached moving down, the slider runs right, and the next target is further right.
    const slider = makeSlider(1, 2000, { x: 100, y: 300 }, [{ type: 'line', to: { x: 300, y: 300 } }], { spanMs: 400 });
    const f = computeFeatures(makeMap([makeCircle(0, 1000, 100, 100), slider, makeCircle(2, 3000, 500, 300)]));
    expect(f[1]!.direction).toBeCloseTo(90, 6);
    expect(f[2]!.turnAngle).toBeCloseTo(0, 6);
  });

  it('turns the exit around when a slider ends on a reversal', () => {
    const slider = makeSlider(1, 2000, { x: 300, y: 300 }, [{ type: 'line', to: { x: 500, y: 300 } }], { spanMs: 400, repeats: 1 });
    // It ends back at its head, leaving to the left. The next target is straight on from there.
    const f = computeFeatures(makeMap([makeCircle(0, 1000, 300, 100), slider, makeCircle(2, 3500, 100, 300)]));
    expect(f[2]!.direction).toBeCloseTo(180, 6);
    expect(f[2]!.turnAngle).toBeCloseTo(0, 6);
  });

  it('numbers a run of equal short gaps', () => {
    const objs = [makeCircle(0, 1000, 100, 100), makeCircle(1, 2000, 300, 300)];
    for (let i = 0; i < 5; i++) objs.push(makeCircle(2 + i, 2400 + i * 80, 320 + i * 25, 300));
    objs.push(makeCircle(7, 3200, 600, 100));
    const f = computeFeatures(makeMap(objs));
    expect(f[0]!.runLength).toBe(0);
    // The run starts at the object before the first short gap.
    expect(f[1]!.runLength).toBe(0);
    expect(f[2]!.runIndex).toBe(1);
    expect(f[2]!.runLength).toBe(5);
    expect(f[6]!.runIndex).toBe(5);
    expect(f[7]!.runLength).toBe(0);
  });

  it('does not call two short gaps of different length a run', () => {
    const f = computeFeatures(makeMap([makeCircle(0, 1000, 100, 100), makeCircle(1, 1080, 200, 100), makeCircle(2, 1240, 300, 100)]));
    expect(f[1]!.runLength).toBe(0);
  });

  it('counts the objects visible at each time', () => {
    const f = computeFeatures(
      makeMap([makeCircle(0, 1000, 100, 100), makeCircle(1, 1300, 300, 100), makeCircle(2, 1600, 500, 100), makeCircle(3, 5000, 100, 300)]),
    );
    // Approach is 800, so object 1 appears at 500 and object 2 at 800, both before time 1000.
    expect(f[0]!.visibleCount).toBe(3);
    expect(f[1]!.visibleCount).toBe(2);
    expect(f[3]!.visibleCount).toBe(1);
  });

  it('measures from a slider tail, and gives no distance after a spinner', () => {
    const slider = makeSlider(0, 1000, { x: 100, y: 100 }, [{ type: 'line', to: { x: 300, y: 100 } }], { spanMs: 400 });
    const spinner = makeSpinner(2, 3000, 2000, 5);
    const f = computeFeatures(makeMap([slider, makeCircle(1, 2000, 300, 300), spinner, makeCircle(3, 7000, 100, 100)]));
    expect(f[1]!.distance).toBeCloseTo(200, 6);
    expect(f[3]!.distance).toBeNull();
    expect(f[3]!.gapMs).toBe(2000);
  });

  it('gives progress as time over duration', () => {
    const f = computeFeatures(makeMap([makeCircle(0, 1000, 100, 100), makeCircle(1, 4000, 300, 100)], { durationMs: 5000 }));
    expect(f[0]!.progress).toBeCloseTo(0.2, 9);
    expect(f[1]!.progress).toBeCloseTo(0.8, 9);
  });
});
