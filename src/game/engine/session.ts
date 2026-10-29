// GameSession: the headless core. Judging, combo, score, health, records and feedback events.
// It never touches the DOM, so Node tests and the headless simulator run it directly.

import { RECORD_VERSION } from '../../shared/catalog';
import type {
  HitObject,
  HitRecord,
  InputInfo,
  InputSlot,
  Judgment,
  LaunchRequest,
  LevelStep,
  MissReason,
  ModuleId,
  Ms,
  ObjectFeatures,
  ObjectKind,
  PlayResult,
  PlayStatus,
  PlayableMap,
  SliderObject,
  Vec2,
} from '../../shared/types';
import { extendFeatures } from '../map/features';
import { BREAK_EFFECT_MIN, Scoring } from '../rules/scoring';
import { classifyError, expiryTime, nearestAimPress, resolvePress } from '../rules/judge';
import type { AimPress, Target } from '../rules/judge';
import { buildRecord } from '../rules/records';
import type { PressInfo } from '../rules/records';
import { buildSliderGeometry, SliderRun, sliderOutcome } from '../rules/slider';
import type { CheckKind, SliderSink } from '../rules/slider';
import { SpinnerRun } from '../rules/spinner';
import { ENGINE_VERSION } from '../version';
import { CursorBuffer, HoldLog } from './cursor';

/** Slider and spinner state is evaluated this far behind the newest input, so pointer samples have arrived. */
export const TRACK_DELAY_MS = 20;

const SLOT_BIT: Record<InputSlot, number> = { key1: 1, key2: 2, mouse1: 4, mouse2: 8 };

export type FeedbackType =
  | 'hit'
  | 'miss'
  | 'tick'
  | 'tickMiss'
  | 'repeat'
  | 'repeatMiss'
  | 'endHit'
  | 'endMiss'
  | 'sliderDone'
  | 'trackOn'
  | 'trackOff'
  | 'spinBonus'
  | 'spinComplete'
  | 'spinDone'
  | 'comboBreak'
  | 'milestone'
  | 'stray'
  | 'setEnd'
  | 'fail';

export interface SetEndInfo {
  set: number;
  module: ModuleId;
  from: number;
  to: number;
  success: number;
  direction: 'up' | 'down' | 'hold';
}

export interface FeedbackEvent {
  type: FeedbackType;
  /** Play time. */
  t: Ms;
  index: number;
  judgment: Judgment | null;
  /** Where the effect belongs, in playfield units. */
  x: number;
  y: number;
  /** Press error for hits, combo lost for breaks, the combo for milestones, the bonus count for spinners. */
  value: number;
  combo: number;
  /** True for the head of a slider. */
  head: boolean;
  reason: MissReason | null;
  setEnd: SetEndInfo | null;
}

export type FeedbackListener = (e: FeedbackEvent) => void;

/** What the session asks of an adaptive mode when a set is done. */
export interface SetController {
  closeSet(set: number, records: readonly HitRecord[], tClose: Ms): { objects: HitObject[] | null; info: SetEndInfo };
  levelSteps(): LevelStep[];
  finalLevels(): Partial<Record<ModuleId, number>>;
  /** The level and set number of the set being played now. */
  status(): { level: number; set: number };
}

export interface SessionInit {
  map: PlayableMap;
  launch: LaunchRequest;
  controller?: SetController | null;
  /** Length that ObjectFeatures.progress is measured against. */
  progressMs?: number;
}

export class ObjState {
  target: Target;
  done = false;
  judgment: Judgment | null = null;
  headJudgment: Judgment | null = null;
  missReason: MissReason | null = null;
  judgeT = 0;
  press: PressInfo | null = null;
  aimPress: AimPress | null = null;
  comboBefore = 0;
  afterPause = false;
  slider: SliderRun | null = null;
  spinner: SpinnerRun | null = null;
  sliderStarted = false;

  constructor(readonly obj: HitObject) {
    this.target = {
      time: obj.time,
      x: obj.pos.x,
      y: obj.pos.y,
      radius: obj.radius,
      windows: obj.windows,
      // Spinners are never press targets.
      judged: obj.kind === 'spinner',
    };
  }
}

interface SetState {
  pending: number;
  records: HitRecord[];
  tLast: Ms;
}

const endOf = (o: HitObject): Ms => (o.kind === 'circle' ? o.time : o.endTime);

