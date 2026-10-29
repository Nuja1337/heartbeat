// Runs a recorded trace through a fresh GameSession (PLAN-2 5.2). Pure: no DOM, no clock.
//
// Replaying works because the session only sees its public calls, and the trace holds every one in order. The ops
// are fed in trace order even when t goes down between two of them (a key press can carry an earlier time than the
// cursor sample that came before it), so a prefix of the trace is the same set of calls whatever route led to it.

import { INPUT_SLOT_ORDER, TRACE_OP } from '../../shared/catalog';
import type { InputTrace, ReplayData, Vec2 } from '../../shared/types';
import { GameSession } from '../engine/session';
import type { FeedbackListener } from '../engine/session';

/** A session for a replay. The session empties the object list it is given, so it gets copies. */
export function sessionForReplay(replay: ReplayData): GameSession {
  const map = { ...replay.map, objects: replay.map.objects.slice(), sections: replay.map.sections.slice() };
  return new GameSession({ map, launch: replay.launch, controller: null, progressMs: replay.progressMs, record: false });
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

  /** `listener` is attached to every session this runner builds. */
  constructor(
    readonly replay: ReplayData,
    private listener: FeedbackListener | null = null,
  ) {
    this.durationMs = replayDuration(replay);
    this.session = this.build();
  }

  private build(): GameSession {
    const s = sessionForReplay(this.replay);
    if (this.listener) s.on(this.listener);
    return s;
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
      applyTraceEvent(this.session, trace, i, this.pos);
      i++;
    }
    this.idx = i;
    if (t > this.fed) this.fed = t;
  }

  /** Feed every event, including any later than the end of the play. */
  feedAll(): void {
    const trace = this.replay.trace;
    for (let i = this.idx; i < trace.count; i++) applyTraceEvent(this.session, trace, i, this.pos);
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
