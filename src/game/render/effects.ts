// Hit bursts, sparks, miss marks, judgment pop-ups and the state behind the HUD.
// Every pool is a set of typed arrays sized once, so nothing is allocated while playing.

import { JUDGMENTS } from '../../shared/catalog';
import type { HitObject, Judgment } from '../../shared/types';
import type { FeedbackEvent } from '../engine/session';
import { COLORS, FONT, FX, groupColor } from './theme';
import { STRINGS } from './strings';

const F_POP = `700 17px ${FONT}`;
const F_POP_SUB = `500 11px ${FONT}`;
const F_BONUS = `700 22px ${FONT}`;
const N_RING = 96;
const N_SPARK = 192;
const N_X = 24;
const N_BODY = 48;
const N_POP = 40;
const N_BAR = 64;

const PALETTE: string[] = [JUDGMENTS.crisp.color, JUDGMENTS.solid.color, JUDGMENTS.rough.color, JUDGMENTS.miss.color, '#7dd3fc', '#f9a8d4', '#fde68a', '#e5e7eb'];
const JUDGE_IDX: Record<Judgment, number> = { crisp: 0, solid: 1, rough: 2, miss: 3 };
const JUDGE_ORDER: Judgment[] = ['crisp', 'solid', 'rough', 'miss'];
const colorIndexOf = (group: number) => 4 + (((group % 4) + 4) % 4);

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

function alloc(n: number) {
  return {
    on: new Uint8Array(n),
    x: new Float32Array(n),
    y: new Float32Array(n),
    a: new Float32Array(n),
    b: new Float32Array(n),
    c: new Float32Array(n),
    d: new Float32Array(n),
    t0: new Float64Array(n),
    dur: new Float32Array(n),
    col: new Uint8Array(n),
  };
}

export class Effects {
  private ring = alloc(N_RING);
  private spark = alloc(N_SPARK);
  private xmark = alloc(N_X);
  private body = alloc(N_BODY);
  private pop = alloc(N_POP);
  private popText = new Int16Array(N_POP);
  private popSub: string[] = new Array<string>(N_POP).fill('');
  private popKind = new Uint8Array(N_POP);
  private cursors = { ring: 0, spark: 0, xmark: 0, body: 0, pop: 0 };

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

  reset(): void {
    for (const p of [this.ring, this.spark, this.xmark, this.body, this.pop]) p.on.fill(0);
    this.comboShown = 0;
    this.banner = null;
    this.barCount = 0;
    this.barHead = 0;
    this.barHasMean = false;
    this.scoreShown = 0;
  }

  private next(kind: 'ring' | 'spark' | 'xmark' | 'body' | 'pop', n: number): number {
    const i = this.cursors[kind];
    this.cursors[kind] = (i + 1) % n;
    return i;
  }

  private addRing(x: number, y: number, r0: number, r1: number, now: number, dur: number, col: number, alpha: number, width: number): void {
    const p = this.ring;
    const i = this.next('ring', N_RING);
    p.on[i] = 1;
    p.x[i] = x;
    p.y[i] = y;
    p.a[i] = r0;
    p.b[i] = r1;
    p.c[i] = alpha;
    p.d[i] = width;
    p.t0[i] = now;
    p.dur[i] = dur;
    p.col[i] = col;
  }

  private addSpark(x: number, y: number, angle: number, d0: number, d1: number, now: number, col: number): void {
    const p = this.spark;
    const i = this.next('spark', N_SPARK);
    p.on[i] = 1;
    p.x[i] = x;
    p.y[i] = y;
    p.a[i] = angle;
    p.b[i] = d0;
    p.c[i] = d1;
    p.t0[i] = now;
    p.dur[i] = FX.sparks;
    p.col[i] = col;
  }

  private addPopup(x: number, y: number, now: number, col: number, kind: number, text: number): void {
    const p = this.pop;
    const i = this.next('pop', N_POP);
    p.on[i] = 1;
    p.x[i] = x;
    p.y[i] = y;
    p.t0[i] = now;
    p.dur[i] = FX.popup;
    p.col[i] = col;
    this.popKind[i] = kind;
    this.popText[i] = text;
    this.popSub[i] = text !== 0 ? STRINGS.timing(text < 0 ? 'early' : 'late', Math.abs(text)) : '';
  }

