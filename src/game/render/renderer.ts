// The draw passes, in the order PLAN-2 5.4 lists them. One canvas, no allocation per frame.

import { DEFAULT_SETTINGS, PLAYFIELD, PLAYFIELD_CENTER, SPINNER_RADIUS } from '../../shared/catalog';
import type { Settings, SliderObject, SpinnerObject, Vec2 } from '../../shared/types';
import type { Playfield } from '../engine/playfield';
import type { GameSession, ObjState } from '../engine/session';
import { tangentAt } from '../map/path';
import type { FlatPath } from '../map/path';
import { ballPos } from '../rules/slider';
import { followAlpha, followReveal, followSegment, followWanted, reversePulse } from './approach';
import type { ApproachShape, FollowSegment } from './approach';
import { drawCursor } from './cursor';
import type { Effects } from './effects';
import type { FrameStats } from './frameStats';
import { Hud } from './hud';
import type { HudData } from './hud';
import { drawApproachIndicator } from './indicator';
import { buildFieldBackground, defaultCanvasFactory, FIELD_PAD, SpriteCache } from './objects';
import type { CanvasFactory } from './objects';
import { groupOf, resolveSkin } from './skin';
import type { Skin } from './skin';
import { setChangeText, STRINGS } from './strings';
import { applyCanvasTheme, canvasThemeFor, clamp01, COLORS, FONT } from './theme';
import type { ThemeId } from '../../shared/theme';

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
  /** Sets in the play when the ring counts sets done instead of time (placement). */
  ringSets?: number | null;
  /** How far the quick retry hold has got, 0..1. 0 hides the bar. */
  retry?: number;
  /** Frame times for the frame graph. Drawn only when the setting is on. */
  frames?: FrameStats | null;
}

/** How full the HUD ring is: sets done out of `ringSets` when given, else play time out of the length. */
export function ringFraction(playT: number, lengthMs: number, set: number | null, ringSets: number | null | undefined): number {
  if (ringSets && ringSets > 0) return set === null ? 0 : Math.min(1, Math.max(0, set / ringSets));
  return lengthMs > 0 ? playT / lengthMs : 0;
}

const TAU = Math.PI * 2;
const DASH: number[] = [6, 8];
const FOLLOW_DASH: number[] = [6, 10];
const NO_DASH: number[] = [];
const RPM_REQ_MARK = 1 / 1.5;

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

const F_BIG = `700 34px ${FONT}`;
const F_TITLE = `700 30px ${FONT}`;
const F_SUB = `500 15px ${FONT}`;
const F_RPM = `700 54px ${FONT}`;
const F_RPM_LABEL = `500 15px ${FONT}`;
const F_HINT = `500 16px ${FONT}`;
const F_BANNER = `700 44px ${FONT}`;
const F_BANNER_SUB = `600 19px ${FONT}`;

