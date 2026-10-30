// The approach indicator of one target, drawn in playfield units (PLAN-2 5.4). The renderer and the calibration share it.

import { approachShape, APPROACH } from './approach';
import type { ApproachShape } from './approach';
import { groupOf } from './skin';
import type { Skin } from './skin';

const TAU = Math.PI * 2;

/**
 * Draw the indicator of the skin's style for a target of radius `r` at approach progress `u` (0 when it appears, 1 at
 * its time). `shape` is scratch space, so a frame allocates nothing. `isNext` draws the next target to hit stronger.
 */
export function drawApproachIndicator(
  ctx: CanvasRenderingContext2D,
  skin: Skin,
  shape: ApproachShape,
  x: number,
  y: number,
  r: number,
  group: number,
  u: number,
  isNext: boolean,
): void {
  const g4 = groupOf(group);
  const sh = approachShape(skin.approach, u, r, shape);
  const emphasis = isNext ? 1 : 0.8;
  if (skin.approach === 'fill') {
    if (sh.size < 0.5) return;
    ctx.globalAlpha = emphasis;
    ctx.fillStyle = skin.groupFill[g4] as string;
    ctx.beginPath();
    ctx.arc(x, y, sh.size, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.55 * emphasis;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = skin.groups[g4] as string;
    ctx.stroke();
    return;
  }
  ctx.globalAlpha = sh.alpha * emphasis;
  ctx.lineWidth = isNext ? 3 : 2.5;
  ctx.strokeStyle = skin.groups[g4] as string;
  ctx.beginPath();
  if (skin.approach === 'brackets') {
    // Four corner brackets of a square that turns as it closes.
    const h = sh.size;
    const arm = APPROACH.bracketArm * r;
    const c = Math.cos(sh.rot);
    const sn = Math.sin(sh.rot);
    for (let q = 0; q < 4; q++) {
      const sx = q === 0 || q === 3 ? -1 : 1;
      const sy = q < 2 ? -1 : 1;
      // The corner, and the two ends of its arms, in the square's own axes, then turned.
      const px = sx * h;
      const py = sy * h;
      const ax = px - sx * arm;
      const by = py - sy * arm;
      ctx.moveTo(x + ax * c - py * sn, y + ax * sn + py * c);
      ctx.lineTo(x + px * c - py * sn, y + px * sn + py * c);
      ctx.lineTo(x + px * c - by * sn, y + px * sn + by * c);
    }
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.stroke();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return;
  }
  ctx.arc(x, y, sh.size, 0, TAU);
  ctx.stroke();
}
