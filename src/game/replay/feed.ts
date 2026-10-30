// Runs a recorded trace through a fresh GameSession (PLAN-2 5.2). Pure: no DOM, no clock.
//
// Replaying works because the session only sees its public calls, and the trace holds every one in order. The ops
// are fed in trace order even when t goes down between two of them (a key press can carry an earlier time than the
// cursor sample that came before it), so a prefix of the trace is the same set of calls whatever route led to it.

import { INPUT_SLOT_ORDER, TRACE_OP } from '../../shared/catalog';
import type { HitObject, HitRecord, InputTrace, LevelStep, ModuleId, Ms, ReplayData, Vec2 } from '../../shared/types';
import { GameSession } from '../engine/session';
import type { FeedbackListener, SetController, SetEndInfo } from '../engine/session';
import { levelAfter, openSetLevel } from '../modes/runner';

/**
 * Stands in for the mode runner during playback. The live play appended each set when the one before it closed, and
 * session code (spinner starts, pause marks) sees only the objects it has, so the replay has to append them at the
 * same moment. `closeSet(set)` hands back the recorded objects of the next set, or null when the play ended there.
 */
export class ReplayController implements SetController {
  private bySet = new Map<number, HitObject[]>();
  private built = 0;
  private statusObj = { level: 0, set: 0 };
  /** The level of each set that never closed, so the viewer does not rebuild it every frame. */
  private openLevels = new Map<number, number>();

  constructor(private replay: ReplayData) {
    for (const o of replay.map.objects) {
      if (o.set < 1) continue;
      const list = this.bySet.get(o.set);
      if (list) list.push(o);
      else this.bySet.set(o.set, [o]);
    }
  }

  closeSet(set: number, _records: readonly HitRecord[], _tClose: Ms): { objects: HitObject[] | null; info: SetEndInfo } {
    const step = this.replay.levels.find((s) => s.set === set);
    const from = step ? step.level : 0;
    // The level after the set comes from the staircase, so a module's last set reports up or down as the live play did.
    const to = step ? levelAfter(this.replay.launch, this.replay.levels, set, step.module) : from;
    const info: SetEndInfo = {
      set,
      module: step ? step.module : 'jumps',
      from,
      to,
      success: step ? step.success : 0,
      direction: to > from ? 'up' : to < from ? 'down' : 'hold',
    };
    const objects = this.bySet.get(set + 1) ?? null;
    if (objects) this.built = set + 1;
    return { objects, info };
  }

  levelSteps(): LevelStep[] {
    return this.replay.levels;
  }

  finalLevels(): Partial<Record<ModuleId, number>> {
    return {};
  }

  /** The set being played and its level. A set still open when the play ended has no step, so its level is rebuilt once. */
  status(): { level: number; set: number } {
    const set = this.built;
    let level = this.openLevels.get(set);
    if (level === undefined) {
      const step = this.replay.levels.find((s) => s.set === set);
      level = step ? step.level : openSetLevel(this.replay.launch, this.replay.levels, set);
      this.openLevels.set(set, level);
    }
    this.statusObj.set = set;
    this.statusObj.level = level;
    return this.statusObj;
  }
}

/**
 * A session for a replay. The session empties the object list it is given, so it gets copies. An adaptive replay
 * starts with its first set and a controller that appends the rest the way the live play did.
 */
export function sessionForReplay(replay: ReplayData): GameSession {
  const adaptive = replay.map.objects.some((o) => o.set >= 0);
  const objects = adaptive ? replay.map.objects.filter((o) => o.set <= 0) : replay.map.objects.slice();
  const map = { ...replay.map, objects, sections: replay.map.sections.slice() };
  const controller = adaptive ? new ReplayController(replay) : null;
  return new GameSession({ map, launch: replay.launch, controller, progressMs: replay.progressMs, record: false });
}

