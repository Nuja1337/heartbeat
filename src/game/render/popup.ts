// Where a judgment pop-up goes, and a cache for the widths of the text in it (PLAN-2 5.4). Pure apart from the
// measuring call, which takes the context it is given.

import { FONT, FX } from './theme';

export const F_POP = `700 16px ${FONT}`;
export const F_POP_SUB = `500 11px ${FONT}`;
export const F_BONUS = `700 22px ${FONT}`;

/** Sizes of the pop-up text boxes, in playfield units. */
export const POP_BOX = { labelH: 18, subH: 13, subDy: 16 } as const;

/** The miss mark: an X at the centre of the target, half 0.5r wide, drawn with a 3-unit stroke. */
export const MISS_X = { half: 0.5, stroke: 3, rotFrom: (20 * Math.PI) / 180 } as const;

/** The label sits this many radii above the centre of its target. The old 0.2r put it on top of the miss mark. */
export const LABEL_DY = 1.35;

export interface Box {
  /** Centre, relative to the target centre. */
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface PopupLayout {
  label: Box;
  sub: Box;
  missX: Box;
}

export function newLayout(): PopupLayout {
  const b = (): Box => ({ cx: 0, cy: 0, w: 0, h: 0 });
  return { label: b(), sub: b(), missX: b() };
}

/**
 * The boxes of a pop-up for a target of radius `r`, at the start of its life (no rise yet), relative to the target
 * centre. The label is at -1.35r and the early or late text is under it. The miss mark is a square around the centre.
 */
export function popupLayout(r: number, labelW: number, subW: number, out: PopupLayout = newLayout()): PopupLayout {
  out.label.cx = 0;
  out.label.cy = -LABEL_DY * r;
  out.label.w = labelW;
  out.label.h = POP_BOX.labelH;
  out.sub.cx = 0;
  out.sub.cy = out.label.cy + POP_BOX.subDy;
  out.sub.w = subW;
  out.sub.h = POP_BOX.subH;
  const x = 2 * MISS_X.half * r + MISS_X.stroke;
  out.missX.cx = 0;
  out.missX.cy = 0;
  out.missX.w = x;
  out.missX.h = x;
  return out;
}

/** True when the two boxes share any area. */
export function boxesIntersect(a: Box, b: Box): boolean {
  return Math.abs(a.cx - b.cx) * 2 < a.w + b.w && Math.abs(a.cy - b.cy) * 2 < a.h + b.h;
}

/** Scale of a pop-up `age` ms after it appeared: 0.85 to 1 over 90 ms. */
export function popupScale(age: number): number {
  const u = age / FX.popupScale;
  return u >= 1 ? 1 : 0.85 + 0.15 * (u < 0 ? 0 : u);
}

/** Widths of text, looked up by font and string. A string is measured once, so a frame never allocates for it. */
export class TextWidths {
  private fonts = new Map<string, Map<string, number>>();

  width(ctx: CanvasRenderingContext2D, font: string, text: string): number {
    let m = this.fonts.get(font);
    if (!m) {
      m = new Map();
      this.fonts.set(font, m);
    }
    let w = m.get(text);
    if (w === undefined) {
      ctx.font = font;
      w = ctx.measureText(text).width;
      m.set(text, w);
    }
    return w;
  }
}
