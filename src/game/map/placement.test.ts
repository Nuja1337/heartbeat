import { describe, expect, it } from 'vitest';
import { windowsForTiming } from '../../shared/catalog';
import { Layout } from './placement';
import type { BuilderConfig } from './placement';

const cfg: BuilderConfig = {
  radius: 40,
  approachMs: 500,
  windows: windowsForTiming(5),
  beatMs: 500,
  sliderVelocity: 0.3,
  tickDistance: 100,
  jumpMinRadii: 2.25,
  minGapMs: 100,
  set: -1,
};

const line = (x0: number, x1: number, y: number) => {
  const pts: number[] = [];
  for (let x = x0; x <= x1; x += 10) pts.push(x, y);
  return new Float64Array(pts);
};

describe('Layout.okSlider', () => {
  it('checks the object just before even when it ended long ago', () => {
    const layout = new Layout(cfg);
    layout.add({ x: 300, y: 300, time: 1000, end: 1400, group: 0, seq: 0, stream: false, pts: line(300, 700, 300) });
    // Ten seconds later, a slider that runs through the old one.
    const crossing = line(400, 600, 310);
    expect(layout.okSlider(crossing, 11000, { n: 0, xs: new Float64Array(0), ys: new Float64Array(0), cum: new Float64Array(0), length: 0 })).toBe(false);
    const clear = line(400, 600, 500);
    expect(layout.okSlider(clear, 11000, { n: 0, xs: new Float64Array(0), ys: new Float64Array(0), cum: new Float64Array(0), length: 0 })).toBe(true);
  });

  it('still lets an older object go once it is out of sight', () => {
    const layout = new Layout(cfg);
    layout.add({ x: 300, y: 300, time: 1000, end: 1000, group: 0, seq: 0, stream: false, pts: null });
    layout.add({ x: 900, y: 500, time: 1100, end: 1100, group: 1, seq: 0, stream: false, pts: null });
    const empty = { n: 0, xs: new Float64Array(0), ys: new Float64Array(0), cum: new Float64Array(0), length: 0 };
    expect(layout.okSlider(line(250, 350, 300), 20000, empty)).toBe(true);
  });
});
