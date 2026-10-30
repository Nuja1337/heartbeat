// The HUD: score or level, combo, accuracy, health, time ring, the timing error bar, the quick retry bar and the
// frame graph. Drawn in CSS pixels, in the display font (PLAN-2 5.4).

import type { HitWindows } from '../../shared/types';
import type { FieldLayout } from '../engine/playfield';
import { classifyError } from '../rules/judge';
import type { Effects } from './effects';
import { GRAPH_FRAMES } from './frameStats';
import type { FrameStats } from './frameStats';
import type { Skin } from './skin';
import { STRINGS } from './strings';
import { COLORS, FONT, FX, hexAlpha } from './theme';

export interface HudData {
  /** Dynamic and fixed modes show a score. Adaptive modes show the level. */
  showScore: boolean;
  score: number;
  combo: number;
  accuracy: number;
  health: number | null;
  /** 0..1 */
  timeFraction: number;
  level: number | null;
  set: number | null;
  windows: HitWindows;
  errorBar: boolean;
  fps: number | null;
  /** Quick retry hold progress, 0..1. 0 hides the bar. */
  retry: number;
  /** The frame time graph, or null when it is off. */
  frames: FrameStats | null;
  /** Time one frame should take at the display rate, ms. null when the rate is not known yet. */
  frameBudgetMs: number | null;
}

const BAR_W = 360;
const F_SCORE = `700 28px ${FONT}`;
const F_SMALL = `500 12px ${FONT}`;
const F_ACC = `500 13px ${FONT}`;
const F_COMBO = `700 40px ${FONT}`;
const F_LOST = `700 17px ${FONT}`;
const F_BAR = `500 11px ${FONT}`;
const F_GRAPH = `600 11px ${FONT}`;
/** The frame graph: a 120 x 40 px panel at the bottom left, with its text under 500 ms updates. */
export const GRAPH = { w: 120, h: 40, margin: 8, textEveryMs: 500 } as const;
/** The quick retry bar: 160 px wide at the top centre of the field. */
export const RETRY_BAR = { w: 160, h: 4, top: 22 } as const;
const PANEL = 'rgba(7, 9, 14, 0.78)';

export class Hud {
  private shake = { x: 0, y: 0 };
  private healthShown = 1;
  private lastT = 0;
  private scoreInt = -1;
  private scoreText = '0';
  private accKey = -1;
  private accText = '';
  private comboInt = -1;
  private comboText = '0';
  private fpsInt = -1;
  private fpsText = '';
  private levelCache = new Map<number, string>();
  private lostCache = new Map<number, string>();
  private skin: Skin | null = null;
  private zoneRough = '';
  private zoneSolid = '';
  private zoneCrisp = '';
  private graphAt = -1e9;
  private graphText = '';

  private levelText(level: number): string {
    const k = Math.round(level * 100);
    let s = this.levelCache.get(k);
    if (!s) {
      s = STRINGS.level(level);
      this.levelCache.set(k, s);
    }
    return s;
  }

  private lostText(n: number): string {
    let s = this.lostCache.get(n);
    if (!s) {
      s = STRINGS.comboLost(n);
      this.lostCache.set(n, s);
    }
    return s;
  }

  reset(): void {
    this.healthShown = 1;
    this.lastT = 0;
    this.graphAt = -1e9;
  }

  /** Build the colours that depend on the palette. */
  private useSkin(skin: Skin): void {
    this.skin = skin;
    this.zoneRough = hexAlpha(skin.judge[2] as string, 0.24);
    this.zoneSolid = hexAlpha(skin.judge[1] as string, 0.3);
    this.zoneCrisp = hexAlpha(skin.judge[0] as string, 0.45);
  }