export class GameSession {
  readonly map: PlayableMap;
  readonly launch: LaunchRequest;
  readonly objs: ObjState[] = [];
  readonly features: ObjectFeatures[] = [];
  readonly scoring: Scoring;
  // 65536 samples hold about 8 seconds of an 8 kHz mouse, enough for the longest movement window.
  readonly cursor = new CursorBuffer(65536);
  readonly hold = new HoldLog();
  readonly records: HitRecord[] = [];
  now: Ms = 0;
  mask = 0;
  strayPresses = 0;
  pauses = 0;
  /** Play time of the last resume from a pause. */
  lastResume = 0;
  failed = false;
  failT = 0;
  moreSets: boolean;
  /** The spinner being played, if any. */
  activeSpin: ObjState | null = null;
  /** First object that is not fully judged yet. */
  firstOpen = 0;

  private controller: SetController | null;
  private listeners: FeedbackListener[] = [];
  private progressMs: number;
  private headPtr = 0;
  private sliderPtr = 0;
  private spinPtr = 0;
  private activeSliders: number[] = [];
  private spinners: ObjState[] = [];
  private doneCount = 0;
  private sets = new Map<number, SetState>();
  private curSlider = -1;
  private lastDrainT = 0;
  private drainFree: number[] = [];
  private drainPtr = 0;
  private tmp: Vec2 = { x: 0, y: 0 };
  private finished = false;
  private lastSpinTurns = 0;
  private lastSpinBonus = 0;
  private spinCompleteSent = false;
  private targetList: Target[] = [];

  private sink: SliderSink = {
    onPart: (kind, hit, t, x, y) => this.onSliderPart(kind, hit, t, x, y),
    onTrack: (on, t) => this.onSliderTrack(on, t),
  };

  constructor(init: SessionInit) {
    this.map = init.map;
    this.launch = init.launch;
    this.controller = init.controller ?? null;
    this.moreSets = this.controller !== null;
    this.progressMs = init.progressMs ?? init.map.durationMs;
    this.scoring = new Scoring(init.map.health);
    const initial = init.map.objects.slice();
    this.map.objects.length = 0;
    this.appendObjects(initial);
  }

  get state(): GameSession {
    return this;
  }

  get over(): boolean {
    return !this.moreSets && this.doneCount >= this.objs.length && this.now >= this.map.durationMs;
  }