  private burst(x: number, y: number, r: number, j: Judgment, now: number, flags: DisplayFlags, scale = 1): void {
    const col = JUDGE_IDX[j];
    if (j === 'crisp') {
      this.addRing(x, y, r, r * 1.7 * scale, now, FX.burstCrisp, col, 1, 3);
      if (!flags.reduceMotion) {
        for (let k = 0; k < 6; k++) this.addSpark(x, y, (k / 6) * Math.PI * 2 + (x * 7.31 + y * 3.17), r * 1.2, r * 2.2 * scale, now, col);
      }
    } else if (j === 'solid') {
      this.addRing(x, y, r, r * 1.45 * scale, now, FX.burstSolid, col, 1, 3);
    } else if (j === 'rough') {
      this.addRing(x, y, r, r * 1.25 * scale, now, FX.burstRough, col, 0.6, 3);
    }
  }

  private judgmentPopup(x: number, y: number, r: number, j: Judgment, error: number, now: number, flags: DisplayFlags): void {
    if (j === 'crisp' && !flags.crispPopups) return;
    const text = flags.earlyLate && (j === 'solid' || j === 'rough') ? Math.round(error) : 0;
    this.addPopup(x, y - r * 0.2, now, JUDGE_IDX[j], j === 'miss' ? 2 : 0, text);
  }