  draw(ctx: CanvasRenderingContext2D, layout: FieldLayout, fx: Effects, d: HudData, now: number, skin: Skin): void {
    if (this.skin !== skin) this.useSkin(skin);
    const dt = this.lastT > 0 ? Math.min(100, now - this.lastT) : 16;
    this.lastT = now;
    const w = layout.cssW;
    const cx = w / 2;

    // Smooth the shown values.
    const ease = 1 - Math.exp(-dt / 90);
    fx.scoreShown += (d.score - fx.scoreShown) * ease;
    if (Math.abs(d.score - fx.scoreShown) < 0.5) fx.scoreShown = d.score;
    if (d.health !== null) this.healthShown += (d.health - this.healthShown) * (1 - Math.exp(-dt / 120));

    // Combo bump.
    if (d.combo > fx.comboShown) fx.bumpT = now;
    const lostT = (now - fx.lostT0) / FX.comboLost;
    const broken = lostT >= 0 && lostT < 0.6;
    // A broken combo keeps its old number, in red, for a moment before it shows 0.
    if (!broken || d.combo > 0) fx.comboShown = d.combo;
    fx.shake(now, this.shake);
    const sx = this.shake.x;
    const sy = this.shake.y;

    ctx.textBaseline = 'alphabetic';

    // Left: score, or the level for adaptive modes.
    ctx.textAlign = 'left';
    const left = Math.max(layout.ox, 18);
    if (d.showScore) {
      ctx.font = F_SCORE;
      ctx.fillStyle = COLORS.ink;
      const si = Math.round(fx.scoreShown);
      if (si !== this.scoreInt) {
        this.scoreInt = si;
        this.scoreText = si.toLocaleString('en-US');
      }
      ctx.fillText(this.scoreText, left + sx, 36 + sy);
    } else if (d.level !== null) {
      ctx.font = F_SCORE;
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(this.levelText(d.level), left + sx, 36 + sy);
      if (d.set !== null) {
        ctx.font = F_SMALL;
        ctx.fillStyle = COLORS.ink2;
        ctx.fillText(STRINGS.set(d.set + 1), left + sx, 52 + sy);
      }
    }

    // Center: combo, with accuracy under it.
    ctx.textAlign = 'center';
    const bump = Math.max(0, 1 - (now - fx.bumpT) / FX.comboBump);
    const glow = Math.max(0, 1 - (now - fx.glowT0) / 600);
    ctx.save();
    ctx.translate(cx + sx, 33 + sy);
    ctx.scale(1 + 0.12 * bump, 1 + 0.12 * bump);
    ctx.font = F_COMBO;
    if (glow > 0) {
      ctx.shadowColor = skin.judge[0] as string;
      ctx.shadowBlur = 18 * glow;
    }
    ctx.fillStyle = broken ? COLORS.danger : glow > 0 ? (skin.judge[0] as string) : COLORS.ink;
    if (fx.comboShown !== this.comboInt) {
      this.comboInt = fx.comboShown;
      this.comboText = String(fx.comboShown);
    }
    ctx.fillText(this.comboText, 0, 0);
    ctx.restore();
    ctx.font = F_ACC;
    ctx.fillStyle = COLORS.ink2;
    const ak = Math.round(d.accuracy * 1000);
    if (ak !== this.accKey) {
      this.accKey = ak;
      this.accText = STRINGS.accuracy(ak / 1000);
    }
    ctx.fillText(this.accText, cx, 51);
    if (lostT >= 0 && lostT < 1) {
      ctx.globalAlpha = 1 - lostT;
      ctx.font = F_LOST;
      ctx.fillStyle = COLORS.danger;
      ctx.fillText(this.lostText(fx.lostValue), cx + sx, 76 + lostT * 10);
      ctx.globalAlpha = 1;
    }

    // Right: time ring, and the frame rate when asked for.
    const rx = Math.min(w - 30, layout.ox + 1000 * layout.scale - 6);
    const ry = 28;
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.fieldEdge;
    ctx.beginPath();
    ctx.arc(rx, ry, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = COLORS.data;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(rx, ry, 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, Math.max(0, d.timeFraction)));
    ctx.stroke();
    if (d.fps !== null) {
      ctx.textAlign = 'right';
      ctx.font = F_SMALL;
      ctx.fillStyle = COLORS.ink2;
      const fi = Math.round(d.fps);
      if (fi !== this.fpsInt) {
        this.fpsInt = fi;
        this.fpsText = STRINGS.fps(fi);
      }
      ctx.fillText(this.fpsText, rx - 24, 33);
    }

    // Health bar under the top band, 3 px.
    if (d.health !== null) {
      const x0 = layout.ox;
      const bw = 1000 * layout.scale;
      const h = Math.max(0, Math.min(1, this.healthShown));
      ctx.fillStyle = COLORS.fieldEdge;
      ctx.fillRect(x0, 56, bw, 3);
      ctx.fillStyle = h < 0.25 ? COLORS.healthLow : COLORS.health;
      ctx.fillRect(x0, 56, bw * h, 3);
    }

    if (d.errorBar) this.drawErrorBar(ctx, layout, fx, d.windows, now);
    if (d.retry > 0) this.drawRetry(ctx, layout, d.retry);
    if (d.frames) this.drawGraph(ctx, layout, d.frames, d.frameBudgetMs, now);
  }

  /** The quick retry hold: a 160 px bar at the top centre of the field that fills as the key stays down. */
  private drawRetry(ctx: CanvasRenderingContext2D, layout: FieldLayout, progress: number): void {
    const cx = layout.cssW / 2;
    const w = RETRY_BAR.w;
    const y = layout.oy + RETRY_BAR.top;
    ctx.fillStyle = PANEL;
    ctx.fillRect(cx - w / 2 - 8, y - 8, w + 16, RETRY_BAR.h + 34);
    ctx.fillStyle = COLORS.fieldEdge;
    ctx.fillRect(cx - w / 2, y, w, RETRY_BAR.h);
    ctx.fillStyle = COLORS.accent;
    ctx.fillRect(cx - w / 2, y, w * Math.min(1, progress), RETRY_BAR.h);
    ctx.font = F_SMALL;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COLORS.ink2;
    ctx.fillText(STRINGS.retrying, cx, y + RETRY_BAR.h + 16);
  }

