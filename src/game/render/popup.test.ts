import { describe, expect, it, vi } from 'vitest';
import { boxesIntersect, LABEL_DY, MISS_X, newLayout, POP_BOX, popupLayout, popupScale, TextWidths } from './popup';

describe('pop-up layout', () => {
  it('puts the label at 1.35r above the target centre', () => {
    expect(popupLayout(40, 38, 0).label.cy).toBeCloseTo(-54);
    expect(LABEL_DY).toBe(1.35);
  });

  it('never lets the Miss label touch its X, for r from 16 to 80', () => {
    const out = newLayout();
    for (let r = 16; r <= 80; r += 0.5) {
      // A label wider than any of the words, to be safe.
      const l = popupLayout(r, 60, 0, out);
      expect(boxesIntersect(l.label, l.missX), `r = ${r}`).toBe(false);
      // The label is above the X, with room between them.
      expect(l.label.cy + l.label.h / 2, `r = ${r}`).toBeLessThan(l.missX.cy - l.missX.h / 2);
    }
  });

  it('keeps the gap when the label is at its smallest scale', () => {
    for (let r = 16; r <= 80; r += 4) {
      const l = popupLayout(r, 40, 0);
      const bottom = l.label.cy + (l.label.h / 2) * 0.85;
      expect(bottom).toBeLessThan(l.missX.cy - l.missX.h / 2);
    }
  });

  it('would fail for the old 0.2r placement, so the test can catch that bug', () => {
    const old = popupLayout(16, 40, 0);
    old.label.cy = -0.2 * 16;
    expect(boxesIntersect(old.label, old.missX)).toBe(true);
  });

  it('sizes the X box from 0.5r and its 3-unit stroke', () => {
    const l = popupLayout(50, 40, 0);
    expect(l.missX.w).toBeCloseTo(2 * MISS_X.half * 50 + MISS_X.stroke);
    expect(MISS_X.half).toBe(0.5);
    expect(MISS_X.stroke).toBe(3);
  });

  it('puts the early or late text under the label', () => {
    const l = popupLayout(50, 40, 70);
    expect(l.sub.cy).toBeGreaterThan(l.label.cy);
    expect(boxesIntersect(l.sub, l.label)).toBe(false);
    expect(l.sub.w).toBe(70);
    expect(POP_BOX.subDy).toBeGreaterThan(0);
  });

  it('scales from 0.85 to 1 over 90 ms', () => {
    expect(popupScale(0)).toBeCloseTo(0.85);
    expect(popupScale(45)).toBeCloseTo(0.925);
    expect(popupScale(90)).toBe(1);
    expect(popupScale(400)).toBe(1);
    expect(popupScale(-5)).toBeCloseTo(0.85);
  });
});

describe('boxesIntersect', () => {
  it('is true for overlap, false for touching and for apart', () => {
    const a = { cx: 0, cy: 0, w: 10, h: 10 };
    expect(boxesIntersect(a, { cx: 4, cy: 4, w: 10, h: 10 })).toBe(true);
    expect(boxesIntersect(a, { cx: 10, cy: 0, w: 10, h: 10 })).toBe(false);
    expect(boxesIntersect(a, { cx: 0, cy: 30, w: 10, h: 10 })).toBe(false);
  });
});

describe('TextWidths', () => {
  it('measures a string once per font', () => {
    const measure = vi.fn((text: string) => ({ width: text.length * 7 }));
    const ctx = { font: '', measureText: measure } as unknown as CanvasRenderingContext2D;
    const w = new TextWidths();
    expect(w.width(ctx, '16px a', 'Solid')).toBe(35);
    expect(w.width(ctx, '16px a', 'Solid')).toBe(35);
    expect(w.width(ctx, '16px a', 'Miss')).toBe(28);
    expect(w.width(ctx, '12px a', 'Solid')).toBe(35);
    expect(measure).toHaveBeenCalledTimes(3);
  });
});
