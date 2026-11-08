// The drawn cursor and its trail (PLAN-2 5.4). The system cursor needs no drawing.

import type { CursorStyle } from '../../shared/types';
import type { CursorBuffer } from '../engine/cursor';
import type { FieldLayout } from '../engine/playfield';
import { COLORS } from './theme';

const TRAIL_MS = 80;
const TRAIL_SEGMENTS = 20;
const TAU = Math.PI * 2;

/** A data URL for the crosshair the canvas shows in absolute mode when the cursor is not drawn. */
export const SYSTEM_CURSOR =
  'url("data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 25 25">' +
      '<circle cx="12.5" cy="12.5" r="6.5" fill="none" stroke="#07090e" stroke-width="3"/>' +
      '<circle cx="12.5" cy="12.5" r="6.5" fill="none" stroke="#eef1f6" stroke-width="1.5"/>' +
      '<circle cx="12.5" cy="12.5" r="1.8" fill="#eef1f6"/></svg>',
  ) +
  '") 12 12, crosshair';

/** Sizes of the three styles in CSS pixels at cursorScale 1. */
export const CURSOR = {
  /** ring: a 6 px dot inside a 14 px ring. */
  ringOuter: 14,
  ringDot: 6,
  /** cross: four 6 px arms with a 2 px gap between them. */
  crossArm: 6,
  crossGap: 2,
  /** dot: a solid 5 px dot. */
  dot: 5,
} as const;

/**
 * Draw the cursor at a field position, in CSS pixels. `buf` and `now` give the trail,
 * which covers the last 80 ms of samples.
 */
export function drawCursor(
  ctx: CanvasRenderingContext2D,
  layout: FieldLayout,
  x: number,
  y: number,
  scale: number,
  style: CursorStyle,
  trail: { buf: CursorBuffer; now: number } | null,
): void {
  const px = layout.ox + x * layout.scale;
  const py = layout.oy + y * layout.scale;
  if (trail && trail.buf.size > 1) {
    const buf = trail.buf;
    const i1 = buf.size - 1;
    const tEnd = buf.tAt(i1);
    const lo = buf.lowerBound(tEnd - TRAIL_MS);
    const span = Math.max(1, i1 - lo);
    const stride = Math.max(1, Math.floor(span / TRAIL_SEGMENTS));
    ctx.lineCap = 'round';
    ctx.strokeStyle = COLORS.data;
    let ax = layout.ox + buf.xAt(lo) * layout.scale;
    let ay = layout.oy + buf.yAt(lo) * layout.scale;
    for (let i = lo + stride; i <= i1; i += stride) {
      const bx = layout.ox + buf.xAt(i) * layout.scale;
      const by = layout.oy + buf.yAt(i) * layout.scale;
      const u = Math.max(0, 1 - (tEnd - buf.tAt(i)) / TRAIL_MS);
      ctx.globalAlpha = 0.45 * u;
      ctx.lineWidth = 1 + 5 * u * scale;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ax = bx;
      ay = by;
    }
    ctx.globalAlpha = 1;
  }
  ctx.lineCap = 'butt';
  if (style === 'cross') {
    const a = (CURSOR.crossGap / 2) * scale;
    const b = a + CURSOR.crossArm * scale;
    for (let pass = 0; pass < 2; pass++) {
      ctx.lineWidth = pass === 0 ? 3.5 : 1.75;
      ctx.strokeStyle = pass === 0 ? COLORS.outline : COLORS.ink;
      ctx.beginPath();
      ctx.moveTo(px - b, py);
      ctx.lineTo(px - a, py);
      ctx.moveTo(px + a, py);
      ctx.lineTo(px + b, py);
      ctx.moveTo(px, py - b);
      ctx.lineTo(px, py - a);
      ctx.moveTo(px, py + a);
      ctx.lineTo(px, py + b);
      ctx.stroke();
    }
    return;
  }
  if (style === 'dot') {
    const r = (CURSOR.dot / 2) * scale;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = COLORS.outline;
    ctx.fillStyle = COLORS.ink;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, TAU);
    ctx.stroke();
    ctx.fill();
    return;
  }
  ctx.lineWidth = 2.25;
  ctx.strokeStyle = COLORS.outline;
  ctx.beginPath();
  ctx.arc(px, py, (CURSOR.ringOuter / 2) * scale, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = COLORS.ink;
  ctx.beginPath();
  ctx.arc(px, py, (CURSOR.ringOuter / 2) * scale, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = COLORS.ink;
  ctx.beginPath();
  ctx.arc(px, py, (CURSOR.ringDot / 2) * scale, 0, TAU);
  ctx.fill();
}