  /** The last 120 frame times as bars, a line at the frame budget, and the p99 of the play so far. */
  private drawGraph(ctx: CanvasRenderingContext2D, layout: FieldLayout, frames: FrameStats, budget: number | null, now: number): void {
    const x = GRAPH.margin;
    const y = layout.cssH - GRAPH.margin - GRAPH.h;
    ctx.fillStyle = PANEL;
    ctx.fillRect(x, y, GRAPH.w, GRAPH.h);
    ctx.strokeStyle = COLORS.fieldEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, GRAPH.w - 1, GRAPH.h - 1);
    // Bars are scaled so the budget line sits at 40% of the height. Anything past 2.5 budgets is clipped.
    const unit = budget !== null && budget > 0 ? budget : 8.33;
    const k = (GRAPH.h * 0.4) / unit;
    const n = frames.shown;
    const barW = GRAPH.w / GRAPH_FRAMES;
    ctx.fillStyle = COLORS.data;
    for (let i = 0; i < n; i++) {
      const v = frames.recentAt(i);
      const h = Math.min(GRAPH.h - 2, v * k);
      ctx.globalAlpha = v > unit * 1.5 ? 1 : 0.55;
      ctx.fillStyle = v > unit * 1.5 ? COLORS.warn : COLORS.data;
      ctx.fillRect(x + (GRAPH_FRAMES - n + i) * barW, y + GRAPH.h - 1 - h, Math.max(1, barW - 0.5), h);
    }
    ctx.globalAlpha = 1;
    const ly = y + GRAPH.h - 1 - GRAPH.h * 0.4;
    ctx.strokeStyle = COLORS.ink3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, ly + 0.5);
    ctx.lineTo(x + GRAPH.w, ly + 0.5);
    ctx.stroke();
    if (now - this.graphAt >= GRAPH.textEveryMs) {
      this.graphAt = now;
      const p = frames.p99();
      this.graphText = p === null ? '' : STRINGS.p99(p);
    }
    if (this.graphText !== '') {
      ctx.font = F_GRAPH;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = COLORS.ink2;
      ctx.fillText(this.graphText, x + 4, y - 5);
    }
  }

  private drawErrorBar(ctx: CanvasRenderingContext2D, layout: FieldLayout, fx: Effects, win: HitWindows, now: number): void {
    const skin = this.skin as Skin;
    const cx = layout.cssW / 2;
    const cy = layout.cssH - 24;
    const half = BAR_W / 2;
    const k = half / win.rough;
    const zone = (w: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(cx - w * k, cy - 3, 2 * w * k, 6);
    };
    zone(win.rough, this.zoneRough);
    zone(win.solid, this.zoneSolid);
    zone(win.crisp, this.zoneCrisp);
    ctx.fillStyle = COLORS.ink2;
    ctx.fillRect(cx - 0.5, cy - 9, 1, 18);

    for (let i = 0; i < fx.barCount; i++) {
      const j = fx.barIndex(i);
      const age = now - (fx.barT[j] as number);
      if (age >= FX.barFade) continue;
      const err = fx.barErr[j] as number;
      const cls = classifyError(err, win);
      ctx.globalAlpha = 1 - age / FX.barFade;
      ctx.fillStyle = skin.judge[cls === null || cls === 'early' ? 3 : cls === 'crisp' ? 0 : cls === 'solid' ? 1 : 2] as string;
      const x = cx + Math.max(-half, Math.min(half, err * k));
      ctx.fillRect(x - 1, cy - 7, 2, 14);
    }
    ctx.globalAlpha = 1;

    if (fx.barHasMean) {
      const x = cx + Math.max(-half, Math.min(half, fx.barMean * k));
      ctx.fillStyle = COLORS.ink;
      ctx.beginPath();
      ctx.moveTo(x, cy + 6);
      ctx.lineTo(x - 4, cy + 13);
      ctx.lineTo(x + 4, cy + 13);
      ctx.closePath();
      ctx.fill();
    }
    ctx.font = F_BAR;
    ctx.fillStyle = COLORS.ink3;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText(STRINGS.barEarly, cx - half - 8, cy);
    ctx.textAlign = 'left';
    ctx.fillText(STRINGS.barLate, cx + half + 8, cy);
    ctx.textBaseline = 'alphabetic';
  }
}
