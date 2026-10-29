// The drawn cursor and its trail. The system cursor needs no drawing.

import type { CursorBuffer } from '../engine/cursor';
import type { FieldLayout } from '../engine/playfield';

const TRAIL_MS = 80;
const TRAIL_SEGMENTS = 20;

/** A data URL for the crosshair the canvas shows in absolute mode when the cursor is not drawn. */
export const SYSTEM_CURSOR =
  'url("data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 25 25">' +
      '<circle cx="12.5" cy="12.5" r="6.5" fill="none" stroke="#0b0f14" stroke-width="3"/>' +
      '<circle cx="12.5" cy="12.5" r="6.5" fill="none" stroke="#e5e7eb" stroke-width="1.5"/>' +
      '<circle cx="12.5" cy="12.5" r="1.8" fill="#e5e7eb"/></svg>',
  ) +
  '") 12 12, crosshair';

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
    let ax = layout.ox + buf.xAt(lo) * layout.scale;
    let ay = layout.oy + buf.yAt(lo) * layout.scale;
    let at = buf.tAt(lo);
    for (let i = lo + stride; i <= i1; i += stride) {
      const bx = layout.ox + buf.xAt(i) * layout.scale;
      const by = layout.oy + buf.yAt(i) * layout.scale;
      const bt = buf.tAt(i);
      const u = Math.max(0, 1 - (tEnd - bt) / TRAIL_MS);
      ctx.globalAlpha = 0.45 * u;
      ctx.lineWidth = 1 + 5 * u * scale;
      ctx.strokeStyle = '#7dd3fc';
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ax = bx;
      ay = by;
      at = bt;
    }
    void at;
    ctx.globalAlpha = 1;
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(11, 15, 20, 0.9)';
  ctx.beginPath();
  ctx.arc(px, py, 7 * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#e5e7eb';
  ctx.beginPath();
  ctx.arc(px, py, 7 * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#e5e7eb';
  ctx.beginPath();
  ctx.arc(px, py, 3 * scale, 0, Math.PI * 2);
  ctx.fill();
}