/** Make one call on the session. `pos` is scratch space for the positioned ops. */
export function applyTraceEvent(session: GameSession, trace: InputTrace, i: number, pos: Vec2): void {
  const op = trace.ops[i] as number;
  const t = trace.t[i] as number;
  if (op === TRACE_OP.move) {
    pos.x = trace.x[i] as number;
    pos.y = trace.y[i] as number;
    session.move(t, pos);
  } else if (op < TRACE_OP.press) {
    pos.x = trace.x[i] as number;
    pos.y = trace.y[i] as number;
    session.press(INPUT_SLOT_ORDER[op - TRACE_OP.pressAt] as (typeof INPUT_SLOT_ORDER)[number], t, pos);
  } else if (op < TRACE_OP.release) {
    session.press(INPUT_SLOT_ORDER[op - TRACE_OP.press] as (typeof INPUT_SLOT_ORDER)[number], t, null);
  } else if (op < TRACE_OP.advance) {
    session.release(INPUT_SLOT_ORDER[op - TRACE_OP.release] as (typeof INPUT_SLOT_ORDER)[number], t);
  } else if (op === TRACE_OP.advance) {
    session.advance(t);
  } else if (op === TRACE_OP.pause) {
    session.notePause(t);
  } else {
    session.noteResume(t);
  }
}

/** Play time at the end of a replay: the session time at the end, or the last logged time if that is later. */
export function replayDuration(replay: ReplayData): number {
  const { trace } = replay;
  let end = replay.endT;
  for (let i = 0; i < trace.count; i++) {
    const t = trace.t[i] as number;
    if (t > end) end = t;
  }
  return end;
}

/** Objects whose judgment differs between two judgment strings. A missing character counts as a difference. */
export function countMismatches(a: string, b: string): number {
  let n = 0;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) n++;
  return n;
}

/** Called for every press fed, with the time and the cursor position at it. */
export type PressListener = (t: Ms, x: number, y: number) => void;

/**
 * A session being driven through a replay. `feedTo(T)` makes every call whose time is at most T, stopping at the
 * first one that is later. A backward `seekTo` rebuilds the session and feeds again from the start.
 */
export class ReplayRunner {
  session: GameSession;
  readonly durationMs: number;
  private idx = 0;
  private fed = -Infinity;
  private pos: Vec2 = { x: 0, y: 0 };

  /** `listener` is attached to every session this runner builds. `onPress` hears every press, with its position. */
  constructor(
    readonly replay: ReplayData,
    private listener: FeedbackListener | null = null,
    private onPress: PressListener | null = null,
  ) {
    this.durationMs = replayDuration(replay);
    this.session = this.build();
  }

  private build(): GameSession {
    const s = sessionForReplay(this.replay);
    if (this.listener) s.on(this.listener);
    return s;
  }

  private step(trace: InputTrace, i: number): void {
    applyTraceEvent(this.session, trace, i, this.pos);
    if (!this.onPress) return;
    const op = trace.ops[i] as number;
    if (op < TRACE_OP.pressAt || op >= TRACE_OP.release) return;
    const t = trace.t[i] as number;
    // A press without a position uses the cursor where it is at that time.
    if (op >= TRACE_OP.press) this.session.cursor.positionAt(t, this.pos);
    this.onPress(t, this.pos.x, this.pos.y);
  }

  /** The time the runner was last fed to. */
  get time(): number {
    return this.fed;
  }

  /** How many trace events have been made. */
  get eventsFed(): number {
    return this.idx;
  }

  /** Start over with a fresh session. */
  rebuild(): void {
    this.session = this.build();
    this.idx = 0;
    this.fed = -Infinity;
  }

  feedTo(t: number): void {
    const trace = this.replay.trace;
    const n = trace.count;
    let i = this.idx;
    while (i < n && (trace.t[i] as number) <= t) {
      this.step(trace, i);
      i++;
    }
    this.idx = i;
    if (t > this.fed) this.fed = t;
  }

  /** Feed every event, including any later than the end of the play. */
  feedAll(): void {
    const trace = this.replay.trace;
    for (let i = this.idx; i < trace.count; i++) this.step(trace, i);
    this.idx = trace.count;
    this.fed = Infinity;
  }

  /** Be at time T, going back by rebuilding. Returns true when it rebuilt. */
  seekTo(t: number): boolean {
    const back = t < this.fed;
    if (back) this.rebuild();
    this.feedTo(t);
    return back;
  }

  judgments(): string {
    return this.session.judgmentString();
  }
}
