import { describe, expect, it } from 'vitest';
import type { ApproachStyle, CircleObject, HitObject, SliderObject } from '../../shared/types';
import {
  approachShape,
  APPROACH,
  followAlpha,
  followReveal,
  followSegment,
  followWanted,
  PULSE_FALLBACK_MS,
  reversePulse,
} from './approach';
import type { ApproachShape, FollowSegment } from './approach';

const shape = (style: ApproachStyle, u: number, r = 50): ApproachShape => approachShape(style, u, r, { size: 0, rot: 0, alpha: 0 });

describe('approach geometry', () => {
  it('ring closes from 2.4r to r', () => {
    expect(shape('ring', 0).size).toBeCloseTo(120);
    expect(shape('ring', 0.5).size).toBeCloseTo(50 * 1.7);
    expect(shape('ring', 1).size).toBeCloseTo(50);
    expect(shape('ring', 1).rot).toBe(0);
  });

  it('ring fades in over the first 30% and tops out at 0.9', () => {
    expect(shape('ring', 0).alpha).toBe(0);
    expect(shape('ring', 0.15).alpha).toBeCloseTo(0.45);
    expect(shape('ring', 0.3).alpha).toBeCloseTo(0.9);
    expect(shape('ring', 1).alpha).toBeCloseTo(0.9);
  });

  it('fill grows a disc of radius r times the progress', () => {
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const s = shape('fill', u, 40);
      expect(s.size).toBeCloseTo(40 * u);
      expect(s.rot).toBe(0);
      expect(s.alpha).toBe(1);
    }
  });

  it('brackets close a square from 2.4r to 1.05r while turning from 45 degrees to 0', () => {
    const a = shape('brackets', 0, 50);
    expect(a.size).toBeCloseTo(120);
    expect(a.rot).toBeCloseTo(Math.PI / 4);
    const b = shape('brackets', 1, 50);
    expect(b.size).toBeCloseTo(52.5);
    expect(b.rot).toBeCloseTo(0);
    const mid = shape('brackets', 0.5, 50);
    expect(mid.size).toBeCloseTo((50 * (2.4 + 1.05)) / 2);
    expect(mid.rot).toBeCloseTo(Math.PI / 8);
  });

  it('clamps the progress for the size and turn, and keeps every number finite', () => {
    for (const style of ['ring', 'fill', 'brackets'] as const) {
      for (const u of [-0.5, 0, 0.5, 1, 1.02, 3]) {
        const s = shape(style, u);
        expect(Number.isFinite(s.size) && Number.isFinite(s.rot) && Number.isFinite(s.alpha), `${style} ${u}`).toBe(true);
        expect(s.alpha).toBeGreaterThanOrEqual(0);
        expect(s.alpha).toBeLessThanOrEqual(1);
      }
      expect(shape(style, 5).size).toBeCloseTo(shape(style, 1).size);
    }
  });

  it('keeps the arm of a bracket shorter than the square', () => {
    expect(APPROACH.bracketArm).toBeLessThan(APPROACH.bracketTo);
  });
});

const circle = (index: number, time: number, x: number, y: number, r = 40): CircleObject => ({
  kind: 'circle',
  index,
  time,
  pos: { x, y },
  radius: r,
  approachMs: 600,
  windows: { crisp: 40, solid: 80, rough: 120, early: 180 },
  group: 0,
  number: 1,
  pattern: 'single' as never,
  intensity: 0,
  set: -1,
});