  /** Feed one session event. `obj` is the object it belongs to, when there is one. */
  onEvent(e: FeedbackEvent, now: number, obj: HitObject | null, flags: DisplayFlags): void {
    const r = obj ? obj.radius : 50;
    switch (e.type) {
      case 'hit': {
        const j = e.judgment as Judgment;
        this.burst(e.x, e.y, r, j, now, flags);
        if (obj && obj.kind === 'circle') {
          const p = this.body;
          const i = this.next('body', N_BODY);
          p.on[i] = 1;
          p.x[i] = e.x;
          p.y[i] = e.y;
          p.a[i] = r;
          p.t0[i] = now;
          p.dur[i] = FX.bodyPop;
          p.col[i] = colorIndexOf(obj.group);
        }
        this.judgmentPopup(e.x, e.y, r, j, e.value, now, flags);
        this.pushError(e.value, now);
        break;
      }
      case 'miss': {
        const p = this.xmark;
        const i = this.next('xmark', N_X);
        p.on[i] = 1;
        p.x[i] = e.x;
        p.y[i] = e.y;
        p.a[i] = r;
        p.t0[i] = now;
        p.dur[i] = FX.missX;
        this.addRing(e.x, e.y, r, r * 1.1, now, 260, 3, 0.9, 4);
        this.addPopup(e.x, e.y - r * 0.2, now, 3, 2, 0);
        if (!flags.reduceMotion) this.missVignetteT0 = now;
        break;
      }
      case 'tick':
      case 'repeat':
        this.tickPulseT = now;
        this.addRing(e.x, e.y, r * 0.14, r * 0.5, now, FX.tickPop, obj ? colorIndexOf(obj.group) : 7, 0.9, 2);
        break;
      case 'tickMiss':
      case 'repeatMiss':
      case 'endMiss':
        this.addRing(e.x, e.y, r * 0.14, r * 0.4, now, 200, 3, 0.9, 2);
        if (!flags.reduceMotion && e.type !== 'tickMiss') this.missVignetteT0 = now;
        break;
      case 'sliderDone': {
        const j = e.judgment as Judgment;
        this.burst(e.x, e.y, r, j, now, flags);
        if (j !== 'crisp') this.judgmentPopup(e.x, e.y, r, j, 0, now, { ...flags, earlyLate: false });
        break;
      }
      case 'spinDone': {
        const j = e.judgment as Judgment;
        this.burst(e.x, e.y, 240, j, now, flags, 1.1);
        if (j === 'miss') this.addPopup(e.x, e.y, now, 3, 2, 0);
        break;
      }
      case 'spinBonus':
        this.addPopup(e.x, e.y - 60, now, 0, 1, 0);
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

  /** Rings, sparks, X marks and popped bodies, in playfield units. */
  drawField(ctx: CanvasRenderingContext2D, now: number): void {
    ctx.lineCap = 'round';
    let p = this.body;
    for (let i = 0; i < N_BODY; i++) {
      if (!p.on[i]) continue;
      const u = (now - (p.t0[i] as number)) / (p.dur[i] as number);
      if (u >= 1) {
        p.on[i] = 0;
        continue;
      }
      const r = (p.a[i] as number) * (1 + 0.15 * u);
      ctx.globalAlpha = 0.85 * (1 - u);
      ctx.fillStyle = COLORS.body;
      ctx.beginPath();
      ctx.arc(p.x[i] as number, p.y[i] as number, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = PALETTE[p.col[i] as number] as string;
      ctx.stroke();
    }
    p = this.ring;
    for (let i = 0; i < N_RING; i++) {
      if (!p.on[i]) continue;
      const u = (now - (p.t0[i] as number)) / (p.dur[i] as number);
      if (u >= 1) {
        p.on[i] = 0;
        continue;
      }
      const e = 1 - (1 - u) * (1 - u) * (1 - u);
      const r0 = p.a[i] as number;
      const r = r0 + ((p.b[i] as number) - r0) * e;
      ctx.globalAlpha = (p.c[i] as number) * (1 - u);
      ctx.lineWidth = (p.d[i] as number) * (1 - 0.5 * u);
      ctx.strokeStyle = PALETTE[p.col[i] as number] as string;
      ctx.beginPath();
      ctx.arc(p.x[i] as number, p.y[i] as number, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    p = this.spark;
    ctx.lineWidth = 2.5;
    for (let i = 0; i < N_SPARK; i++) {
      if (!p.on[i]) continue;
      const u = (now - (p.t0[i] as number)) / (p.dur[i] as number);
      if (u >= 1) {
        p.on[i] = 0;
        continue;
      }
      const e = 1 - (1 - u) * (1 - u);
      const d0 = p.b[i] as number;
      const d = d0 + ((p.c[i] as number) - d0) * e;
      const a = p.a[i] as number;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      const len = 9 * (1 - u);
      ctx.globalAlpha = 1 - u;
      ctx.strokeStyle = PALETTE[p.col[i] as number] as string;
      ctx.beginPath();
      ctx.moveTo((p.x[i] as number) + cx * d, (p.y[i] as number) + cy * d);
      ctx.lineTo((p.x[i] as number) + cx * (d + len), (p.y[i] as number) + cy * (d + len));
      ctx.stroke();
    }
    p = this.xmark;
    ctx.lineWidth = 5;
    ctx.strokeStyle = COLORS.miss;
    for (let i = 0; i < N_X; i++) {
      if (!p.on[i]) continue;
      const u = (now - (p.t0[i] as number)) / (p.dur[i] as number);
      if (u >= 1) {
        p.on[i] = 0;
        continue;
      }
      const k = (p.a[i] as number) * 0.55 * (u < 0.12 ? 0.7 + 2.5 * u : 1);
      const x = p.x[i] as number;
      const y = p.y[i] as number;
      ctx.globalAlpha = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
      ctx.beginPath();
      ctx.moveTo(x - k, y - k);
      ctx.lineTo(x + k, y + k);
      ctx.moveTo(x + k, y - k);
      ctx.lineTo(x - k, y + k);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Judgment pop-ups, in playfield units. */
  drawPopups(ctx: CanvasRenderingContext2D, now: number): void {
    const p = this.pop;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < N_POP; i++) {
      if (!p.on[i]) continue;
      const u = (now - (p.t0[i] as number)) / (p.dur[i] as number);
      if (u >= 1) {
        p.on[i] = 0;
        continue;
      }
      const rise = FX.popupRise * (1 - (1 - u) * (1 - u));
      const x = p.x[i] as number;
      const y = (p.y[i] as number) - rise;
      ctx.globalAlpha = u < 0.65 ? 1 : 1 - (u - 0.65) / 0.35;
      ctx.fillStyle = PALETTE[p.col[i] as number] as string;
      const kind = this.popKind[i] as number;
      if (kind === 1) {
        ctx.font = F_BONUS;
        ctx.fillText(STRINGS.bonus, x, y);
        continue;
      }
      const label = kind === 2 ? JUDGMENTS.miss.label : JUDGMENTS[JUDGE_ORDER[p.col[i] as number] as Judgment].label;
      ctx.font = F_POP;
      ctx.fillText(label, x, y);
      if (this.popText[i] !== 0) {
        ctx.font = F_POP_SUB;
        ctx.fillStyle = COLORS.ink2;
        ctx.fillText(this.popSub[i] as string, x, y + 15);
      }
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

  groupColorOf(group: number): string {
    return groupColor(group);
  }
}
