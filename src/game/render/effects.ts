// Hit bursts, sparks, miss marks, judgment pop-ups, click ripples and the state behind the HUD (PLAN-2 5.4).
// Every pool is a set of typed arrays sized once, so nothing is allocated while playing.

import { JUDGMENTS, SPINNER_RADIUS } from '../../shared/catalog';
import type { HitObject, Judgment } from '../../shared/types';
import type { FeedbackEvent } from '../engine/session';
import { F_BONUS, F_POP, F_POP_SUB, LABEL_DY, labelBelow, MISS_X, popupScale, POP_BOX, TextWidths } from './popup';
import { groupOf, JUDGE_INDEX, JUDGE_ORDER } from './skin';
import type { Skin } from './skin';
import { STRINGS } from './strings';
import { clamp01, COLORS, easeOut, FX } from './theme';

/** Slots in each pool. A full pool overwrites its oldest entry. */
export const POOL = { particles: 512, popups: 64, ripples: 16 } as const;
const N_BAR = 64;
const N_TRACK = 8;
const TAU = Math.PI * 2;

/** What a particle slot is. */
const Kind = { Spark: 0, Ring: 1, Body: 2, MissX: 3, Diamond: 4 } as const;
type Kind = (typeof Kind)[keyof typeof Kind];

export interface DisplayFlags {
  earlyLate: boolean;
  crispPopups: boolean;
  reduceMotion: boolean;
}

export interface Banner {
  title: string;
  sub: string;
  t0: number;
  until: number;
}

/** Colour index for a colour group, after the four judgment colours. */
const groupColorIndex = (group: number): number => 4 + groupOf(group);

export class Effects {
  /* Particles: sparks, rings, popped bodies, miss marks and tick diamonds in one pool. */
  private pOn = new Uint8Array(POOL.particles);
  private pKind = new Uint8Array(POOL.particles);
  private pCol = new Uint8Array(POOL.particles);
  private pX = new Float32Array(POOL.particles);
  private pY = new Float32Array(POOL.particles);
  private pA = new Float32Array(POOL.particles);
  private pB = new Float32Array(POOL.particles);
  private pC = new Float32Array(POOL.particles);
  private pD = new Float32Array(POOL.particles);
  private pT0 = new Float64Array(POOL.particles);
  private pDur = new Float32Array(POOL.particles);
  private pNext = 0;
  private pLive = 0;

  /* Pop-ups. */
  private uOn = new Uint8Array(POOL.popups);
  private uX = new Float32Array(POOL.popups);
  private uY = new Float32Array(POOL.popups);
  private uR = new Float32Array(POOL.popups);
  private uT0 = new Float64Array(POOL.popups);
  private uCol = new Uint8Array(POOL.popups);
  private uKind = new Uint8Array(POOL.popups);
  private uStill = new Uint8Array(POOL.popups);
  private uErr = new Int16Array(POOL.popups);
  private uLabelW = new Float32Array(POOL.popups);
  private uSub: string[] = new Array<string>(POOL.popups).fill('');
  private uNext = 0;
  private widths = new TextWidths();

  /* Click ripples, in playfield units. */
  private rOn = new Uint8Array(POOL.ripples);
  private rX = new Float32Array(POOL.ripples);
  private rY = new Float32Array(POOL.ripples);
  private rT0 = new Float64Array(POOL.ripples);
  private rNext = 0;

  /* Slider tracking changes, for the follow ring's grow and shrink. A slot per slider index modulo 8. */
  private trackIdx = new Int32Array(N_TRACK).fill(-1);
  private trackOnT = new Float64Array(N_TRACK);
  private trackOffT = new Float64Array(N_TRACK);

  /* HUD state */
  comboShown = 0;
  bumpT = -1e9;
  shakeT0 = -1e9;
  glowT0 = -1e9;
  lostValue = 0;
  lostT0 = -1e9;
  missVignetteT0 = -1e9;
  scoreShown = 0;
  /** Time of the last slider tick, for the follow ring pulse. */
  tickPulseT = -1e9;
  banner: Banner | null = null;
  spinHintShown = false;

  /* Error bar */
  readonly barErr = new Float32Array(N_BAR);
  readonly barT = new Float64Array(N_BAR);
  barCount = 0;
  private barHead = 0;
  barMean = 0;
  barHasMean = false;

  /** The sizes of the pools, which never change. */
  get capacity(): { particles: number; popups: number; ripples: number } {
    return { particles: this.pOn.length, popups: this.uOn.length, ripples: this.rOn.length };
  }

