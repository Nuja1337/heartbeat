// Player models and synthetic input. Movement is minimum-jerk, sampled by the headless loop.

import { PLAYFIELD_CENTER } from '../../shared/catalog';
import type { HitObject, InputSlot, ObjectFeatures, Vec2 } from '../../shared/types';
import type { Rng } from '../map/rng';
import { ballPos, buildSliderGeometry } from '../rules/slider';
import type { SliderGeometry } from '../rules/slider';

export interface PlayerModel {
  name: string;
  /** Press timing noise, ms. */
  sigmaT: number;
  /** Aim noise per axis, in radii. */
  sigmaAim: number;
  /** The cursor settles on the target this long before the press, ms. */
  arriveEarly: number;
  /** Stop short of far targets by this many radii along the movement. */
  undershoot?: { minSpacing: number; radii: number };
  /** Wander while following a slider, in radii. */
  trackNoise: number;
  /** Spinner turns as a multiple of the goal. */
  spinFactor: number;
  /** How long a tap holds its key, ms. */
  holdMs: number;
  /** Let go of a slider this long before it ends. Negative lets go after. Default -5. */
  sliderReleaseEarly?: number;
}

export const PERFECT_PLAYER: PlayerModel = {
  name: 'perfect',
  sigmaT: 0,
  sigmaAim: 0,
  arriveEarly: 30,
  trackNoise: 0,
  spinFactor: 1.3,
  holdMs: 25,
};

export const NOISY_PLAYER: PlayerModel = {
  name: 'noisy',
  sigmaT: 15,
  sigmaAim: 0.25,
  arriveEarly: 30,
  trackNoise: 0.3,
  spinFactor: 1.3,
  holdMs: 25,
};

export const WEAK_PLAYER: PlayerModel = {
  name: 'weak',
  sigmaT: 12,
  sigmaAim: 0.1,
  arriveEarly: 30,
  undershoot: { minSpacing: 4.5, radii: 0.4 },
  trackNoise: 0.2,
  spinFactor: 1.3,
  holdMs: 25,
};

export interface PlanEvent {
  t: number;
  kind: 'press' | 'release';
  slot: InputSlot;
}

interface Segment {
  t0: number;
  t1: number;
  at(t: number, out: Vec2): void;
}

const minJerk = (tau: number) => tau * tau * tau * (10 - 15 * tau + 6 * tau * tau);

export class AutoPlayer {
  private segs: Segment[] = [];
  private cur = 0;
  /** Where the cursor will be when the planned movement ends. */
  private lastPos: Vec2 = { x: PLAYFIELD_CENTER.x, y: PLAYFIELD_CENTER.y };
  private lastT = 0;
  private lastPress = -Infinity;
  private slotFlip = 0;
  private events: PlanEvent[] = [];
  private evCur = 0;

  constructor(
    readonly model: PlayerModel,
    private rng: Rng,
  ) {}

  /** Cursor position at time t. Call with rising t. */
  posAt(t: number, out: Vec2): Vec2 {
    const s = this.segs;
    if (s.length === 0 || t < (s[0] as Segment).t0) {
      out.x = PLAYFIELD_CENTER.x;
      out.y = PLAYFIELD_CENTER.y;
      return out;
    }
    while (this.cur + 1 < s.length && (s[this.cur + 1] as Segment).t0 <= t) this.cur++;
    const seg = s[this.cur] as Segment;
    seg.at(t < seg.t0 ? seg.t0 : t > seg.t1 ? seg.t1 : t, out);
    return out;
  }

  /** Hand over events with time <= t, in order. */
  drain(t: number, fn: (e: PlanEvent) => void): void {
    while (this.evCur < this.events.length && (this.events[this.evCur] as PlanEvent).t <= t) {
      fn(this.events[this.evCur] as PlanEvent);
      this.evCur++;
    }
  }

  private addEvent(e: PlanEvent): void {
    let i = this.events.length;
    while (i > this.evCur && (this.events[i - 1] as PlanEvent).t > e.t) i--;
    this.events.splice(i, 0, e);
  }

  private nextSlot(): InputSlot {
    this.slotFlip ^= 1;
    return this.slotFlip === 0 ? 'key1' : 'key2';
  }

  private hold(t0: number, t1: number, p: Vec2): void {
    if (t1 <= t0) return;
    const q = { x: p.x, y: p.y };
    this.segs.push({
      t0,
      t1,
      at: (_t, out) => {
        out.x = q.x;
        out.y = q.y;
      },
    });
  }

