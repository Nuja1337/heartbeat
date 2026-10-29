// The logical playfield (1000 x 625 units) mapped onto the canvas. Handles size, DPR and conversions.

import { PLAYFIELD } from '../../shared/catalog';

/** CSS pixels reserved above and below the field, and on each side. */
export const BAND_TOP = 56;
export const BAND_BOTTOM = 48;
export const BAND_SIDE = 24;

export interface FieldLayout {
  /** Canvas size in CSS pixels. */
  cssW: number;
  cssH: number;
  /** Pixels per playfield unit, in CSS pixels. */
  scale: number;
  /** CSS pixel position of the field origin. */
  ox: number;
  oy: number;
}

export function computeLayout(cssW: number, cssH: number): FieldLayout {
  const availW = Math.max(100, cssW - 2 * BAND_SIDE);
  const availH = Math.max(100, cssH - BAND_TOP - BAND_BOTTOM);
  const scale = Math.min(availW / PLAYFIELD.width, availH / PLAYFIELD.height);
  const ox = (cssW - PLAYFIELD.width * scale) / 2;
  const oy = BAND_TOP + (availH - PLAYFIELD.height * scale) / 2;
  return { cssW, cssH, scale, ox, oy };
}

export class Playfield {
  layout: FieldLayout = computeLayout(1000, 700);
  dpr = 1;
  private rect = { left: 0, top: 0 };
  private ro: ResizeObserver | null = null;
  private mq: MediaQueryList | null = null;
  private onMq = () => this.resize();
  private onWin = () => this.updateRect();
  /** Called after every size or DPR change. */
  onResize: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {}

  attach(): void {
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.canvas);
    }
    window.addEventListener('resize', this.onWin);
    window.addEventListener('scroll', this.onWin, true);
    this.watchDpr();
  }

  detach(): void {
    this.ro?.disconnect();
    this.ro = null;
    window.removeEventListener('resize', this.onWin);
    window.removeEventListener('scroll', this.onWin, true);
    this.mq?.removeEventListener('change', this.onMq);
    this.mq = null;
  }

  private watchDpr(): void {
    this.mq?.removeEventListener('change', this.onMq);
    if (typeof matchMedia === 'undefined') return;
    this.mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    this.mq.addEventListener('change', this.onMq);
  }

  private updateRect(): void {
    const r = this.canvas.getBoundingClientRect();
    this.rect.left = r.left;
    this.rect.top = r.top;
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== this.dpr) this.watchDpr();
    this.dpr = dpr;
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== bw) this.canvas.width = bw;
    if (this.canvas.height !== bh) this.canvas.height = bh;
    this.layout = computeLayout(w, h);
    this.updateRect();
    this.onResize?.();
  }

  /** Playfield units for a client position. */
  toField(clientX: number, clientY: number, out: { x: number; y: number }): { x: number; y: number } {
    const l = this.layout;
    out.x = (clientX - this.rect.left - l.ox) / l.scale;
    out.y = (clientY - this.rect.top - l.oy) / l.scale;
    return out;
  }

  /** Transform for drawing in playfield units. */
  setFieldTransform(ctx: CanvasRenderingContext2D): void {
    const l = this.layout;
    const k = this.dpr * l.scale;
    ctx.setTransform(k, 0, 0, k, this.dpr * l.ox, this.dpr * l.oy);
  }

  /** Transform for drawing in CSS pixels. */
  setHudTransform(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
}