  /** Particles and pop-ups showing now. */
  get live(): { particles: number; popups: number; ripples: number } {
    let u = 0;
    let r = 0;
    for (let i = 0; i < this.uOn.length; i++) u += this.uOn[i] as number;
    for (let i = 0; i < this.rOn.length; i++) r += this.rOn[i] as number;
    return { particles: this.pLive, popups: u, ripples: r };
  }

  reset(): void {
    this.pOn.fill(0);
    this.pLive = 0;
    this.uOn.fill(0);
    this.rOn.fill(0);
    this.trackIdx.fill(-1);
    this.comboShown = 0;
    this.banner = null;
    this.barCount = 0;
    this.barHead = 0;
    this.barHasMean = false;
    this.scoreShown = 0;
  }

  /* ------------------------------------------------------------- spawning */

  private spawn(kind: Kind, x: number, y: number, a: number, b: number, c: number, d: number, now: number, dur: number, col: number): void {
    const i = this.pNext;
    this.pNext = (i + 1) % POOL.particles;
    if (!this.pOn[i]) this.pLive++;
    this.pOn[i] = 1;
    this.pKind[i] = kind;
    this.pX[i] = x;
    this.pY[i] = y;
    this.pA[i] = a;
    this.pB[i] = b;
    this.pC[i] = c;
    this.pD[i] = d;
    this.pT0[i] = now;
    this.pDur[i] = dur;
    this.pCol[i] = col;
  }

  private ring(x: number, y: number, r0: number, r1: number, now: number, dur: number, col: number, alpha: number, width: number): void {
    this.spawn(Kind.Ring, x, y, r0, r1, alpha, width, now, dur, col);
  }

  private sparks(x: number, y: number, n: number, r: number, reach: number, now: number, col: number): void {
    for (let k = 0; k < n; k++) {
      // The angle depends on where the burst is, so a replay shows the same sparks.
      this.spawn(Kind.Spark, x, y, (k / n) * TAU + (x * 7.31 + y * 3.17), r * 1.2, r * reach, 0, now, FX.sparks, col);
    }
  }

  private burst(x: number, y: number, r: number, j: Judgment, now: number, flags: DisplayFlags): void {
    const col = JUDGE_INDEX[j];
    if (j === 'crisp') {
      this.ring(x, y, r, r * 1.8, now, FX.ringCrisp, col, 1, 3);
      if (!flags.reduceMotion) this.sparks(x, y, 8, r, 2.6, now, col);
    } else if (j === 'solid') {
      this.ring(x, y, r, r * 1.5, now, FX.ringSolid, col, 1, 3);
      if (!flags.reduceMotion) this.sparks(x, y, 4, r, 2.2, now, col);
    } else if (j === 'rough') {
      this.ring(x, y, r, r * 1.3, now, FX.ringRough, col, 0.6, 3);
    }
  }

  private popup(x: number, y: number, r: number, now: number, col: number, kind: number, err: number, flags: DisplayFlags): void {
    const i = this.uNext;
    this.uNext = (i + 1) % POOL.popups;
    this.uOn[i] = 1;
    this.uX[i] = x;
    this.uY[i] = y;
    this.uR[i] = r;
    this.uT0[i] = now;
    this.uCol[i] = col;
    this.uKind[i] = kind;
    this.uStill[i] = flags.reduceMotion ? 1 : 0;
    this.uErr[i] = err;
    // The text is measured on the first frame it shows.
    this.uLabelW[i] = 0;
    this.uSub[i] = err !== 0 ? STRINGS.timing(err < 0 ? 'early' : 'late', Math.abs(err)) : '';
  }

  private judgmentPopup(x: number, y: number, r: number, j: Judgment, error: number, now: number, flags: DisplayFlags): void {
    if (j === 'crisp' && !flags.crispPopups) return;
    const err = flags.earlyLate && (j === 'solid' || j === 'rough') ? Math.round(error) || 0 : 0;
    this.popup(x, y, r, now, JUDGE_INDEX[j], 0, err, flags);
  }

  private missMark(x: number, y: number, r: number, now: number, flags: DisplayFlags): void {
    this.spawn(Kind.MissX, x, y, r, 0, 0, flags.reduceMotion ? 0 : MISS_X.rotFrom, now, FX.missX, 3);
    // A red outline flash around the target.
    this.ring(x, y, r, r, now, FX.missFlash, 3, 1, 3);
    this.popup(x, y, r, now, 3, 0, 0, flags);
    if (!flags.reduceMotion) this.missVignetteT0 = now;
  }