const SPEED_SWEEP = TAU * 0.75;
const SPEED_START = Math.PI * 0.75;

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
  private settings: Settings | null = null;
  private theme: ThemeId = 'dark';
  private skin: Skin = resolveSkin(DEFAULT_SETTINGS, 'dark');
  private bg: HTMLCanvasElement | null = null;
  private bgW = 0;
  private bgH = 0;
  private bgDpr = 0;
  private bgKey = '';
  private spotGrad: CanvasGradient | null = null;
  private spotR = 0;
  private vigGrad: CanvasGradient | null = null;
  private vigW = 0;
  private vigH = 0;
  private visible = new Int32Array(256);
  private tmp: Vec2 = { x: 0, y: 0 };
  private shape: ApproachShape = { size: 0, rot: 0, alpha: 0 };
  private seg: FollowSegment = { x0: 0, y0: 0, x1: 0, y1: 0, length: 0 };
  private ringOut = { scale: 0, alpha: 0 };
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
    retry: 0,
    frames: null,
    frameBudgetMs: null,
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

  /** The skin in use, resolved from the settings of the last frame. */
  get currentSkin(): Skin {
    return this.skin;
  }

  /**
   * Resolve the skin from new settings. The renderer also does this by itself when a frame comes with settings it
   * has not seen, so calling it is only needed to do the work ahead of the next frame.
   */
  setSettings(s: Settings): void {
    const theme = canvasThemeFor(s);
    if (s === this.settings && theme === this.theme) return;
    applyCanvasTheme(theme);
    const next = resolveSkin(s, theme);
    if (next.bitmapKey !== this.skin.bitmapKey) {
      this.sprites.clear();
      this.bg = null;
      this.spotGrad = null;
    }
    if (next.judge[3] !== this.skin.judge[3]) this.vigGrad = null;
    this.skin = next;
    this.settings = s;
    this.theme = theme;
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
    if (rs.settings !== this.settings || canvasThemeFor(rs.settings) !== this.theme) this.setSettings(rs.settings);
    const ctx = this.ctx;
    const pf = this.pf;
    const skin = this.skin;
    const l = pf.layout;
    const dpr = pf.dpr;
    const ppu = dpr * l.scale;
    // Objects, approach indicators, follow points and slider balls are drawn at play time plus the visual offset.
    // The HUD, the cursor, the effects and the judging use plain play time.
    const tv = rs.playT + rs.settings.display.visualOffsetMs;

    // 1. Background and field.
    pf.setHudTransform(ctx);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, l.cssW, l.cssH);
    if (!this.bg || l.cssW !== this.bgW || l.cssH !== this.bgH || dpr !== this.bgDpr || this.bgKey !== skin.bitmapKey) {
      this.bg = buildFieldBackground(this.make, ppu, dpr, skin.fieldGrid);
      this.bgW = l.cssW;
      this.bgH = l.cssH;
      this.bgDpr = dpr;
      this.bgKey = skin.bitmapKey;
    }
    const pad = FIELD_PAD * l.scale;
    ctx.drawImage(this.bg, l.ox - pad, l.oy - pad, PLAYFIELD.width * l.scale + 2 * pad, PLAYFIELD.height * l.scale + 2 * pad);

    // 2 to 9, in playfield units.
    pf.setFieldTransform(ctx);
    this.drawObjects(rs, ppu, tv);
    rs.fx.drawField(ctx, rs.now, skin);
    rs.fx.drawPopups(ctx, rs.now, skin);

    // 10. Spotlight.
    pf.setHudTransform(ctx);
    if (rs.session.map.mods.includes('spotlight')) this.drawSpotlight(rs);

    // 11. HUD.
    this.drawHud(rs);

    // Edge flash for a miss.
    const vig = rs.fx.vignette(rs.now);
    if (vig > 0) this.drawVignette(vig);

    // 12. Cursor, trail and click ripples.
    if (rs.drawCursor) {
      const input = rs.settings.input;
      drawCursor(
        ctx,
        l,
        rs.cursorX,
        rs.cursorY,
        input.cursorScale,
        skin.cursorStyle,
        input.cursorTrail ? { buf: rs.session.cursor, now: rs.now } : null,
      );
    }
    rs.fx.drawRipples(ctx, rs.now, l.ox, l.oy, l.scale, COLORS.ink);

    // 13 and 14. Banner and overlays.
    this.drawBanner(rs);
    this.drawOverlay(rs);
    this.lastNow = rs.now;
  }

  /* ------------------------------------------------------------- objects */

  private drawObjects(rs: RenderState, ppu: number, tv: number): void {
    const ctx = this.ctx;
    const skin = this.skin;
    const s = rs.session;
    const objs = s.objs;
    const mods = s.map.mods;
    const fade = mods.includes('fade');
    // Fade and No Rings both draw no approach indicator.
    const indicators = !fade && !mods.includes('norings');
    const bullseye = mods.includes('bullseye');
    // Sliders that are finished no longer need their body bitmap.
    if (s.firstOpen !== this.droppedTo) {
      this.sprites.dropBodiesBelow(s.firstOpen);
      this.droppedTo = s.firstOpen;
    }
    let n = 0;
    for (let i = s.firstOpen; i < objs.length; i++) {
      const st = objs[i] as ObjState;
      const o = st.obj;
      if (o.time - o.approachMs > tv) break;
      if (st.done) continue;
      if (n < 256) this.visible[n++] = i;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 2. Follow points between neighbours.
    if (rs.settings.display.pathHints) this.drawFollowPoints(rs, tv, fade);

    // 3. Slider bodies, ticks and reversals.
    const pulse = reversePulse(tv, s.map.beatMs, s.map.beatOffsetMs);
    for (let k = 0; k < n; k++) {
      const st = objs[this.visible[k] as number] as ObjState;
      if (st.obj.kind !== 'slider' || !st.slider) continue;
      this.drawSliderBody(st, st.obj, tv, fade, ppu, pulse);
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
      const u = (tv - (o.time - o.approachMs)) / o.approachMs;
      let a = clamp01((tv - (o.time - o.approachMs)) / Math.min(300, o.approachMs * 0.33));
      if (fade) a = Math.min(a, fadeAlpha(u));
      if (a <= 0.003) continue;
      const sp = this.sprites.target(skin, o.group, o.radius, ppu, bullseye);
      ctx.globalAlpha = a;
      ctx.drawImage(sp.canvas, o.pos.x - sp.half, o.pos.y - sp.half, sp.half * 2, sp.half * 2);
      ctx.font = numberFont(o.radius);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = COLORS.ink;
      ctx.globalAlpha = a * 0.92;
      ctx.fillText(numberText(o.number), o.pos.x, o.pos.y + o.radius * 0.04);
      if (k === next && !fade) {
        ctx.globalAlpha = a * 0.45;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = COLORS.ink;
        ctx.beginPath();
        ctx.arc(o.pos.x, o.pos.y, o.radius + 6, 0, TAU);
        ctx.stroke();
      }
    }

    // 5. Approach indicators.
    if (indicators) {
      for (let k = 0; k < n; k++) {
        const st = objs[this.visible[k] as number] as ObjState;
        const o = st.obj;
        if (o.kind === 'spinner' || st.target.judged) continue;
        const u = (tv - (o.time - o.approachMs)) / o.approachMs;
        if (u < 0 || u > 1.02) continue;
        this.drawApproach(o.pos.x, o.pos.y, o.radius, o.group, u, k === next);
      }
    }
    ctx.globalAlpha = 1;

    // 6. Slider balls and follow rings.
    for (let k = 0; k < n; k++) {
      const st = objs[this.visible[k] as number] as ObjState;
      if (st.obj.kind === 'slider' && st.slider) this.drawBall(st, st.obj, tv, rs);
    }

    // 7. Spinner.
    for (let k = 0; k < n; k++) {
      const st = objs[this.visible[k] as number] as ObjState;
      if (st.obj.kind === 'spinner') this.drawSpinner(st, st.obj, rs, tv);
    }
    ctx.globalAlpha = 1;
  }

  /** Dashed lines between consecutive objects, growing from the earlier one toward the later one. */
  private drawFollowPoints(rs: RenderState, tv: number, fade: boolean): void {
    const ctx = this.ctx;
    const s = rs.session;
    const objs = s.objs;
    ctx.setLineDash(FOLLOW_DASH);
    ctx.lineWidth = 2;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = COLORS.ink;
    for (let k = Math.max(0, s.firstOpen - 2); k < objs.length - 1; k++) {
      const sa = objs[k] as ObjState;
      const sb = objs[k + 1] as ObjState;
      const b = sb.obj;
      if (b.time - b.approachMs > tv) break;
      if (sb.target.judged) continue;
      const a = sa.obj;
      if (!followWanted(a, b)) continue;
      const reveal = followReveal((tv - (b.time - b.approachMs)) / b.approachMs);
      if (reveal <= 0) continue;
      let alpha = 1;
      if (sa.done) alpha = followAlpha(rs.playT - (a.kind === 'slider' ? Math.max(sa.judgeT, a.endTime) : sa.judgeT));
      if (alpha <= 0 || !followSegment(a, b, reveal, this.seg)) continue;
      ctx.globalAlpha = 0.42 * alpha * (fade ? 0.6 : 1);
      ctx.beginPath();
      ctx.moveTo(this.seg.x0, this.seg.y0);
      ctx.lineTo(this.seg.x1, this.seg.y1);
      ctx.stroke();
    }
    ctx.setLineDash(NO_DASH);
    ctx.lineCap = 'round';
    ctx.globalAlpha = 1;
  }

  /** One approach indicator in the style of the skin. */
  private drawApproach(x: number, y: number, r: number, group: number, u: number, isNext: boolean): void {
    drawApproachIndicator(this.ctx, this.skin, this.shape, x, y, r, group, u, isNext);
  }

  private drawSliderBody(st: ObjState, o: SliderObject, tv: number, fade: boolean, ppu: number, pulse: number): void {
    const ctx = this.ctx;
    const skin = this.skin;
    const run = st.slider;
    if (!run) return;
    if (tv < o.time - o.approachMs - 400) return;
    const u = (tv - (o.time - o.approachMs)) / o.approachMs;
    let a = clamp01((tv - (o.time - o.approachMs)) / Math.min(300, o.approachMs * 0.33));
    if (fade) a = Math.min(a, fadeAlpha(u));
    if (a <= 0.003) return;
    const body = this.sprites.sliderBody(skin, o.index, run.geom, o.group, ppu);
    if (!body) return;
    ctx.globalAlpha = a * 0.92;
    ctx.drawImage(body.canvas, body.x, body.y, body.w, body.h);
    // Ticks are diamonds, and reversals are double chevrons that pulse on the beat.
    const g = run.geom;
    const d = o.radius * 0.18;
    for (let c = 0; c < g.checkT.length; c++) {
      const kind = g.checkKind[c] as number;
      const status = run.checkStatus[c] as number;
      if (kind === 3 || status === 1) continue;
      const x = g.checkX[c] as number;
      const y = g.checkY[c] as number;
      if (kind === 1) {
        ctx.globalAlpha = a * 0.9;
        ctx.fillStyle = status === 2 ? (skin.judge[3] as string) : COLORS.ink;
        ctx.beginPath();
        ctx.moveTo(x, y - d);
        ctx.lineTo(x + d, y);
        ctx.lineTo(x, y + d);
        ctx.lineTo(x - d, y);
        ctx.closePath();
        ctx.fill();
      } else if (status === 0) {
        this.drawChevrons(g.flat, o, x, y, a, pulse);
      }
    }
  }

  /** A double chevron at a reversal point, along the end tangent and pointing the way the ball will go. */
  private drawChevrons(flat: FlatPath, o: SliderObject, x: number, y: number, a: number, pulse: number): void {
    const ctx = this.ctx;
    const atEnd =
      Math.hypot(x - (flat.xs[flat.n - 1] as number), y - (flat.ys[flat.n - 1] as number)) <
      Math.hypot(x - (flat.xs[0] as number), y - (flat.ys[0] as number));
    tangentAt(flat, atEnd ? flat.length : 0, this.tmp);
    const dir = atEnd ? -1 : 1;
    const dx = this.tmp.x * dir;
    const dy = this.tmp.y * dir;
    const k = o.radius * 0.36 * (1 + 0.22 * pulse);
    const px = -dy;
    const py = dx;
    ctx.globalAlpha = a * (0.7 + 0.3 * pulse);
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.ink;
    ctx.beginPath();
    for (let c = 0; c < 2; c++) {
      // The two chevrons sit one step apart along the tangent.
      const off = (c - 0.5) * k * 0.9;
      const cx = x + dx * off;
      const cy = y + dy * off;
      ctx.moveTo(cx - dx * k * 0.2 + px * k, cy - dy * k * 0.2 + py * k);
      ctx.lineTo(cx + dx * k * 0.5, cy + dy * k * 0.5);
      ctx.lineTo(cx - dx * k * 0.2 - px * k, cy - dy * k * 0.2 - py * k);
    }
    ctx.stroke();
  }

  private drawBall(st: ObjState, o: SliderObject, tv: number, rs: RenderState): void {
    const ctx = this.ctx;
    const skin = this.skin;
    const run = st.slider;
    if (!run || tv < o.time) return;
    ballPos(run.geom, Math.min(tv, o.endTime), this.tmp);
    const x = this.tmp.x;
    const y = this.tmp.y;
    const g4 = groupOf(o.group);
    const color = skin.groups[g4] as string;
    const tracking = run.tracking;
    // The follow ring grows in when tracking starts, and shrinks and fades when it is lost.
    rs.fx.followRing(o.index, tracking, rs.now, this.ringOut);
    if (this.ringOut.scale > 0) {
      const pulse = tracking ? clamp01(1 - (rs.now - rs.fx.tickPulseT) / 160) : 0;
      ctx.globalAlpha = this.ringOut.alpha * (0.55 + 0.3 * pulse);
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, o.followRadius * this.ringOut.scale * (1 + 0.05 * pulse), 0, TAU);
      ctx.stroke();
    }
    // The ball: 0.9r in the group colour with a 2-unit rim.
    ctx.globalAlpha = tracking ? 1 : 0.7;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, o.radius * 0.9, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
    ctx.fillStyle = COLORS.bodyDeep;
    ctx.globalAlpha = tracking ? 0.55 : 0.4;
    ctx.beginPath();
    ctx.arc(x, y, o.radius * 0.28, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawSpinner(st: ObjState, o: SpinnerObject, rs: RenderState, tv: number): void {
    const ctx = this.ctx;
    const skin = this.skin;
    const run = st.spinner;
    if (!run) return;
    const t = rs.playT;
    const appear = clamp01((tv - (o.time - o.approachMs)) / 400);
    if (appear <= 0) return;
    const cx = PLAYFIELD_CENTER.x;
    const cy = PLAYFIELD_CENTER.y;
    const R = SPINNER_RADIUS;
    const active = t >= o.time;
    const q = o.rotationsRequired > 0 ? run.rotations / o.rotationsRequired : 1;
    const done = q >= 1;
    const lit = done ? (skin.judge[0] as string) : COLORS.data;
    ctx.globalAlpha = appear;
    ctx.lineCap = 'round';
    // The ring.
    ctx.lineWidth = 6;
    ctx.strokeStyle = COLORS.body;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.fieldEdge;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 4, 0, TAU);
    ctx.arc(cx, cy, R - 4, 0, TAU);
    ctx.stroke();
    // 24 radial ticks, lit in order up to the share of the turns done.
    const share = clamp01(q);
    ctx.lineCap = 'butt';
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.tickDim;
    ctx.beginPath();
    for (let k = 0; k < 24; k++) {
      if (k / 24 < share) continue;
      const a = -Math.PI / 2 + (k / 24) * TAU;
      ctx.moveTo(cx + Math.cos(a) * (R - 30), cy + Math.sin(a) * (R - 30));
      ctx.lineTo(cx + Math.cos(a) * (R - 14), cy + Math.sin(a) * (R - 14));
    }
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.strokeStyle = lit;
    ctx.beginPath();
    for (let k = 0; k < 24; k++) {
      if (k / 24 >= share) break;
      const a = -Math.PI / 2 + (k / 24) * TAU;
      ctx.moveTo(cx + Math.cos(a) * (R - 32), cy + Math.sin(a) * (R - 32));
      ctx.lineTo(cx + Math.cos(a) * (R - 12), cy + Math.sin(a) * (R - 12));
    }
    ctx.stroke();
    ctx.lineCap = 'round';
    // Time left, a hairline inside the ticks.
    const left = active ? clamp01((o.endTime - t) / (o.endTime - o.time)) : 1;
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.spinTime;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 46, -Math.PI / 2, -Math.PI / 2 + TAU * left);
    ctx.stroke();
    // The speed arc outside the ring, from 0 to 1.5 times the required rpm, with the required rpm marked.
    const rpm = active ? run.rpmAt(t) : 0;
    const reqRpm = (o.rotationsRequired * 60000) / Math.max(1, o.endTime - o.time);
    const fill = reqRpm > 0 ? clamp01(rpm / (1.5 * reqRpm)) : 0;
    const AR = R + 22;
    ctx.lineWidth = 6;
    ctx.strokeStyle = COLORS.body;
    ctx.beginPath();
    ctx.arc(cx, cy, AR, SPEED_START, SPEED_START + SPEED_SWEEP);
    ctx.stroke();
    if (fill > 0.004) {
      ctx.strokeStyle = lit;
      ctx.beginPath();
      ctx.arc(cx, cy, AR, SPEED_START, SPEED_START + SPEED_SWEEP * fill);
      ctx.stroke();
    }
    const ma = SPEED_START + SPEED_SWEEP * RPM_REQ_MARK;
    ctx.lineCap = 'butt';
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.ink;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ma) * (AR - 8), cy + Math.sin(ma) * (AR - 8));
    ctx.lineTo(cx + Math.cos(ma) * (AR + 8), cy + Math.sin(ma) * (AR + 8));
    ctx.stroke();
    ctx.lineCap = 'round';
    if (active) {
      // The needle points at the cursor.
      const na = Math.atan2(rs.cursorY - cy, rs.cursorX - cx);
      const held = rs.session.mask !== 0;
      ctx.globalAlpha = appear * (held ? 1 : 0.5);
      ctx.lineWidth = 3;
      ctx.strokeStyle = COLORS.ink;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(na) * 70, cy + Math.sin(na) * 70);
      ctx.lineTo(cx + Math.cos(na) * (R - 56), cy + Math.sin(na) * (R - 56));
      ctx.stroke();
      ctx.fillStyle = lit;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(na) * (R - 56), cy + Math.sin(na) * (R - 56), 5, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = appear;
      // Speed in the middle.
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = F_RPM;
      ctx.fillStyle = done ? lit : COLORS.ink;
      ctx.fillText(rpmText(rpm), cx, cy - 6);
      ctx.font = F_RPM_LABEL;
      ctx.fillStyle = COLORS.ink2;
      ctx.fillText(STRINGS.rpmLabel, cx, cy + 32);
    }
    // The hint, once per play.
    if (!rs.fx.spinHintShown) {
      if (active && run.rotations > 0.6) rs.fx.spinHintShown = true;
      else {
        ctx.font = F_HINT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = COLORS.ink2;
        ctx.fillText(STRINGS.spinnerHint, cx, cy + R + 56);
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
      g.addColorStop(0, COLORS.spotClear);
      g.addColorStop(1, COLORS.spot);
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
      g.addColorStop(0, this.skin.missClear);
      g.addColorStop(1, this.skin.missSolid);
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
    d.timeFraction = ringFraction(rs.playT, rs.lengthMs, rs.set, rs.ringSets);
    d.level = rs.level;
    d.set = rs.set;
    if (first) d.windows = first.windows;
    d.errorBar = rs.settings.display.errorBar;
    d.fps = rs.settings.display.showFps ? rs.fps : null;
    d.retry = rs.retry ?? 0;
    d.frames = rs.settings.display.frameGraph ? (rs.frames ?? null) : null;
    d.frameBudgetMs = rs.fps !== null && rs.fps > 0 ? 1000 / rs.fps : null;
    this.hud.draw(this.ctx, this.pf.layout, rs.fx, d, rs.now, this.skin);
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
    ctx.globalAlpha = rs.overlay === 'failing' ? Math.min(0.7, age / 400) : 0.66;
    ctx.fillStyle = rs.overlay === 'failing' ? COLORS.failing : COLORS.bg;
    ctx.fillRect(l.ox, l.oy, w, h);
    ctx.globalAlpha = 1;
    if (rs.overlay === 'ready') {
      const pulse = 0.5 + 0.5 * Math.sin(rs.now / 380);
      ctx.globalAlpha = 0.25 + 0.3 * pulse;
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy - 64, 30 + 6 * pulse, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = COLORS.accent;
      ctx.beginPath();
      ctx.arc(cx, cy - 64, 5, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.font = F_TITLE;
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(STRINGS.start(rs.startLabel), cx, cy + 10);
      ctx.font = F_SUB;
      ctx.fillStyle = COLORS.ink2;
      ctx.fillText(rs.raw ? STRINGS.startRaw : STRINGS.startAbsolute, cx, cy + 50);
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
  static banner(
    direction: 'up' | 'down' | 'hold',
    from: number,
    to: number,
    now: number,
  ): { title: string; sub: string; t0: number; until: number } {
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