  private move(t0: number, t1: number, to: Vec2): void {
    const a = { x: this.lastPos.x, y: this.lastPos.y };
    const b = { x: to.x, y: to.y };
    const span = Math.max(1, t1 - t0);
    this.segs.push({
      t0,
      t1: t0 + span,
      at: (t, out) => {
        const k = minJerk((t - t0) / span);
        out.x = a.x + (b.x - a.x) * k;
        out.y = a.y + (b.y - a.y) * k;
      },
    });
  }

  /** Plan the input for one object. Call in object order. */
  plan(obj: HitObject, f: ObjectFeatures): void {
    const m = this.model;
    const rng = this.rng;
    if (obj.kind === 'spinner') return this.planSpinner(obj);

    let tp = obj.time + (m.sigmaT > 0 ? rng.normal() * m.sigmaT : 0);
    tp = Math.max(tp, this.lastPress + 4, this.lastT + 2);
    const r = obj.radius;
    const target = { x: obj.pos.x, y: obj.pos.y };
    if (m.sigmaAim > 0) {
      target.x += rng.normal() * m.sigmaAim * r;
      target.y += rng.normal() * m.sigmaAim * r;
    }
    if (m.undershoot && f.spacing !== null && f.spacing >= m.undershoot.minSpacing && f.direction !== null) {
      const a = (f.direction * Math.PI) / 180;
      target.x -= Math.cos(a) * m.undershoot.radii * r;
      target.y -= Math.sin(a) * m.undershoot.radii * r;
    }
    const start = this.lastT;
    let arrive = tp - m.arriveEarly;
    arrive = Math.max(arrive, start + 0.4 * (tp - start));
    if (arrive <= start) arrive = start + 1;
    this.move(start, arrive, target);
    this.hold(arrive, tp, target);
    this.lastPos = target;
    this.lastT = tp;
    this.lastPress = tp;
    const slot = this.nextSlot();
    this.addEvent({ t: tp, kind: 'press', slot });

    if (obj.kind === 'circle') {
      this.addEvent({ t: tp + m.holdMs, kind: 'release', slot });
      return;
    }

    // Slider: follow the ball from the press to the end.
    const geom: SliderGeometry = buildSliderGeometry(obj);
    const ph1 = rng.range(0, 6.28);
    const ph2 = rng.range(0, 6.28);
    const lag = { x: target.x - obj.pos.x, y: target.y - obj.pos.y };
    const t1 = obj.endTime;
    const wob = m.trackNoise * r;
    const tmp = { x: 0, y: 0 };
    this.segs.push({
      t0: tp,
      t1: Math.max(t1, tp + 1),
      at: (t, out) => {
        ballPos(geom, t, tmp);
        const k = Math.max(0, 1 - (t - tp) / 60);
        out.x = tmp.x + lag.x * k + wob * Math.sin(t / 95 + ph1);
        out.y = tmp.y + lag.y * k + wob * Math.sin(t / 120 + ph2);
      },
    });
    const end = { x: 0, y: 0 };
    ballPos(geom, Math.max(t1, tp + 1), end);
    end.x += wob * Math.sin(t1 / 95 + ph1);
    end.y += wob * Math.sin(t1 / 120 + ph2);
    this.lastPos = end;
    this.lastT = Math.max(t1, tp + 1);
    this.addEvent({ t: t1 - (m.sliderReleaseEarly ?? -5), kind: 'release', slot });
  }

  private planSpinner(obj: Extract<HitObject, { kind: 'spinner' }>): void {
    const m = this.model;
    const R = 100;
    const c = obj.pos;
    const start = { x: c.x + R, y: c.y };
    const t0 = obj.time;
    const t1 = obj.endTime;
    const from = this.lastT;
    this.move(from, Math.max(from + 1, t0 - 20), start);
    this.hold(Math.max(from + 1, t0 - 20), t0, start);
    const spinStart = t0 + 100;
    const turns = m.spinFactor * obj.rotationsRequired;
    const rps = Math.min(9.5, turns / Math.max(0.2, (t1 - spinStart - 50) / 1000));
    const w = rps * Math.PI * 2;
    this.segs.push({
      t0,
      t1,
      at: (t, out) => {
        const a = t < spinStart ? 0 : (w * (t - spinStart)) / 1000;
        out.x = c.x + R * Math.cos(a);
        out.y = c.y + R * Math.sin(a);
      },
    });
    const aEnd = (w * (t1 - spinStart)) / 1000;
    this.lastPos = { x: c.x + R * Math.cos(aEnd), y: c.y + R * Math.sin(aEnd) };
    this.lastT = t1;
    this.lastPress = t0;
    const slot = this.nextSlot();
    this.addEvent({ t: t0, kind: 'press', slot });
    this.addEvent({ t: t1 + 5, kind: 'release', slot });
  }
}
