// The HUD: score or level, combo, accuracy, health, time ring and the timing error bar. Drawn in CSS pixels.

import { JUDGMENTS } from '../../shared/catalog';
import type { HitWindows, Judgment } from '../../shared/types';
import type { FieldLayout } from '../engine/playfield';
import { classifyError } from '../rules/judge';
import type { Effects } from './effects';
import { STRINGS } from './strings';
import { COLORS, FONT, FX } from './theme';
import { hexAlpha } from './objects';

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
}

const BAR_W = 360;
const ZONE_ROUGH = hexAlpha(JUDGMENTS.rough.color, 0.22);
const ZONE_SOLID = hexAlpha(JUDGMENTS.solid.color, 0.3);
const ZONE_CRISP = hexAlpha(JUDGMENTS.crisp.color, 0.45);
const F_SCORE = `700 26px ${FONT}`;
const F_SMALL = `500 12px ${FONT}`;
const F_COMBO = `800 34px ${FONT}`;
const F_LOST = `700 17px ${FONT}`;
const F_BAR = `500 11px ${FONT}`;
const JCOLORS: Record<Judgment, string> = {
  crisp: JUDGMENTS.crisp.color,
  solid: JUDGMENTS.solid.color,
  rough: JUDGMENTS.rough.color,
  miss: JUDGMENTS.miss.color,
};

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
  }

  draw(ctx: CanvasRenderingContext2D, layout: FieldLayout, fx: Effects, d: HudData, now: number): void {
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
        ctx.fillText(STRINGS.set(d.set + 1), left + sx, 51 + sy);
      }
    }

    // Center: combo, with accuracy under it.
    ctx.textAlign = 'center';
    const bump = Math.max(0, 1 - (now - fx.bumpT) / FX.comboBump);
    const glow = Math.max(0, 1 - (now - fx.glowT0) / 600);
    ctx.save();
    ctx.translate(cx + sx, 30 + sy);
    ctx.scale(1 + 0.12 * bump, 1 + 0.12 * bump);
    ctx.font = F_COMBO;
    if (glow > 0) {
      ctx.shadowColor = JUDGMENTS.crisp.color;
      ctx.shadowBlur = 18 * glow;
    }
    ctx.fillStyle = broken ? COLORS.danger : glow > 0 ? '#ddd6fe' : COLORS.ink;
    if (fx.comboShown !== this.comboInt) {
      this.comboInt = fx.comboShown;
      this.comboText = String(fx.comboShown);
    }
    ctx.fillText(this.comboText, 0, 0);
    ctx.restore();
    ctx.font = F_SMALL;
    ctx.fillStyle = COLORS.ink2;
    const ak = Math.round(d.accuracy * 1000);
    if (ak !== this.accKey) {
      this.accKey = ak;
      this.accText = STRINGS.accuracy(ak / 1000);
    }
    ctx.fillText(this.accText, cx, 49);
    if (lostT >= 0 && lostT < 1) {
      ctx.globalAlpha = 1 - lostT;
      ctx.font = F_LOST;
      ctx.fillStyle = COLORS.danger;
      ctx.fillText(this.lostText(fx.lostValue), cx + sx, 74 + lostT * 10);
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
    ctx.strokeStyle = '#7dd3fc';
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

    // Health bar under the top band.
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
  }

  private drawErrorBar(ctx: CanvasRenderingContext2D, layout: FieldLayout, fx: Effects, win: HitWindows, now: number): void {
    const cx = layout.cssW / 2;
    const cy = layout.cssH - 24;
    const half = BAR_W / 2;
    const k = half / win.rough;
    const zone = (w: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(cx - w * k, cy - 3, 2 * w * k, 6);
    };
    zone(win.rough, ZONE_ROUGH);
    zone(win.solid, ZONE_SOLID);
    zone(win.crisp, ZONE_CRISP);
    ctx.fillStyle = COLORS.ink2;
    ctx.fillRect(cx - 0.5, cy - 9, 1, 18);

    for (let i = 0; i < fx.barCount; i++) {
      const j = fx.barIndex(i);
      const age = now - (fx.barT[j] as number);
      if (age >= FX.barFade) continue;
      const err = fx.barErr[j] as number;
      const cls = classifyError(err, win);
      ctx.globalAlpha = 1 - age / FX.barFade;
      ctx.fillStyle = JCOLORS[cls === null || cls === 'early' ? 'miss' : cls];
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
    ctx.fillStyle = COLORS.dim;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText(STRINGS.barEarly, cx - half - 8, cy);
    ctx.textAlign = 'left';
    ctx.fillText(STRINGS.barLate, cx + half + 8, cy);
    ctx.textBaseline = 'alphabetic';
  }
}
