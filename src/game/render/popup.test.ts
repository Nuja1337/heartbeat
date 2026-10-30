import { describe, expect, it, vi } from 'vitest';
import { PLAYFIELD } from '../../shared/catalog';
import { boxesIntersect, FIELD_MARGIN, labelBelow, LABEL_DY, MISS_X, newLayout, POP_BOX, popupLayout, popupScale, TextWidths } from './popup';
import { FX } from './theme';

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

describe('pop-up near the edges of the field', () => {
  /** The label and the early or late line of a pop-up on a target at (r, y), as absolute vertical extents. */
  function extents(r: number, y: number, hasSub: boolean) {
    const l = popupLayout(r, 60, hasSub ? 70 : 0, newLayout(), y);
    const top = y + l.label.cy - l.label.h / 2;
    const bottom = hasSub ? y + l.sub.cy + l.sub.h / 2 : y + l.label.cy + l.label.h / 2;
    return { l, top, bottom };
  }

  it('keeps the label and the early or late line inside the field for targets at the top edge', () => {
    for (let r = 16; r <= 80; r += 2) {
      for (const y of [0, 5, 20, r, r + 10, 60, 100, 150, 200]) {
        for (const hasSub of [false, true]) {
          const { top, bottom } = extents(r, y, hasSub);
          // With the rise of the pop-up, the top stays under the field edge.
          expect(top - FX.popupRise, `r ${r} y ${y}`).toBeGreaterThanOrEqual(0);
          expect(bottom + FX.popupRise, `r ${r} y ${y}`).toBeLessThanOrEqual(PLAYFIELD.height);
        }
      }
    }
  });

  it('puts the label below the target when it does not fit above, clear of the miss X', () => {
    const r = 40;
    const { l } = extents(r, 30, true);
    expect(l.label.cy).toBeCloseTo(LABEL_DY * r);
    expect(boxesIntersect(l.label, l.missX)).toBe(false);
    expect(boxesIntersect(l.sub, l.missX)).toBe(false);
    expect(l.label.cy - l.label.h / 2).toBeGreaterThan(l.missX.cy + l.missX.h / 2);
    for (let rr = 16; rr <= 80; rr += 4) {
      const e = extents(rr, 0, false).l;
      expect(boxesIntersect(e.label, e.missX), `r ${rr}`).toBe(false);
    }
  });

  it('keeps the label above the target when it fits', () => {
    expect(labelBelow(300, 40)).toBe(false);
    expect(popupLayout(40, 38, 0, newLayout(), 300).label.cy).toBeCloseTo(-LABEL_DY * 40);
    // The old layout, without a height, is unchanged.
    expect(popupLayout(40, 38, 0).label.cy).toBeCloseTo(-54);
  });

  it('flips at the height where the label would touch the top margin', () => {
    const r = 40;
    const edge = LABEL_DY * r + FX.popupRise + POP_BOX.labelH / 2 + FIELD_MARGIN;
    expect(labelBelow(edge - 0.01, r)).toBe(true);
    expect(labelBelow(edge + 0.01, r)).toBe(false);
  });

  it('stays inside the field for every target the generator can place, top to bottom', () => {
    for (let r = 16; r <= 80; r += 8) {
      for (let y = r; y <= PLAYFIELD.height - r; y += 5) {
        const { top, bottom } = extents(r, y, true);
        expect(top - FX.popupRise, `r ${r} y ${y}`).toBeGreaterThanOrEqual(0);
        expect(bottom + FX.popupRise, `r ${r} y ${y}`).toBeLessThanOrEqual(PLAYFIELD.height);
      }
    }
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
