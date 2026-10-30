// Cached bitmaps for targets, slider bodies and the field (PLAN-2 5.4).

import { BULLSEYE, PLAYFIELD } from '../../shared/catalog';
import type { SliderObject } from '../../shared/types';
import type { SliderGeometry } from '../rules/slider';
import { groupOf } from './skin';
import type { Skin } from './skin';
import { COLORS, hexAlpha } from './theme';

export type CanvasFactory = (w: number, h: number) => HTMLCanvasElement;

export const defaultCanvasFactory: CanvasFactory = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Half the drawn size, in playfield units. */
  half: number;
}

export interface BodySprite {
  canvas: HTMLCanvasElement;
  /** Top-left corner and size in playfield units. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const MAX_SIDE = 3072;
const TAU = Math.PI * 2;

export class SpriteCache {
  private targets = new Map<number, Sprite>();
  private bodies = new Map<number, BodySprite | null>();
  private targetPpu = 0;
  private bodyPpu = 0;

  constructor(private make: CanvasFactory) {}

  clear(): void {
    this.targets.clear();
    this.bodies.clear();
    this.targetPpu = 0;
    this.bodyPpu = 0;
  }

  /**
   * A target: halo, body and ring. ppu is device pixels per playfield unit. With `bullseye` there is a 1-unit
   * ring at half the radius. The number is drawn over the sprite, because it changes from target to target.
   */
  target(skin: Skin, group: number, radius: number, ppu: number, bullseye: boolean): Sprite {
    if (ppu !== this.targetPpu) {
      this.targets.clear();
      this.targetPpu = ppu;
    }
    const g4 = groupOf(group);
    const key = (g4 * 100000 + Math.round(radius * 10)) * 2 + (bullseye ? 1 : 0);
    let s = this.targets.get(key);
    if (s) return s;
    const color = skin.groups[g4] as string;
    const half = radius * 1.4;
    const px = Math.max(8, Math.ceil(half * 2 * ppu));
    const canvas = this.make(px, px);
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    const k = px / (half * 2);
    g.setTransform(k, 0, 0, k, px / 2, px / 2);
    // A soft halo outside the ring.
    const glow = g.createRadialGradient(0, 0, radius * 0.9, 0, 0, half);
    glow.addColorStop(0, skin.groupGlow[g4] as string);
    glow.addColorStop(1, hexAlpha(color, 0));
    g.fillStyle = glow;
    g.beginPath();
    g.arc(0, 0, half, 0, TAU);
    g.fill();
    // Body, at 90%.
    const body = g.createRadialGradient(0, -radius * 0.35, radius * 0.05, 0, 0, radius);
    body.addColorStop(0, '#1b2433');
    body.addColorStop(1, COLORS.body);
    g.globalAlpha = 0.9;
    g.fillStyle = body;
    g.beginPath();
    g.arc(0, 0, radius, 0, TAU);
    g.fill();
    g.globalAlpha = 1;
    // The 3-unit ring in the group colour.
    g.lineWidth = 3;
    g.strokeStyle = color;
    g.beginPath();
    g.arc(0, 0, radius - 1.5, 0, TAU);
    g.stroke();
    if (bullseye) {
      g.globalAlpha = 0.35;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(0, 0, radius * BULLSEYE.innerRadii, 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
    }
    s = { canvas, half };
    this.targets.set(key, s);
    return s;
  }

  /** The path of a slider as a 2r wide band with an outline. Drawn once per slider and scale. */
  sliderBody(skin: Skin, index: number, geom: SliderGeometry, group: number, ppu: number): BodySprite | null {
    if (ppu !== this.bodyPpu) {
      this.bodies.clear();
      this.bodyPpu = ppu;
    }
    if (this.bodies.has(index)) return this.bodies.get(index) ?? null;
    const o: SliderObject = geom.obj;
    const f = geom.flat;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < f.n; i++) {
      const x = f.xs[i] as number;
      const y = f.ys[i] as number;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const pad = o.radius + 4;
    const x0 = minX - pad;
    const y0 = minY - pad;
    const w = maxX - minX + 2 * pad;
    const h = maxY - minY + 2 * pad;
    let k = ppu;
    if (w * k > MAX_SIDE) k = MAX_SIDE / w;
    if (h * k > MAX_SIDE) k = Math.min(k, MAX_SIDE / h);
    const canvas = this.make(Math.max(2, Math.ceil(w * k)), Math.max(2, Math.ceil(h * k)));
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    g.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(f.xs[0] as number, f.ys[0] as number);
    for (let i = 1; i < f.n; i++) g.lineTo(f.xs[i] as number, f.ys[i] as number);
    const g4 = groupOf(group);
    const color = skin.groups[g4] as string;
    g.strokeStyle = color;
    g.globalAlpha = 0.85;
    g.lineWidth = 2 * o.radius;
    g.stroke();
    g.globalAlpha = 1;
    g.strokeStyle = COLORS.bodyDeep;
    g.lineWidth = 2 * o.radius - 5;
    g.stroke();
    // A faint centre line, so the route reads under the follow ring.
    g.strokeStyle = skin.groupLine[g4] as string;
    g.lineWidth = 2;
    g.stroke();
    // A ring at the tail.
    const tx = f.xs[f.n - 1] as number;
    const ty = f.ys[f.n - 1] as number;
    g.strokeStyle = color;
    g.globalAlpha = 0.9;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(tx, ty, o.radius * 0.55, 0, TAU);
    g.stroke();
    const sprite: BodySprite = { canvas, x: x0, y: y0, w, h };
    this.bodies.set(index, sprite);
    return sprite;
  }

  /** How many slider bodies are held. */
  get bodyCount(): number {
    return this.bodies.size;
  }

  /** Forget the body bitmaps of sliders that are done. */
  dropBodiesBelow(index: number): void {
    for (const k of this.bodies.keys()) if (k < index) this.bodies.delete(k);
  }
}

/** Space around the field in the background bitmap, in units, for the reticle marks. */
export const FIELD_PAD = 14;

/**
 * The field: a panel with a 1 px edge, reticle marks at the corners, a ruler along each edge and, when `grid` is on,
 * a 50-unit dot grid. `ppu` is device pixels per unit and `dpr` device pixels per CSS pixel. The bitmap is
 * `FIELD_PAD` units larger than the field on every side.
 */
export function buildFieldBackground(make: CanvasFactory, ppu: number, dpr: number, grid: boolean): HTMLCanvasElement {
  const w = PLAYFIELD.width;
  const h = PLAYFIELD.height;
  const pad = FIELD_PAD;
  const canvas = make(Math.max(2, Math.round((w + 2 * pad) * ppu)), Math.max(2, Math.round((h + 2 * pad) * ppu)));
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.setTransform(ppu, 0, 0, ppu, pad * ppu, pad * ppu);
  const px = dpr / ppu; // one CSS pixel, in units
  // The panel, a little lighter in the middle.
  const bg = g.createRadialGradient(w / 2, h / 2, h * 0.05, w / 2, h / 2, w * 0.62);
  bg.addColorStop(0, '#0d141f');
  bg.addColorStop(1, COLORS.field);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (grid) {
    g.fillStyle = COLORS.grid;
    for (let x = 50; x < w; x += 50) {
      for (let y = 50; y < h; y += 50) {
        g.beginPath();
        g.arc(x, y, 1.25, 0, TAU);
        g.fill();
      }
    }
  }
  // The edge, 1 px.
  g.lineWidth = px;
  g.strokeStyle = COLORS.fieldEdge;
  g.strokeRect(px / 2, px / 2, w - px, h - px);
  // A ruler along the inside of each edge, every 125 units.
  g.beginPath();
  for (let x = 125; x < w; x += 125) {
    g.moveTo(x, 0);
    g.lineTo(x, 5);
    g.moveTo(x, h);
    g.lineTo(x, h - 5);
  }
  for (let y = 125; y < h; y += 125) {
    g.moveTo(0, y);
    g.lineTo(5, y);
    g.moveTo(w, y);
    g.lineTo(w - 5, y);
  }
  g.stroke();
  // A small plus at the centre.
  g.strokeStyle = COLORS.reticle;
  g.beginPath();
  g.moveTo(w / 2 - 6, h / 2);
  g.lineTo(w / 2 + 6, h / 2);
  g.moveTo(w / 2, h / 2 - 6);
  g.lineTo(w / 2, h / 2 + 6);
  g.stroke();
  // The reticle marks: a 12-unit L at each corner, just outside the edge.
  const o = 6;
  const a = 12;
  g.lineWidth = 1.5 * px;
  g.lineCap = 'butt';
  g.strokeStyle = COLORS.reticle;
  g.beginPath();
  for (const [cx, cy, sx, sy] of [
    [0, 0, 1, 1],
    [w, 0, -1, 1],
    [w, h, -1, -1],
    [0, h, 1, -1],
  ] as const) {
    g.moveTo(cx - sx * o + sx * a, cy - sy * o);
    g.lineTo(cx - sx * o, cy - sy * o);
    g.lineTo(cx - sx * o, cy - sy * o + sy * a);
  }
  g.stroke();
  return canvas;
}
