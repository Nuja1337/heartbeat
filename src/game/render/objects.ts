// Cached bitmaps for targets, slider bodies and the field background.

import { PLAYFIELD } from '../../shared/catalog';
import type { SliderObject } from '../../shared/types';
import type { SliderGeometry } from '../rules/slider';
import { COLORS, GROUP_COLORS } from './theme';

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

  /** A target: body, ring and center dot. ppu is device pixels per playfield unit. */
  target(group: number, radius: number, ppu: number): Sprite {
    if (ppu !== this.targetPpu) {
      this.targets.clear();
      this.targetPpu = ppu;
    }
    const g4 = ((group % 4) + 4) % 4;
    const color = GROUP_COLORS[g4] as string;
    const key = g4 * 100000 + Math.round(radius * 10);
    let s = this.targets.get(key);
    if (s) return s;
    const half = radius * 1.4;
    const px = Math.max(8, Math.ceil(half * 2 * ppu));
    const canvas = this.make(px, px);
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    const k = px / (half * 2);
    g.setTransform(k, 0, 0, k, px / 2, px / 2);
    // Soft glow outside the ring.
    const glow = g.createRadialGradient(0, 0, radius * 0.9, 0, 0, half);
    glow.addColorStop(0, hexAlpha(color, 0.22));
    glow.addColorStop(1, hexAlpha(color, 0));
    g.fillStyle = glow;
    g.beginPath();
    g.arc(0, 0, half, 0, Math.PI * 2);
    g.fill();
    // Body.
    const body = g.createRadialGradient(0, -radius * 0.3, radius * 0.1, 0, 0, radius);
    body.addColorStop(0, '#26364d');
    body.addColorStop(1, '#18222f');
    g.globalAlpha = 0.9;
    g.fillStyle = body;
    g.beginPath();
    g.arc(0, 0, radius, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
    // Ring and center dot.
    g.lineWidth = 3;
    g.strokeStyle = color;
    g.beginPath();
    g.arc(0, 0, radius - 1.5, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = color;
    g.globalAlpha = 0.9;
    g.beginPath();
    g.arc(0, 0, 4, 0, Math.PI * 2);
    g.fill();
    s = { canvas, half };
    this.targets.set(key, s);
    return s;
  }

  /** The path of a slider as a 2r wide band with an outline. Drawn once per slider and scale. */
  sliderBody(index: number, geom: SliderGeometry, group: number, ppu: number): BodySprite | null {
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
    const color = GROUP_COLORS[((group % 4) + 4) % 4] as string;
    g.strokeStyle = color;
    g.globalAlpha = 0.9;
    g.lineWidth = 2 * o.radius;
    g.stroke();
    g.globalAlpha = 1;
    g.strokeStyle = '#141d2a';
    g.lineWidth = 2 * o.radius - 6;
    g.stroke();
    // Faint center line so the route reads clearly under the follow ring.
    g.strokeStyle = hexAlpha(color, 0.18);
    g.lineWidth = 2;
    g.stroke();
    // A ring at the tail.
    const tx = f.xs[f.n - 1] as number;
    const ty = f.ys[f.n - 1] as number;
    g.strokeStyle = hexAlpha(color, 0.9);
    g.lineWidth = 3;
    g.beginPath();
    g.arc(tx, ty, o.radius * 0.55, 0, Math.PI * 2);
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

export function hexAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** The field background: a rounded panel with a vignette and a faint dot grid. */
export function buildFieldBackground(make: CanvasFactory, pxW: number, pxH: number, ppu: number): HTMLCanvasElement {
  const canvas = make(Math.max(2, Math.round(pxW)), Math.max(2, Math.round(pxH)));
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.setTransform(ppu, 0, 0, ppu, 0, 0);
  const w = PLAYFIELD.width;
  const h = PLAYFIELD.height;
  const radius = 14;
  g.beginPath();
  roundedRect(g, 0, 0, w, h, radius);
  const bg = g.createRadialGradient(w / 2, h / 2, h * 0.1, w / 2, h / 2, w * 0.62);
  bg.addColorStop(0, '#111a24');
  bg.addColorStop(1, '#0c1118');
  g.fillStyle = bg;
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = COLORS.grid;
  for (let x = 50; x < w; x += 50) {
    for (let y = 50; y < h; y += 50) {
      g.beginPath();
      g.arc(x, y, 1.3, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
  g.lineWidth = 2;
  g.strokeStyle = COLORS.fieldEdge;
  g.beginPath();
  roundedRect(g, 1, 1, w - 2, h - 2, radius);
  g.stroke();
  return canvas;
}

/** A rounded rectangle path. Older browsers have no roundRect. */
function roundedRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  if (typeof g.roundRect === 'function') {
    g.roundRect(x, y, w, h, r);
    return;
  }
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
