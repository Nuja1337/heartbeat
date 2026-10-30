import { describe, expect, it } from 'vitest';
import { windowsForTiming } from '../../shared/catalog';
import { Layout, MapBuilder, mirrorPoint } from './placement';
import { createRng } from './rng';
import type { BuilderConfig, Motif } from './placement';

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

describe('MapBuilder stacks, mirrors and snapshots', () => {
  const builder = () => new MapBuilder({ ...cfg, originMs: 0, minGapMs: 100 }, createRng(1));
  const stackMotif: Motif = {
    tag: 'stack',
    steps: [
      { off: 0, dist: 300, turn: 0, tag: 'stack' },
      { off: 0.25, dist: 0, turn: 0, stack: true, tag: 'stack' },
      { off: 0.5, dist: 0, turn: 0, stack: true, tag: 'stack' },
      { off: 1, dist: 300, turn: 40, tag: 'jump' },
    ],
    beats: 2,
    minDist: 90,
  };

  it('puts stack notes on one spot and keeps the next object 2.2 radii away', () => {
    const b = builder();
    b.addMotif({ tag: 'jump', steps: [{ off: 0, dist: 0, turn: 0 }], beats: 1 }, 1000);
    const res = b.addMotif(stackMotif, 3000);
    expect(res.ok).toBe(true);
    const [a, s1, s2, j] = b.objects.slice(1);
    expect(s1!.pos).toEqual(a!.pos);
    expect(s2!.pos).toEqual(a!.pos);
    expect(Math.hypot(j!.pos.x - a!.pos.x, j!.pos.y - a!.pos.y)).toBeGreaterThanOrEqual(2.2 * 40);
  });

  it('replays a motif mirrored, all or nothing', () => {
    const b = builder();
    const first = b.addMotif({ tag: 'jump', steps: [0, 1, 2, 3].map((k) => ({ off: k, dist: 200, turn: k === 0 ? 0 : 50 })), beats: 4 }, 1000);
    expect(first.ok).toBe(true);
    const copy = b.addMotif(first.info!.motif, 1000 + 8 * 500, { mirror: { source: first.info!, axis: 'v' } });
    expect(copy.ok).toBe(true);
    first.info!.objects.forEach((o, i) => {
      const m = copy.info!.objects[i]!;
      expect(m.pos).toEqual(mirrorPoint(o.pos, 'v'));
      expect(m.time - o.time).toBeCloseTo(4000, 5);
    });
    // Too close to what is still on screen: nothing stays behind.
    const n = b.objects.length;
    const bad = b.addMotif(first.info!.motif, 1000 + 8 * 500 + 100, { mirror: { source: first.info!, axis: 'v' } });
    expect(bad.ok).toBe(false);
    expect(b.objects).toHaveLength(n);
  });

  it('restores a snapshot', () => {
    const b = builder();
    b.addMotif({ tag: 'jump', steps: [{ off: 0, dist: 0, turn: 0 }], beats: 1 }, 1000);
    const snap = b.snapshot();
    b.addMotif({ tag: 'jump', steps: [{ off: 0, dist: 200, turn: 0 }, { off: 1, dist: 200, turn: 90 }], beats: 2 }, 3000);
    expect(b.objects).toHaveLength(3);
    b.restore(snap);
    expect(b.objects).toHaveLength(1);
    expect(b.layout.items).toHaveLength(1);
    expect(b.lastEnd).toBe(1000);
  });

  it('caps a jump at 1.6 times the one before at the same gap, except on a downbeat', () => {
    const b = builder();
    b.addMotif({ tag: 'jump', steps: [{ off: 0, dist: 0, turn: 0 }, { off: 1, dist: 200, turn: 0 }], beats: 2 }, 500 * 1);
    // Beat 2 off the downbeat: asked for 600, held to 1.55 x 200.
    const r = b.addMotif({ tag: 'jump', steps: [{ off: 2, dist: 600, turn: 20 }], beats: 1 }, 500);
    expect(r.ok).toBe(true);
    const [, p, q] = b.objects;
    expect(Math.hypot(q!.pos.x - p!.pos.x, q!.pos.y - p!.pos.y)).toBeLessThanOrEqual(1.6 * 200 + 1);
  });
});
