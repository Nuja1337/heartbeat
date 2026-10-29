// The draw passes, in the order PLAN section 4 lists them. One canvas, no allocation per frame.

import { JUDGMENTS, PLAYFIELD, PLAYFIELD_CENTER, SPINNER_RADIUS } from '../../shared/catalog';
import type { Settings, SliderObject, SpinnerObject, Vec2 } from '../../shared/types';
import type { Playfield } from '../engine/playfield';
import type { GameSession, ObjState } from '../engine/session';
import { endPosition } from '../map/features';
import { tangentAt } from '../map/path';
import type { FlatPath } from '../map/path';
import { ballPos } from '../rules/slider';
import { drawCursor } from './cursor';
import type { Effects } from './effects';
import { Hud } from './hud';
import type { HudData } from './hud';
import { buildFieldBackground, defaultCanvasFactory, hexAlpha, SpriteCache } from './objects';
import type { CanvasFactory } from './objects';
import { setChangeText, STRINGS } from './strings';
import { COLORS, FONT, groupColor } from './theme';

export type OverlayKind = 'none' | 'ready' | 'countdown' | 'needsClick' | 'failing';

/** Everything a frame needs. The game keeps one of these and updates it, so nothing is allocated per frame. */
export interface RenderState {
  session: GameSession;
  fx: Effects;
  settings: Settings;
  /** Play time, frozen while paused. */
  playT: number;
  /** Frame time from the browser, ms. */
  now: number;
  cursorX: number;
  cursorY: number;
  drawCursor: boolean;
  overlay: OverlayKind;
  overlayT0: number;
  startLabel: string;
  raw: boolean;
  fps: number | null;
  showScore: boolean;
  level: number | null;
  set: number | null;
  /** Length that the time ring is measured against. */
  lengthMs: number;
}

const TAU = Math.PI * 2;
const SPIN_TICK = hexAlpha('#e5e7eb', 0.16);
const SPIN_TIME = hexAlpha('#e5e7eb', 0.45);
const DASH: number[] = [6, 8];
const NO_DASH: number[] = [];

const NUM_FONTS = new Map<number, string>();
function numberFont(r: number): string {
  const k = Math.round(r * 0.8);
  let f = NUM_FONTS.get(k);
  if (!f) {
    f = `700 ${k}px ${FONT}`;
    NUM_FONTS.set(k, f);
  }
  return f;
}

const F_BIG = `800 34px ${FONT}`;
const F_TITLE = `700 30px ${FONT}`;
const F_SUB = `500 15px ${FONT}`;
const F_RPM = `800 54px ${FONT}`;
const F_RPM_LABEL = `500 15px ${FONT}`;
const F_HINT = `500 16px ${FONT}`;
const F_BANNER = `800 44px ${FONT}`;
const F_BANNER_SUB = `600 19px ${FONT}`;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Opacity of a target by approach progress under Fade. */
export function fadeAlpha(u: number): number {
  if (u < 0.25) return clamp01(u / 0.25);
  if (u < 0.45) return 1;
  if (u < 0.75) return 1 - (u - 0.45) / 0.3;
  return 0;
}

export class Renderer {
  private sprites: SpriteCache;
  private hud = new Hud();
  private bg: HTMLCanvasElement | null = null;
  private bgW = 0;
  private bgH = 0;
  private bgDpr = 0;
  private spotGrad: CanvasGradient | null = null;
  private spotR = 0;
  private vigGrad: CanvasGradient | null = null;
  private vigW = 0;
  private vigH = 0;
  private visible = new Int32Array(256);
  private tmp: Vec2 = { x: 0, y: 0 };
  private spotLift = 0;
  private droppedTo = 0;
  private lastNow = 0;
  private hudData: HudData = {
    showScore: true,
    score: 0,
    combo: 0,
    accuracy: 1,
    health: null,
    timeFraction: 0,
    level: null,
    set: null,
    windows: { crisp: 40, solid: 80, rough: 120, early: 180 },
    errorBar: true,
    fps: null,
  };

  constructor(
    private ctx: CanvasRenderingContext2D,
    private pf: Playfield,
    private make: CanvasFactory = defaultCanvasFactory,
  ) {
    this.sprites = new SpriteCache(make);
  }

  /** Slider body bitmaps held right now. */
  get bodyCount(): number {
    return this.sprites.bodyCount;
  }