  /** A press: a ripple at the cursor. The caller leaves it out when ripples or motion are off. */
  ripple(x: number, y: number, now: number): void {
    const i = this.rNext;
    this.rNext = (i + 1) % POOL.ripples;
    this.rOn[i] = 1;
    this.rX[i] = x;
    this.rY[i] = y;
    this.rT0[i] = now;
  }

  /** Feed one session event. `obj` is the object it belongs to, when there is one. */
  onEvent(e: FeedbackEvent, now: number, obj: HitObject | null, flags: DisplayFlags): void {
    const r = obj ? obj.radius : 50;
    switch (e.type) {
      case 'hit': {
        const j = e.judgment as Judgment;
        this.burst(e.x, e.y, r, j, now, flags);
        if (obj && obj.kind === 'circle' && !flags.reduceMotion) {
          this.spawn(Kind.Body, e.x, e.y, r, 0, 0, 0, now, FX.bodyPop, groupColorIndex(obj.group));
        }
        this.judgmentPopup(e.x, e.y, r, j, e.value, now, flags);
        this.pushError(e.value, now);
        break;
      }
      case 'miss':
        this.missMark(e.x, e.y, r, now, flags);
        break;
      case 'tick':
      case 'repeat':
        this.tickPulseT = now;
        if (!flags.reduceMotion) this.spawn(Kind.Diamond, e.x, e.y, r * 0.18, 0, 0, 0, now, FX.tickPop, obj ? groupColorIndex(obj.group) : 7);
        this.ring(e.x, e.y, r * 0.14, r * 0.5, now, FX.tickPop, obj ? groupColorIndex(obj.group) : 7, 0.8, 2);
        break;
      case 'tickMiss':
      case 'repeatMiss':
      case 'endMiss':
        this.ring(e.x, e.y, r * 0.14, r * 0.4, now, 200, 3, 0.9, 2);
        if (!flags.reduceMotion && e.type !== 'tickMiss') this.missVignetteT0 = now;
        break;
      case 'trackOn': {
        const s = this.trackSlot(e.index);
        this.trackOnT[s] = now;
        this.trackOffT[s] = -1e9;
        break;
      }
      case 'trackOff':
        this.trackOffT[this.trackSlot(e.index)] = now;
        break;
      case 'sliderDone': {
        const j = e.judgment as Judgment;
        this.burst(e.x, e.y, r, j, now, flags);
        // The error is 0, so the early/late flag changes nothing here and the flags go through as they are.
        if (j !== 'crisp') this.judgmentPopup(e.x, e.y, r, j, 0, now, flags);
        break;
      }
      case 'spinDone': {
        const j = e.judgment as Judgment;
        if (j !== 'miss') this.ring(e.x, e.y, SPINNER_RADIUS, SPINNER_RADIUS * 1.25, now, FX.ringCrisp, JUDGE_INDEX[j], 0.9, 4);
        this.judgmentPopup(e.x, e.y - 40, 28, j, 0, now, flags);
        break;
      }
      case 'spinBonus':
        this.popup(e.x, e.y - 60, 0, now, 0, 1, 0, flags);
        break;
      case 'comboBreak':
        this.lostValue = e.value;
        this.lostT0 = now;
        if (!flags.reduceMotion) this.shakeT0 = now;
        break;
      case 'milestone':
        this.glowT0 = now;
        break;
      default:
        break;
    }
  }

  private trackSlot(index: number): number {
    const s = index & (N_TRACK - 1);
    if (this.trackIdx[s] !== index) {
      this.trackIdx[s] = index;
      this.trackOnT[s] = -1e9;
      this.trackOffT[s] = -1e9;
    }
    return s;
  }

  /**
   * Size and alpha of the follow ring of slider `index`: it grows in over 120 ms when tracking starts, and shrinks
   * and fades over 150 ms when it is lost. `scale` 0 means nothing to draw.
   */
  followRing(index: number, tracking: boolean, now: number, out: { scale: number; alpha: number }): void {
    const s = index & (N_TRACK - 1);
    const known = this.trackIdx[s] === index;
    if (tracking) {
      const u = known ? clamp01((now - (this.trackOnT[s] as number)) / FX.trackIn) : 1;
      out.scale = 0.55 + 0.45 * easeOut(u);
      out.alpha = u;
      return;
    }
    const u = known ? (now - (this.trackOffT[s] as number)) / FX.trackOut : 1;
    if (u >= 1 || u < 0) {
      out.scale = 0;
      out.alpha = 0;
      return;
    }
    out.scale = 1 - 0.3 * u;
    out.alpha = 1 - u;
  }