describe('follow points', () => {
  it('reveal from 20% to 60% of the approach of the later object', () => {
    expect(followReveal(0)).toBe(0);
    expect(followReveal(0.2)).toBe(0);
    expect(followReveal(0.4)).toBeCloseTo(0.5);
    expect(followReveal(0.6)).toBe(1);
    expect(followReveal(1)).toBe(1);
  });

  it('fade out over 150 ms once the earlier object is judged', () => {
    expect(followAlpha(NaN)).toBe(1);
    expect(followAlpha(-20)).toBe(1);
    expect(followAlpha(0)).toBe(1);
    expect(followAlpha(75)).toBeCloseTo(0.5);
    expect(followAlpha(150)).toBe(0);
    expect(followAlpha(400)).toBe(0);
  });

  it('are left out between stream notes closer than 160 ms, and next to spinners', () => {
    const a = circle(0, 1000, 100, 100);
    expect(followWanted(a, circle(1, 1159, 300, 100))).toBe(false);
    expect(followWanted(a, circle(1, 1160, 300, 100))).toBe(true);
    expect(followWanted(a, circle(2, 1500, 300, 100))).toBe(false);
    const spin = { ...circle(1, 2000, 500, 312), kind: 'spinner', endTime: 4000, rotationsRequired: 3 } as unknown as HitObject;
    expect(followWanted(a, spin)).toBe(false);
  });

  it('leave a slider from its tail', () => {
    const slider = {
      ...circle(0, 1000, 100, 100),
      kind: 'slider',
      path: [{ type: 'line', to: { x: 300, y: 100 } }],
      length: 200,
      velocity: 0.5,
      repeats: 0,
      spanMs: 400,
      endTime: 1400,
      tickDistance: 0,
      followRadius: 100,
      shape: 'straight',
    } as unknown as SliderObject;
    const seg: FollowSegment = { x0: 0, y0: 0, x1: 0, y1: 0, length: 0 };
    expect(followSegment(slider, circle(1, 2000, 300, 400), 1, seg)).toBe(true);
    // From the tail at (300, 100) straight down to the circle at (300, 400), edge to edge.
    expect(seg.x0).toBeCloseTo(300);
    expect(seg.y0).toBeCloseTo(140);
    expect(seg.y1).toBeCloseTo(360);
    expect(seg.length).toBeCloseTo(300 - 40 - 40);
  });

  it('grow from the earlier object toward the later one, edge to edge', () => {
    const a = circle(0, 1000, 100, 100, 40);
    const b = circle(1, 2000, 400, 100, 50);
    const seg: FollowSegment = { x0: 0, y0: 0, x1: 0, y1: 0, length: 0 };
    expect(followSegment(a, b, 1, seg)).toBe(true);
    expect(seg.x0).toBeCloseTo(140);
    expect(seg.x1).toBeCloseTo(350);
    expect(seg.length).toBeCloseTo(210);
    expect(followSegment(a, b, 0.5, seg)).toBe(true);
    expect(seg.x0).toBeCloseTo(140);
    expect(seg.x1).toBeCloseTo(140 + 105);
    expect(followSegment(a, b, 0, seg)).toBe(true);
    expect(seg.x1).toBeCloseTo(seg.x0);
  });

  it('have no segment when the two objects overlap', () => {
    const seg: FollowSegment = { x0: 0, y0: 0, x1: 0, y1: 0, length: 0 };
    expect(followSegment(circle(0, 1000, 100, 100), circle(1, 2000, 150, 100), 1, seg)).toBe(false);
  });
});

describe('reversal pulse', () => {
  it('is full on the beat and gone by a third of a beat later', () => {
    expect(reversePulse(1250, 500, 250)).toBeCloseTo(1);
    expect(reversePulse(1250 + 500 / 3, 500, 250)).toBeCloseTo(0);
    expect(reversePulse(1250 + 400, 500, 250)).toBe(0);
    expect(reversePulse(1750, 500, 250)).toBeCloseTo(1);
  });

  it('works for times before the first beat', () => {
    expect(reversePulse(-250, 500, 250)).toBeCloseTo(1);
    expect(reversePulse(0, 500, 250)).toBe(0);
  });

  it('pulses every 400 ms when the beat grid is not known', () => {
    expect(PULSE_FALLBACK_MS).toBe(400);
    expect(reversePulse(0, 500, undefined)).toBeCloseTo(1);
    expect(reversePulse(800, 123, undefined)).toBeCloseTo(1);
    expect(reversePulse(50, 500, undefined)).toBeGreaterThan(0);
    expect(reversePulse(200, 500, undefined)).toBe(0);
  });
});