  /** Call after the canvas size or DPR changes. */
  invalidate(): void {
    this.sprites.clear();
    this.bg = null;
    this.spotGrad = null;
    this.vigGrad = null;
  }

  reset(): void {
    this.hud.reset();
    this.sprites.dropBodiesBelow(1e9);
    this.spotLift = 0;
    this.droppedTo = 0;
  }

  render(rs: RenderState): void {
    const ctx = this.ctx;
    const pf = this.pf;
    const l = pf.layout;
    const dpr = pf.dpr;
    const ppu = dpr * l.scale;

    // 1. Background and field.
    pf.setHudTransform(ctx);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, l.cssW, l.cssH);
    if (!this.bg || l.cssW !== this.bgW || l.cssH !== this.bgH || dpr !== this.bgDpr) {
      this.bg = buildFieldBackground(this.make, PLAYFIELD.width * ppu, PLAYFIELD.height * ppu, ppu);
      this.bgW = l.cssW;
      this.bgH = l.cssH;
      this.bgDpr = dpr;
    }
    ctx.drawImage(this.bg, l.ox, l.oy, PLAYFIELD.width * l.scale, PLAYFIELD.height * l.scale);

    // 2 to 9, in playfield units.
    pf.setFieldTransform(ctx);
    this.drawObjects(rs, ppu);
    rs.fx.drawField(ctx, rs.now);
    rs.fx.drawPopups(ctx, rs.now);

    // 10. Spotlight.
    pf.setHudTransform(ctx);
    if (rs.session.map.mods.includes('spotlight')) this.drawSpotlight(rs);

    // 11. HUD.
    this.drawHud(rs);

    // Edge flash for a miss.
    const vig = rs.fx.vignette(rs.now);
    if (vig > 0) this.drawVignette(vig);

    // 12. Cursor and trail.
    if (rs.drawCursor) {
      drawCursor(ctx, l, rs.cursorX, rs.cursorY, rs.settings.input.cursorScale, rs.settings.input.cursorTrail ? { buf: rs.session.cursor, now: rs.now } : null);
    }

