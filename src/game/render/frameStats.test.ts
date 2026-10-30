import { describe, expect, it } from 'vitest';
import { FrameStats, GRAPH_FRAMES, MAX_FRAME_MS } from './frameStats';

describe('FrameStats', () => {
  it('has no p99 until it has enough frames', () => {
    const f = new FrameStats();
    for (let i = 0; i < 29; i++) f.push(4.2);
    expect(f.p99()).toBeNull();
    f.push(4.2);
    expect(f.p99()).not.toBeNull();
  });

  it('finds the 99th percentile within 0.1 ms', () => {
    const f = new FrameStats();
    // 990 frames at 4.2 ms and 10 slow ones: the 99th percentile is the last of the fast ones.
    for (let i = 0; i < 990; i++) f.push(4.2);
    for (let i = 0; i < 10; i++) f.push(9.7);
    expect(f.p99()).toBeCloseTo(4.3, 5);
    // One more slow frame pushes it into the slow group, and the answer is then the slowest frame.
    f.push(9.7);
    expect(f.p99()).toBeCloseTo(9.7, 5);
  });

  it('never reports more than the slowest frame', () => {
    const f = new FrameStats();
    for (let i = 0; i < 100; i++) f.push(4.17);
    expect(f.p99()).toBeCloseTo(4.17, 5);
  });

  it('ignores zero, negative and very long gaps', () => {
    const f = new FrameStats();
    f.push(0);
    f.push(-3);
    f.push(NaN);
    f.push(MAX_FRAME_MS + 1);
    expect(f.count).toBe(0);
    f.push(MAX_FRAME_MS);
    expect(f.count).toBe(1);
  });

  it('keeps the last 120 frames for the graph, oldest first', () => {
    const f = new FrameStats();
    for (let i = 1; i <= 150; i++) f.push(i / 10);
    expect(f.shown).toBe(GRAPH_FRAMES);
    expect(f.recentAt(0)).toBeCloseTo(3.1);
    expect(f.recentAt(GRAPH_FRAMES - 1)).toBeCloseTo(15);
    const g = new FrameStats();
    g.push(1);
    g.push(2);
    expect(g.shown).toBe(2);
    expect(g.recentAt(0)).toBe(1);
    expect(g.recentAt(1)).toBe(2);
  });

  it('starts over on reset', () => {
    const f = new FrameStats();
    for (let i = 0; i < 100; i++) f.push(5);
    f.reset();
    expect(f.count).toBe(0);
    expect(f.shown).toBe(0);
    expect(f.p99()).toBeNull();
  });
});