  private pushError(err: number, now: number): void {
    const i = (this.barHead + this.barCount) % N_BAR;
    if (this.barCount < N_BAR) this.barCount++;
    else this.barHead = (this.barHead + 1) % N_BAR;
    this.barErr[i] = err;
    this.barT[i] = now;
    this.barMean = this.barHasMean ? this.barMean + 0.12 * (err - this.barMean) : err;
    this.barHasMean = true;
  }

  /** Index into the error bar ring for the k-th oldest tick. */
  barIndex(k: number): number {
    return (this.barHead + k) % N_BAR;
  }

  /* ------------------------------------------------------------ drawing */

  /** Popped bodies, rings, sparks, miss marks and tick diamonds, in playfield units. */
  drawField(ctx: CanvasRenderingContext2D, now: number, skin: Skin): void {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const fx = skin.fx;
    // Three passes, so bodies sit under rings, and rings under sparks and marks.
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < POOL.particles; i++) {
        if (!this.pOn[i]) continue;
        const u = (now - (this.pT0[i] as number)) / (this.pDur[i] as number);
        if (u >= 1) {
          this.pOn[i] = 0;
          this.pLive--;
          continue;
        }
        if (u < 0) continue;
        const kind = this.pKind[i] as Kind;
        const x = this.pX[i] as number;
        const y = this.pY[i] as number;
        const col = fx[this.pCol[i] as number] as string;
        if (pass === 0) {
          if (kind !== Kind.Body) continue;
          // The body pops to 1.12x and fades over 120 ms.
          ctx.globalAlpha = 0.85 * (1 - u);
          ctx.fillStyle = COLORS.body;
          ctx.beginPath();
          ctx.arc(x, y, (this.pA[i] as number) * (1 + 0.12 * easeOut(u)), 0, TAU);
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = col;
          ctx.stroke();
        } else if (pass === 1) {
          if (kind === Kind.Ring) {
            const r0 = this.pA[i] as number;
            const r = r0 + ((this.pB[i] as number) - r0) * easeOut(u);
            ctx.globalAlpha = (this.pC[i] as number) * (1 - u);
            ctx.lineWidth = (this.pD[i] as number) * (1 - 0.5 * u);
            ctx.strokeStyle = col;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, TAU);
            ctx.stroke();
          } else if (kind === Kind.Diamond) {
            const d = (this.pA[i] as number) * (1 + 0.9 * easeOut(u));
            ctx.globalAlpha = 0.95 * (1 - u);
            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.moveTo(x, y - d);
            ctx.lineTo(x + d, y);
            ctx.lineTo(x, y + d);
            ctx.lineTo(x - d, y);
            ctx.closePath();
            ctx.fill();
          }
        } else if (kind === Kind.Spark) {
          const d0 = this.pB[i] as number;
          const d = d0 + ((this.pC[i] as number) - d0) * (1 - (1 - u) * (1 - u));
          const a = this.pA[i] as number;
          const cx = Math.cos(a);
          const cy = Math.sin(a);
          const len = 9 * (1 - u);
          ctx.globalAlpha = 1 - u;
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = col;
          ctx.beginPath();
          ctx.moveTo(x + cx * d, y + cy * d);
          ctx.lineTo(x + cx * (d + len), y + cy * (d + len));
          ctx.stroke();
        } else if (kind === Kind.MissX) {
          // An X of half 0.5r that turns in from 20 degrees over 120 ms, holds, and fades.
          const turn = clamp01((now - (this.pT0[i] as number)) / FX.missTurn);
          const ang = (this.pD[i] as number) * (1 - easeOut(turn));
          const k = (this.pA[i] as number) * MISS_X.half;
          const c = Math.cos(ang) * k;
          const s = Math.sin(ang) * k;
          ctx.globalAlpha = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
          ctx.lineWidth = MISS_X.stroke;
          ctx.strokeStyle = col;
          ctx.beginPath();
          ctx.moveTo(x - c + s, y - s - c);
          ctx.lineTo(x + c - s, y + s + c);
          ctx.moveTo(x + c + s, y + s - c);
          ctx.lineTo(x - c - s, y - s + c);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Judgment pop-ups, in playfield units. Measures a pop-up's text the first frame it shows. */
  drawPopups(ctx: CanvasRenderingContext2D, now: number, skin: Skin): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < POOL.popups; i++) {
      if (!this.uOn[i]) continue;
      const age = now - (this.uT0[i] as number);
      const u = age / FX.popup;
      if (u >= 1) {
        this.uOn[i] = 0;
        continue;
      }
      if (u < 0) continue;
      const kind = this.uKind[i] as number;
      const r = this.uR[i] as number;
      const rise = this.uStill[i] ? 0 : FX.popupRise * easeOut(u);
      const x = this.uX[i] as number;
      // The label sits 1.35r above the centre of its target, so it clears the miss mark. Near the top of the field it
      // goes 1.35r below instead, so it stays out of the HUD band.
      const ty = this.uY[i] as number;
      const y = kind === 1 ? ty - rise : labelBelow(ty, r) ? ty + LABEL_DY * r + rise : ty - LABEL_DY * r - rise;
      const alpha = u < 0.65 ? 1 : 1 - (u - 0.65) / 0.35;
      const col = skin.fx[this.uCol[i] as number] as string;
      const scale = this.uStill[i] ? 1 : popupScale(age);
      ctx.globalAlpha = alpha;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      if (kind === 1) {
        ctx.font = F_BONUS;
        ctx.fillStyle = col;
        ctx.fillText(STRINGS.bonus, 0, 0);
        ctx.restore();
        continue;
      }
      if (this.uLabelW[i] === 0) this.measure(ctx, i);
      const w = this.uLabelW[i] as number;
      // A dark plate keeps the label readable over bodies and bursts.
      ctx.globalAlpha = alpha * 0.55;
      ctx.fillStyle = COLORS.bg;
      plate(ctx, w + 12, POP_BOX.labelH);
      ctx.globalAlpha = alpha;
      ctx.font = F_POP;
      ctx.fillStyle = col;
      ctx.fillText(JUDGMENTS[JUDGE_ORDER[this.uCol[i] as number] as Judgment].label, 0, 0.5);
      const sub = this.uSub[i] as string;
      if (sub !== '') {
        ctx.font = F_POP_SUB;
        ctx.fillStyle = COLORS.ink2;
        ctx.fillText(sub, 0, POP_BOX.subDy);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  private measure(ctx: CanvasRenderingContext2D, i: number): void {
    const label = JUDGMENTS[JUDGE_ORDER[this.uCol[i] as number] as Judgment].label;
    this.uLabelW[i] = Math.max(1, this.widths.width(ctx, F_POP, label));
  }

  /** The click ripples, in CSS pixels. `ox`, `oy` and `scale` place the field on the canvas. */
  drawRipples(ctx: CanvasRenderingContext2D, now: number, ox: number, oy: number, scale: number, color: string): void {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    for (let i = 0; i < POOL.ripples; i++) {
      if (!this.rOn[i]) continue;
      const u = (now - (this.rT0[i] as number)) / FX.ripple;
      if (u >= 1) {
        this.rOn[i] = 0;
        continue;
      }
      if (u < 0) continue;
      ctx.globalAlpha = 0.5 * (1 - u);
      ctx.beginPath();
      ctx.arc(ox + (this.rX[i] as number) * scale, oy + (this.rY[i] as number) * scale, 6 + 12 * easeOut(u), 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Vignette strength 0..1 for the miss flash. */
  vignette(now: number): number {
    const u = (now - this.missVignetteT0) / FX.missVignette;
    return u < 0 || u >= 1 ? 0 : 1 - u;
  }

  /** Horizontal and vertical offset for HUD text while the combo shakes. */
  shake(now: number, out: { x: number; y: number }): void {
    const u = (now - this.shakeT0) / FX.comboShake;
    if (u < 0 || u >= 1) {
      out.x = 0;
      out.y = 0;
      return;
    }
    const k = (1 - u) * 5;
    out.x = Math.sin(now * 0.11) * k;
    out.y = Math.cos(now * 0.083) * k * 0.6;
  }
}

/** A rounded plate centred on the origin. */
function plate(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(-w / 2 + r, -h / 2);
  ctx.lineTo(w / 2 - r, -h / 2);
  ctx.arc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(-w / 2 + r, h / 2);
  ctx.arc(-w / 2 + r, 0, r, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.closePath();
  ctx.fill();
}