    // 13 and 14. Banner and overlays.
    this.drawBanner(rs);
    this.drawOverlay(rs);
    this.lastNow = rs.now;
  }

  /* ------------------------------------------------------------- objects */

  private drawObjects(rs: RenderState, ppu: number): void {
    const ctx = this.ctx;
    const s = rs.session;
    const t = rs.playT;
    const objs = s.objs;
    const fade = s.map.mods.includes('fade');
    const hints = rs.settings.display.pathHints;
    // Sliders that are finished no longer need their body bitmap.
    if (s.firstOpen !== this.droppedTo) {
      this.sprites.dropBodiesBelow(s.firstOpen);
      this.droppedTo = s.firstOpen;
    }
    let n = 0;
    for (let i = s.firstOpen; i < objs.length; i++) {
      const st = objs[i] as ObjState;
      const o = st.obj;
      if (o.time - o.approachMs > t) break;
      if (st.done) continue;
      if (n < 256) this.visible[n++] = i;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 2. Path hints between neighbours.
    if (hints && n > 1) {
      ctx.setLineDash(DASH);
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLORS.ink;
      for (let k = 0; k < n - 1; k++) {
        const a = (objs[this.visible[k] as number] as ObjState).obj;
        const b = (objs[this.visible[k + 1] as number] as ObjState).obj;
        if (a.kind === 'spinner' || b.kind === 'spinner' || b.index !== a.index + 1) continue;
        const u = (t - (b.time - b.approachMs)) / b.approachMs;
        if (u < 0.3) continue;
        const ea = endPosition(a);
        const dx = b.pos.x - ea.x;
        const dy = b.pos.y - ea.y;
        const len = Math.hypot(dx, dy);
        if (len < 2.2 * b.radius) continue;
        const ux = dx / len;
        const uy = dy / len;
        ctx.globalAlpha = 0.35 * clamp01((u - 0.3) / 0.2) * (fade ? 0.6 : 1);
        ctx.beginPath();
        ctx.moveTo(ea.x + ux * a.radius, ea.y + uy * a.radius);
        ctx.lineTo(b.pos.x - ux * b.radius, b.pos.y - uy * b.radius);
        ctx.stroke();
      }
      ctx.setLineDash(NO_DASH);
      ctx.globalAlpha = 1;
    }

    // 3. Slider bodies, ticks and reversals.
    for (let k = 0; k < n; k++) {
      const st = objs[this.visible[k] as number] as ObjState;
      if (st.obj.kind !== 'slider' || !st.slider) continue;
      this.drawSliderBody(st, st.obj, t, fade, ppu);
    }

    // 4. Targets, later ones first so earlier ones sit on top.
    let next = -1;
    for (let k = 0; k < n; k++) {
      const st = objs[this.visible[k] as number] as ObjState;
      if (st.obj.kind !== 'spinner' && !st.target.judged) {
        next = k;
        break;
      }
    }
    for (let k = n - 1; k >= 0; k--) {
      const st = objs[this.visible[k] as number] as ObjState;
      const o = st.obj;
      if (o.kind === 'spinner' || st.target.judged) continue;
      const u = (t - (o.time - o.approachMs)) / o.approachMs;
      let a = clamp01((t - (o.time - o.approachMs)) / Math.min(300, o.approachMs * 0.33));
      if (fade) a = Math.min(a, fadeAlpha(u));
      if (a <= 0.003) continue;
      const sp = this.sprites.target(o.group, o.radius, ppu);
      ctx.globalAlpha = a;
      ctx.drawImage(sp.canvas, o.pos.x - sp.half, o.pos.y - sp.half, sp.half * 2, sp.half * 2);
      ctx.font = numberFont(o.radius);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = COLORS.ink;
      ctx.globalAlpha = a * 0.92;
      ctx.fillText(numberText(o.number), o.pos.x, o.pos.y + o.radius * 0.04);
      if (k === next && !fade) {
        ctx.globalAlpha = a * 0.5;
        ctx.lineWidth = 2;
        ctx.strokeStyle = COLORS.ink;
        ctx.beginPath();
        ctx.arc(o.pos.x, o.pos.y, o.radius + 5, 0, TAU);
        ctx.stroke();
      }
    }

    // 5. Approach rings.
    if (!fade) {
      for (let k = 0; k < n; k++) {
        const st = objs[this.visible[k] as number] as ObjState;
        const o = st.obj;
        if (o.kind === 'spinner' || st.target.judged) continue;
        const u = (t - (o.time - o.approachMs)) / o.approachMs;
        if (u < 0 || u > 1.02) continue;
        const r = o.radius * (2.4 - 1.4 * clamp01(u));
        ctx.globalAlpha = Math.min(0.9, (u / 0.3) * 0.9) * (k === next ? 1 : 0.8);
        ctx.lineWidth = k === next ? 3 : 2.5;
        ctx.strokeStyle = groupColor(o.group);
        ctx.beginPath();
        ctx.arc(o.pos.x, o.pos.y, r, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // 6. Slider balls and follow rings.
    for (let k = 0; k < n; k++) {
      const st = objs[this.visible[k] as number] as ObjState;
      if (st.obj.kind === 'slider' && st.slider) this.drawBall(st, st.obj, t, rs.fx.tickPulseT, rs.now);
    }

    // 7. Spinner.
    for (let k = 0; k < n; k++) {
      const st = objs[this.visible[k] as number] as ObjState;
      if (st.obj.kind === 'spinner') this.drawSpinner(st, st.obj, rs);
    }
    ctx.globalAlpha = 1;
  }

  private drawSliderBody(st: ObjState, o: SliderObject, t: number, fade: boolean, ppu: number): void {
    const ctx = this.ctx;
    const run = st.slider;
    if (!run) return;
    if (t < o.time - o.approachMs - 400) return;
    const u = (t - (o.time - o.approachMs)) / o.approachMs;
    let a = clamp01((t - (o.time - o.approachMs)) / Math.min(300, o.approachMs * 0.33));
    if (fade) a = Math.min(a, fadeAlpha(u));
    if (a <= 0.003) return;
    const body = this.sprites.sliderBody(o.index, run.geom, o.group, ppu);
    if (!body) return;
    ctx.globalAlpha = a * 0.92;
    ctx.drawImage(body.canvas, body.x, body.y, body.w, body.h);
    // Ticks.
    const g = run.geom;
    const dot = o.radius * 0.14;
    for (let c = 0; c < g.checkT.length; c++) {
      const kind = g.checkKind[c] as number;
      const status = run.checkStatus[c] as number;
      if (kind === 3 || status === 1) continue;
      const x = g.checkX[c] as number;
      const y = g.checkY[c] as number;
      if (kind === 1) {
        ctx.globalAlpha = a * 0.9;
        ctx.fillStyle = status === 2 ? COLORS.miss : COLORS.ink;
        ctx.beginPath();
        ctx.arc(x, y, dot, 0, TAU);
        ctx.fill();
      } else if (status === 0) {
        this.drawChevron(g.flat, o, x, y, a);
      }
    }
  }

  /** A chevron at a reversal point, pointing the way the ball will go. */
  private drawChevron(flat: FlatPath, o: SliderObject, x: number, y: number, a: number): void {
    const ctx = this.ctx;
    const atEnd = Math.hypot(x - (flat.xs[flat.n - 1] as number), y - (flat.ys[flat.n - 1] as number)) < Math.hypot(x - (flat.xs[0] as number), y - (flat.ys[0] as number));
    tangentAt(flat, atEnd ? flat.length : 0, this.tmp);
    const dir = atEnd ? -1 : 1;
    const dx = this.tmp.x * dir;
    const dy = this.tmp.y * dir;
    const k = o.radius * 0.38;
    const px = -dy;
    const py = dx;
    ctx.globalAlpha = a * 0.95;
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.ink;
    ctx.beginPath();
    ctx.moveTo(x - dx * k * 0.2 + px * k, y - dy * k * 0.2 + py * k);
    ctx.lineTo(x + dx * k * 0.8, y + dy * k * 0.8);
    ctx.lineTo(x - dx * k * 0.2 - px * k, y - dy * k * 0.2 - py * k);
    ctx.stroke();
  }

  private drawBall(st: ObjState, o: SliderObject, t: number, tickPulseT: number, now: number): void {
    const ctx = this.ctx;
    const run = st.slider;
    if (!run || t < o.time) return;
    ballPos(run.geom, Math.min(t, o.endTime), this.tmp);
    const x = this.tmp.x;
    const y = this.tmp.y;
    const tracking = run.tracking;
    if (tracking) {
      const pulse = clamp01(1 - (now - tickPulseT) / 160);
      const r = o.followRadius * (1 + 0.06 * pulse);
      ctx.globalAlpha = 0.55 + 0.25 * pulse;
      ctx.lineWidth = 3;
      ctx.strokeStyle = groupColor(o.group);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = tracking ? 1 : 0.6;
    ctx.fillStyle = COLORS.body;
    ctx.beginPath();
    ctx.arc(x, y, o.radius * 0.92, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = groupColor(o.group);
    ctx.stroke();
    ctx.fillStyle = COLORS.ink;
    ctx.beginPath();
    ctx.arc(x, y, o.radius * 0.3, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawSpinner(st: ObjState, o: SpinnerObject, rs: RenderState): void {
    const ctx = this.ctx;
    const run = st.spinner;
    if (!run) return;
    const t = rs.playT;
    const appear = clamp01((t - (o.time - o.approachMs)) / 400);
    if (appear <= 0) return;
    const cx = PLAYFIELD_CENTER.x;
    const cy = PLAYFIELD_CENTER.y;
    const R = SPINNER_RADIUS;
    const active = t >= o.time;
    const q = o.rotationsRequired > 0 ? run.rotations / o.rotationsRequired : 1;
    ctx.globalAlpha = appear;
    // Track and turning marks.
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#18222f';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = SPIN_TICK;
    const turn = run.signedAngle;
    for (let k = 0; k < 24; k++) {
      const a = turn + (k / 24) * TAU;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (R - 26), cy + Math.sin(a) * (R - 26));
      ctx.lineTo(cx + Math.cos(a) * (R - 16), cy + Math.sin(a) * (R - 16));
      ctx.stroke();
    }
    // Progress, clockwise from the top.
    const done = q >= 1;
    ctx.lineWidth = 10;
    ctx.strokeStyle = done ? JUDGMENTS.crisp.color : '#7dd3fc';
    ctx.beginPath();
    ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + TAU * clamp01(q));
    ctx.stroke();
    // Time left.
    const left = active ? clamp01((o.endTime - t) / (o.endTime - o.time)) : 1;
    ctx.lineWidth = 3;
    ctx.strokeStyle = SPIN_TIME;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 13, -Math.PI / 2, -Math.PI / 2 + TAU * left);
    ctx.stroke();
    // Speed in the middle.
    if (active) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = F_RPM;
      ctx.fillStyle = done ? JUDGMENTS.crisp.color : COLORS.ink;
      ctx.fillText(rpmText(run.rpmAt(t)), cx, cy - 6);
      ctx.font = F_RPM_LABEL;
      ctx.fillStyle = COLORS.ink2;
      ctx.fillText(STRINGS.rpmLabel, cx, cy + 34);
    }
    // The hint, once per play.
    if (!rs.fx.spinHintShown) {
      if (active && run.rotations > 0.6) rs.fx.spinHintShown = true;
      else {
        ctx.font = F_HINT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = COLORS.ink2;
        ctx.fillText(STRINGS.spinnerHint, cx, cy + R + 44);
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------------------------------------------------- spotlight */

  private drawSpotlight(rs: RenderState): void {
    const ctx = this.ctx;
    const l = this.pf.layout;
    const s = rs.session;
    const dt = Math.min(100, Math.max(0, rs.now - this.lastNow));
    const spinning = s.activeSpin !== null && rs.playT >= s.activeSpin.obj.time;
    this.spotLift = clamp01(this.spotLift + (spinning ? dt : -dt) / 200);
    if (this.spotLift >= 1) return;
    const first = s.objs[s.firstOpen]?.obj ?? s.objs[0]?.obj;
    const r = first ? first.radius : 52;
    const R = 260 * Math.sqrt(r / 52) * l.scale;
    const key = Math.round(R);
    if (!this.spotGrad || key !== this.spotR) {
      const g = ctx.createRadialGradient(0, 0, R * 0.7, 0, 0, R);
      g.addColorStop(0, 'rgba(5, 7, 10, 0)');
      g.addColorStop(1, 'rgba(5, 7, 10, 0.94)');
      this.spotGrad = g;
      this.spotR = key;
    }
    const cx = l.ox + rs.cursorX * l.scale;
    const cy = l.oy + rs.cursorY * l.scale;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalAlpha = 1 - this.spotLift;
    ctx.fillStyle = this.spotGrad;
    ctx.fillRect(l.ox - cx, l.oy - cy, PLAYFIELD.width * l.scale, PLAYFIELD.height * l.scale);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawVignette(strength: number): void {
    const ctx = this.ctx;
    const l = this.pf.layout;
    if (!this.vigGrad || l.cssW !== this.vigW || l.cssH !== this.vigH) {
      const m = Math.hypot(l.cssW, l.cssH) / 2;
      const g = ctx.createRadialGradient(0, 0, m * 0.55, 0, 0, m);
      g.addColorStop(0, 'rgba(244, 63, 94, 0)');
      g.addColorStop(1, 'rgba(244, 63, 94, 1)');
      this.vigGrad = g;
      this.vigW = l.cssW;
      this.vigH = l.cssH;
    }
    ctx.save();
    ctx.translate(l.cssW / 2, l.cssH / 2);
    ctx.globalAlpha = 0.12 * strength;
    ctx.fillStyle = this.vigGrad;
    ctx.fillRect(-l.cssW / 2, -l.cssH / 2, l.cssW, l.cssH);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ----------------------------------------------------------------- HUD */

  private drawHud(rs: RenderState): void {
    const s = rs.session;
    const d = this.hudData;
    const first = s.objs[s.firstOpen]?.obj ?? s.objs[s.objs.length - 1]?.obj;
    d.showScore = rs.showScore;
    d.score = s.scoring.total(s.map.mods);
    d.combo = s.scoring.combo;
    d.accuracy = s.scoring.accuracy;
    d.health = s.map.health ? s.scoring.health : null;
    d.timeFraction = rs.lengthMs > 0 ? rs.playT / rs.lengthMs : 0;
    d.level = rs.level;
    d.set = rs.set;
    if (first) d.windows = first.windows;
    d.errorBar = rs.settings.display.errorBar;
    d.fps = rs.settings.display.showFps ? rs.fps : null;
    this.hud.draw(this.ctx, this.pf.layout, rs.fx, d, rs.now);
  }

  /* ----------------------------------------------------- banner, overlays */

  private drawBanner(rs: RenderState): void {
    const b = rs.fx.banner;
    if (!b) return;
    const ctx = this.ctx;
    const l = this.pf.layout;
    const u = (rs.now - b.t0) / (b.until - b.t0);
    if (u >= 1) {
      rs.fx.banner = null;
      return;
    }
    const a = u < 0.12 ? u / 0.12 : u > 0.8 ? (1 - u) / 0.2 : 1;
    ctx.globalAlpha = clamp01(a);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = l.ox + (PLAYFIELD.width * l.scale) / 2;
    const cy = l.oy + (PLAYFIELD.height * l.scale) / 2;
    ctx.font = F_BANNER;
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(b.title, cx, cy - 14 - (1 - clamp01(u / 0.12)) * 8);
    ctx.font = F_BANNER_SUB;
    ctx.fillStyle = COLORS.ink2;
    ctx.fillText(b.sub, cx, cy + 26);
    ctx.globalAlpha = 1;
  }

  private drawOverlay(rs: RenderState): void {
    if (rs.overlay === 'none') return;
    const ctx = this.ctx;
    const l = this.pf.layout;
    const w = PLAYFIELD.width * l.scale;
    const h = PLAYFIELD.height * l.scale;
    const cx = l.ox + w / 2;
    const cy = l.oy + h / 2;
    const age = rs.now - rs.overlayT0;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (rs.overlay === 'countdown') {
      // A ghost ring where the cursor was when the play paused.
      const cur = rs.session.cursor;
      if (cur.size > 0) {
        ctx.setLineDash(DASH);
        ctx.lineWidth = 2;
        ctx.strokeStyle = COLORS.ink;
        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(rs.now / 140);
        ctx.beginPath();
        ctx.arc(l.ox + cur.lastX * l.scale, l.oy + cur.lastY * l.scale, 20, 0, TAU);
        ctx.stroke();
        ctx.setLineDash(NO_DASH);
      }
      const left = Math.max(0, 1 - age / 1000);
      const digit = Math.min(3, Math.max(1, Math.ceil(left * 3)));
      const phase = (age % 333.4) / 333.4;
      ctx.globalAlpha = 0.9 - 0.5 * phase;
      ctx.font = F_BIG;
      ctx.fillStyle = COLORS.ink;
      ctx.save();
      ctx.translate(cx, cy);
      const k = 1.6 - 0.5 * phase;
      ctx.scale(k, k);
      ctx.fillText(STRINGS.countdown[digit] as string, 0, 0);
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }
    ctx.globalAlpha = rs.overlay === 'failing' ? Math.min(0.7, age / 400) : 0.62;
    ctx.fillStyle = rs.overlay === 'failing' ? '#2a0a12' : '#05070a';
    ctx.fillRect(l.ox, l.oy, w, h);
    ctx.globalAlpha = 1;
    if (rs.overlay === 'ready') {
      const pulse = 0.5 + 0.5 * Math.sin(rs.now / 380);
      ctx.globalAlpha = 0.25 + 0.3 * pulse;
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy - 6, 70 + 8 * pulse, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.font = F_TITLE;
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(STRINGS.start(rs.startLabel), cx, cy - 6);
      ctx.font = F_SUB;
      ctx.fillStyle = COLORS.ink2;
      ctx.fillText(rs.raw ? STRINGS.startRaw : STRINGS.startAbsolute, cx, cy + 34);
    } else if (rs.overlay === 'needsClick') {
      ctx.font = F_TITLE;
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(STRINGS.clickToContinue, cx, cy);
    } else {
      ctx.font = F_TITLE;
      ctx.fillStyle = COLORS.danger;
      ctx.globalAlpha = Math.min(1, age / 300);
      ctx.fillText(STRINGS.outOfHealth, cx, cy);
      ctx.globalAlpha = 1;
    }
  }

  /** A banner with text of its own. */
  static notice(title: string, sub: string, now: number): { title: string; sub: string; t0: number; until: number } {
    return { title, sub, t0: now, until: now + 3500 };
  }

  /** Banner for the end of a set. */
  static banner(direction: 'up' | 'down' | 'hold', from: number, to: number, now: number): { title: string; sub: string; t0: number; until: number } {
    const t = setChangeText(direction, from, to);
    return { title: t.title, sub: t.sub, t0: now, until: now + 1900 };
  }
}

const NUM_CACHE: string[] = [];
function numberText(n: number): string {
  let s = NUM_CACHE[n];
  if (s === undefined) {
    s = String(n);
    NUM_CACHE[n] = s;
  }
  return s;
}
let lastRpm = -1;
let lastRpmText = '0';
function rpmText(rpm: number): string {
  const r = Math.round(rpm);
  if (r !== lastRpm) {
    lastRpm = r;
    lastRpmText = String(r);
  }
  return lastRpmText;
}