  on(listener: FeedbackListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private emit(type: FeedbackType, t: Ms, index: number, judgment: Judgment | null, x: number, y: number, value = 0, head = false, reason: MissReason | null = null, setEnd: SetEndInfo | null = null): void {
    if (this.listeners.length === 0) return;
    const e: FeedbackEvent = { type, t, index, judgment, x, y, value, combo: this.scoring.combo, head, reason, setEnd };
    for (const l of this.listeners) l(e);
  }

  /* ------------------------------------------------------------ objects */

  appendObjects(objects: readonly HitObject[]): void {
    if (objects.length === 0) return;
    const from = this.objs.length;
    for (const o of objects) {
      const s = new ObjState(o);
      if (o.kind === 'slider') s.slider = new SliderRun(buildSliderGeometry(o));
      if (o.kind === 'spinner') {
        s.spinner = new SpinnerRun(o);
        this.spinners.push(s);
      }
      this.objs.push(s);
      this.targetList.push(s.target);
      this.map.objects.push(o);
      if (o.set >= 0) {
        const st = this.sets.get(o.set) ?? { pending: 0, records: [], tLast: 0 };
        st.pending++;
        this.sets.set(o.set, st);
      }
    }
    extendFeatures(this.map.objects, this.features, from, this.progressMs);
    // Drain pauses before the first object, during spinners and in long gaps.
    for (let i = from; i < this.objs.length; i++) {
      const o = (this.objs[i] as ObjState).obj;
      if (i === 0) this.drainFree.push(0, o.time);
      else {
        const p = (this.objs[i - 1] as ObjState).obj;
        if (o.time - endOf(p) >= 2000) this.drainFree.push(endOf(p), o.time);
      }
      if (o.kind === 'spinner') this.drainFree.push(o.time, o.endTime);
    }
    const last = this.map.objects[this.map.objects.length - 1] as HitObject;
    this.map.durationMs = endOf(last) + 1000;
    // The quiet second after the last object does not drain either.
    this.drainFree.push(endOf(last), this.map.durationMs);
  }

  /* -------------------------------------------------------------- input */

  move(t: Ms, pos: Vec2): void {
    this.cursor.push(t, pos.x, pos.y);
    this.startSpinners(t);
    const sp = this.activeSpin;
    if (sp && sp.spinner) {
      sp.spinner.update(t, pos.x, pos.y, this.mask !== 0);
      this.afterSpinUpdate(sp, t);
    }
  }

  press(slot: InputSlot, t: Ms, pos: Vec2 | null): void {
    if (this.failed || this.finished) return;
    this.advance(t);
    const p = pos ?? this.cursor.positionAt(t, this.tmp);
    const x = p.x;
    const y = p.y;
    this.mask |= SLOT_BIT[slot];
    this.hold.set(t, this.mask);
    this.startSpinners(t);
    const sp = this.activeSpin;
    if (sp && sp.spinner) {
      sp.spinner.update(t, x, y, true);
      this.afterSpinUpdate(sp, t);
    }

    const res = resolvePress(this.targetList, this.headPtr, t, x, y);
    const press: PressInfo = { t, x, y, slot };
    if (res.kind === 'hit' || res.kind === 'early') {
      for (const i of res.skipped) this.missHead(i, t, 'skipped', null);
      if (res.kind === 'hit') this.hitHead(res.index, t, press, res.error);
      else this.missHead(res.index, t, 'early', press);
    } else if (res.kind === 'stray') {
      for (const i of res.near) {
        const s = this.objs[i] as ObjState;
        const dist = Math.hypot(x - s.obj.pos.x, y - s.obj.pos.y);
        s.aimPress = nearestAimPress(s.aimPress, { t, x, y, dist, slot });
      }
      const spinning = sp !== null && sp.obj.kind === 'spinner' && t >= sp.obj.time && t <= sp.obj.endTime;
      if (!spinning) {
        this.strayPresses++;
        this.emit('stray', t, -1, null, x, y);
      }
    }
    this.checkFail(t);
  }

  release(slot: InputSlot, t: Ms): void {
    if (this.finished) return;
    this.advance(t);
    this.mask &= ~SLOT_BIT[slot];
    this.hold.set(t, this.mask);
    const sp = this.activeSpin;
    if (sp && sp.spinner) {
      const p = this.cursor.positionAt(t, this.tmp);
      sp.spinner.update(t, p.x, p.y, this.mask !== 0);
    }
  }

  /** A pause started at play time t. Objects on screen at that moment are marked. */
  notePause(t: Ms): void {
    this.pauses++;
    for (let i = this.firstOpen; i < this.objs.length; i++) {
      const s = this.objs[i] as ObjState;
      if (s.done) continue;
      // The pause counts when it falls in the approach, or in the cursor's trip from the object before.
      const reach = Math.max(s.obj.approachMs, (this.features[i] as ObjectFeatures).gapMs ?? 0);
      if (s.obj.time - reach <= t) s.afterPause = true;
    }
  }

  /** The play carries on at play time t after a pause. Movement windows do not reach back before it. */
  noteResume(t: Ms): void {
    this.lastResume = t;
  }

  /* ------------------------------------------------------------- judging */

  private hitHead(i: number, t: Ms, press: PressInfo, error: Ms): void {
    const s = this.objs[i] as ObjState;
    const o = s.obj;
    const j = classifyError(error, o.windows) as Judgment;
    s.target.judged = true;
    s.headJudgment = j;
    s.judgeT = t;
    s.press = press;
    s.comboBefore = this.scoring.combo;
    const radial = Math.hypot(press.x - o.pos.x, press.y - o.pos.y);
    const ch = this.scoring.head(j, radial, o.radius);
    this.advanceHeadPtr();
    this.emit('hit', t, i, j, o.pos.x, o.pos.y, error, o.kind === 'slider');
    this.milestone(t, i, o.pos);
    if (ch.broke >= BREAK_EFFECT_MIN) this.emit('comboBreak', t, i, null, o.pos.x, o.pos.y, ch.broke);
    if (o.kind === 'circle') {
      s.judgment = j;
      this.complete(i, t);
    }
  }

  private missHead(i: number, t: Ms, reason: MissReason, press: PressInfo | null): void {
    const s = this.objs[i] as ObjState;
    if (s.target.judged) return;
    const o = s.obj;
    s.target.judged = true;
    s.headJudgment = 'miss';
    s.missReason = reason;
    s.judgeT = t;
    s.press = press;
    s.comboBefore = this.scoring.combo;
    const ch = this.scoring.head('miss', 0, o.radius);
    this.advanceHeadPtr();
    this.emit('miss', t, i, 'miss', o.pos.x, o.pos.y, ch.broke, o.kind === 'slider', reason);
    if (ch.broke >= BREAK_EFFECT_MIN) this.emit('comboBreak', t, i, null, o.pos.x, o.pos.y, ch.broke);
    if (o.kind === 'circle') {
      s.judgment = 'miss';
      this.complete(i, t);
    }
    this.checkFail(t);
  }

  private advanceHeadPtr(): void {
    while (this.headPtr < this.objs.length && (this.objs[this.headPtr] as ObjState).target.judged) this.headPtr++;
  }

  private milestone(t: Ms, i: number, pos: Vec2): void {
    const c = this.scoring.combo;
    if (c >= 50 && (c === 50 || c % 100 === 0)) this.emit('milestone', t, i, null, pos.x, pos.y, c);
  }

  private checkFail(t: Ms): void {
    if (this.scoring.failed && !this.failed) {
      this.failed = true;
      this.failT = t;
      this.emit('fail', t, -1, null, 0, 0);
    }
  }

  /** An object has its final judgment. Build the record and close its set when it is the last. */
  private complete(i: number, tDone: Ms): void {
    const s = this.objs[i] as ObjState;
    const o = s.obj;
    if (s.done) return;
    s.done = true;
    this.doneCount++;
    while (this.firstOpen < this.objs.length && (this.objs[this.firstOpen] as ObjState).done) this.firstOpen++;
    const judgment = s.judgment as Judgment;
    this.scoring.finalize(judgment);
    // An object that was skipped had no press of its own, so an earlier stray press is not its.
    const skipped = s.headJudgment === 'miss' && s.missReason === 'skipped';
    const press = skipped ? null : (s.press ?? (judgment === 'miss' && s.aimPress ? { t: s.aimPress.t, x: s.aimPress.x, y: s.aimPress.y, slot: s.aimPress.slot } : null));
    const rec = buildRecord({
      obj: o,
      prev: i > 0 ? (this.objs[i - 1] as ObjState).obj : null,
      features: this.features[i] as ObjectFeatures,
      judgment,
      headJudgment: o.kind === 'spinner' ? null : s.headJudgment,
      missReason: s.missReason,
      press: o.kind === 'spinner' ? null : press,
      comboBefore: s.comboBefore,
      afterPause: s.afterPause,
      movementFrom: this.lastResume,
      cursor: this.cursor,
      slider: s.slider ? s.slider.stats() : null,
      spinner: s.spinner ? s.spinner.stats() : null,
    });
    this.records.push(rec);
    if (o.set >= 0) {
      const st = this.sets.get(o.set);
      if (st) {
        st.pending--;
        st.records.push(rec);
        if (tDone > st.tLast) st.tLast = tDone;
        if (st.pending === 0) this.closeSet(o.set, st);
      }
    }
  }

  private closeSet(set: number, st: SetState): void {
    const c = this.controller;
    if (!c) return;
    st.records.sort((a, b) => a.index - b.index);
    const res = c.closeSet(set, st.records, st.tLast);
    this.emit('setEnd', st.tLast, -1, null, 0, 0, res.info.success, false, null, res.info);
    if (res.objects && res.objects.length > 0) this.appendObjects(res.objects);
    else this.moreSets = false;
  }

  /* ------------------------------------------------------------- sliders */

  private onSliderPart(kind: CheckKind, hit: boolean, t: Ms, x: number, y: number): void {
    const name = kind === 1 ? 'tick' : kind === 2 ? 'repeat' : 'end';
    const ch = this.scoring.part(name, hit);
    const type: FeedbackType =
      kind === 1 ? (hit ? 'tick' : 'tickMiss') : kind === 2 ? (hit ? 'repeat' : 'repeatMiss') : hit ? 'endHit' : 'endMiss';
    this.emit(type, t, this.curSlider, null, x, y);
    if (hit) this.milestone(t, this.curSlider, { x, y });
    if (ch.broke >= BREAK_EFFECT_MIN) this.emit('comboBreak', t, this.curSlider, null, x, y, ch.broke);
    this.checkFail(t);
  }

  private onSliderTrack(on: boolean, t: Ms): void {
    const o = (this.objs[this.curSlider] as ObjState).obj;
    this.emit(on ? 'trackOn' : 'trackOff', t, this.curSlider, null, o.pos.x, o.pos.y);
  }

  private finalizeSlider(i: number): void {
    const s = this.objs[i] as ObjState;
    const run = s.slider as SliderRun;
    const o = s.obj as SliderObject;
    if (!s.target.judged) {
      const aim = s.aimPress;
      this.missHead(i, o.endTime, aim ? 'aim' : 'none', aim ? { t: aim.t, x: aim.x, y: aim.y, slot: aim.slot } : null);
    }
    if (this.failed) return;
    const head = (s.headJudgment ?? 'miss') as Judgment;
    const out = sliderOutcome(head, s.missReason, run.fraction());
    s.judgment = out.judgment;
    s.missReason = out.missReason;
    if (out.judgment === 'crisp') this.scoring.sliderBonus();
    this.emit('sliderDone', o.endTime, i, out.judgment, o.pos.x, o.pos.y);
    this.complete(i, o.endTime);
  }

  /* ------------------------------------------------------------ spinners */

  private startSpinners(t: Ms): void {
    if (this.activeSpin === null && this.spinPtr < this.spinners.length) {
      const s = this.spinners[this.spinPtr] as ObjState;
      if (s.obj.time <= t) {
        this.activeSpin = s;
        this.spinPtr++;
        this.lastSpinTurns = 0;
        this.lastSpinBonus = 0;
        this.spinCompleteSent = false;
        const p = this.cursor.positionAt(Math.max(t, s.obj.time), this.tmp);
        s.spinner?.update(Math.max(t, s.obj.time), p.x, p.y, this.mask !== 0);
      }
    }
  }

  private afterSpinUpdate(s: ObjState, t: Ms): void {
    const run = s.spinner as SpinnerRun;
    const turns = Math.floor(run.rotations);
    while (this.lastSpinTurns < turns) {
      this.lastSpinTurns++;
      this.scoring.spinRotationGain();
    }
    if (run.bonus > this.lastSpinBonus) {
      this.lastSpinBonus = run.bonus;
      this.emit('spinBonus', t, s.obj.index, null, s.obj.pos.x, s.obj.pos.y, run.bonus);
    }
    if (run.completed && !this.spinCompleteSent) {
      this.spinCompleteSent = true;
      this.emit('spinComplete', t, s.obj.index, 'crisp', s.obj.pos.x, s.obj.pos.y);
    }
  }

  private finalizeSpinner(s: ObjState): void {
    const run = s.spinner as SpinnerRun;
    const o = s.obj as Extract<HitObject, { kind: 'spinner' }>;
    const out = run.judgment();
    s.judgment = out.judgment;
    s.missReason = out.missReason;
    s.comboBefore = this.scoring.combo;
    const ch = this.scoring.spinner(out.judgment, run.bonus);
    this.emit('spinDone', o.endTime, o.index, out.judgment, o.pos.x, o.pos.y, run.bonus);
    if (ch.broke >= BREAK_EFFECT_MIN) this.emit('comboBreak', o.endTime, o.index, null, o.pos.x, o.pos.y, ch.broke);
    if (ch.broke === 0 && out.judgment !== 'miss') this.milestone(o.endTime, o.index, o.pos);
    this.activeSpin = null;
    this.complete(o.index, o.endTime);
    this.checkFail(o.endTime);
  }

  /* ------------------------------------------------------------- advance */

  /** Move the session clock to `now`. Expires objects, evaluates sliders and spinners, drains health. */
  advance(now: Ms): void {
    if (now <= this.now) return;
    if (this.failed || this.finished) {
      this.now = now;
      return;
    }
    this.now = now;

    // Taps whose window has closed.
    this.advanceHeadPtr();
    for (let i = this.headPtr; i < this.objs.length; i++) {
      const s = this.objs[i] as ObjState;
      if (s.target.judged) continue;
      if (expiryTime(s.target) > now) break;
      const aim = s.aimPress;
      this.missHead(i, expiryTime(s.target), aim ? 'aim' : 'none', aim ? { t: aim.t, x: aim.x, y: aim.y, slot: aim.slot } : null);
      if (this.failed) return;
    }

    const evalT = now - TRACK_DELAY_MS;

    // Sliders that have started.
    while (this.sliderPtr < this.objs.length && (this.objs[this.sliderPtr] as ObjState).obj.time <= evalT) {
      const s = this.objs[this.sliderPtr] as ObjState;
      if (s.slider) this.activeSliders.push(this.sliderPtr);
      this.sliderPtr++;
    }
    for (let k = 0; k < this.activeSliders.length; k++) {
      const i = this.activeSliders[k] as number;
      const s = this.objs[i] as ObjState;
      const run = s.slider as SliderRun;
      this.curSlider = i;
      run.step(evalT, this.cursor, this.hold, this.sink);
      if (this.failed) return;
      if (run.done) {
        this.activeSliders.splice(k, 1);
        k--;
        this.finalizeSlider(i);
        if (this.failed) return;
      }
    }

    // Spinners.
    this.startSpinners(now);
    const sp = this.activeSpin;
    if (sp && sp.obj.kind === 'spinner' && evalT >= sp.obj.endTime) {
      const p = this.cursor.positionAt(sp.obj.endTime, this.tmp);
      sp.spinner?.update(sp.obj.endTime, p.x, p.y, this.hold.heldAt(sp.obj.endTime));
      this.finalizeSpinner(sp);
      if (this.failed) return;
    }

    // Health drain.
    this.drain(now);
    this.checkFail(now);
  }

  private drain(now: Ms): void {
    const from = this.lastDrainT;
    this.lastDrainT = now;
    if (!this.map.health || now <= from) return;
    // Once everything is judged there is nothing left to lose health on.
    if (!this.moreSets && this.doneCount >= this.objs.length) return;
    let active = now - from;
    const free = this.drainFree;
    while (this.drainPtr < free.length && (free[this.drainPtr + 1] as number) < from) this.drainPtr += 2;
    for (let k = this.drainPtr; k < free.length; k += 2) {
      const a = free[k] as number;
      const b = free[k + 1] as number;
      if (a >= now) break;
      active -= Math.max(0, Math.min(b, now) - Math.max(a, from));
    }
    if (active > 0) this.scoring.drain(active / 1000);
  }

  /** The level and set being played, for adaptive modes. */
  levelStatus(): { level: number; set: number } | null {
    return this.controller ? this.controller.status() : null;
  }

  /** What the ambient sounds follow: whether a slider is tracked, how fast its ball moves, and the spin speed. */
  ambient(t: Ms, out: { tracking: boolean; speed: number; rpm: number }): void {
    out.tracking = false;
    out.speed = 0;
    out.rpm = 0;
    for (const i of this.activeSliders) {
      const s = this.objs[i] as ObjState;
      if (s.slider && s.slider.tracking && s.obj.kind === 'slider') {
        out.tracking = true;
        out.speed = Math.max(out.speed, s.obj.velocity);
      }
    }
    const sp = this.activeSpin;
    if (sp && sp.spinner && t >= sp.obj.time) out.rpm = sp.spinner.rpmAt(t);
  }

  /* -------------------------------------------------------------- result */

  /** End the play and build the result. Objects still open are not recorded. */
  finish(status: PlayStatus, info: { startedAt: number; endedAt: number; input: InputInfo }): PlayResult {
    this.finished = true;
    const counts: Record<ObjectKind, number> = { circle: 0, slider: 0, spinner: 0 };
    for (const o of this.map.objects) counts[o.kind]++;
    const m = this.map;
    const records = this.records.slice().sort((a, b) => a.index - b.index);
    return {
      recordVersion: RECORD_VERSION,
      engineVersion: ENGINE_VERSION,
      launch: this.launch,
      map: {
        format: m.format,
        generatorVersion: m.generatorVersion,
        seed: m.seed,
        beatMs: m.beatMs,
        durationMs: m.durationMs,
        rate: m.rate,
        mods: m.mods.slice(),
        health: m.health ? { ...m.health } : null,
        counts,
      },
      startedAt: info.startedAt,
      endedAt: info.endedAt,
      playedMs: this.now,
      status,
      score: this.scoring.total(m.mods),
      accuracy: this.scoring.accuracy,
      maxCombo: this.scoring.maxCombo,
      counts: { ...this.scoring.counts },
      sliderParts: { hit: this.scoring.partsHit, total: this.scoring.partsTotal },
      strayPresses: this.strayPresses,
      pauses: this.pauses,
      levels: this.controller ? this.controller.levelSteps() : [],
      finalLevels: this.controller ? this.controller.finalLevels() : {},
      healthAtEnd: m.health ? this.scoring.health : null,
      input: info.input,
      records,
    };
  }
}
