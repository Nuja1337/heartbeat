// Quantization and the input trace (PLAN-2 5.1). Pure.
//
// The session snaps every time to 1/64 ms and every position to 1/16 unit before it uses or logs the value, so the
// log is exact and a replay through a fresh session reproduces the play.

import { INPUT_SLOT_ORDER, TRACE, TRACE_OP } from '../../shared/catalog';
import type { InputSlot, InputTrace } from '../../shared/types';

/** Snap a time to the 1/64 ms grid. Adding 0 turns -0 into +0. */
export const qt = (t: number): number => Math.round(t * TRACE.timeSteps) / TRACE.timeSteps + 0;

/** Snap a position to the 1/16 unit grid. Adding 0 turns -0 into +0. */
export const qp = (v: number): number => Math.round(v * TRACE.posSteps) / TRACE.posSteps + 0;

/** Index of each slot in INPUT_SLOT_ORDER, which the op codes use. */
const SLOT_INDEX = Object.fromEntries(INPUT_SLOT_ORDER.map((s, i) => [s, i])) as Record<InputSlot, number>;

/** Op code for a press, with or without a position. */
export const pressOp = (slot: InputSlot, positioned: boolean): number =>
  (positioned ? TRACE_OP.pressAt : TRACE_OP.press) + SLOT_INDEX[slot];
/** Op code for a release. */
export const releaseOp = (slot: InputSlot): number => TRACE_OP.release + SLOT_INDEX[slot];

interface Chunk {
  ops: Uint8Array;
  t: Float64Array;
  x: Float32Array;
  y: Float32Array;
}

const newChunk = (n: number): Chunk => ({ ops: new Uint8Array(n), t: new Float64Array(n), x: new Float32Array(n), y: new Float32Array(n) });

/**
 * Stores the trace in fixed chunks. `prepare()` allocates the next chunk once the current one is 75% full. The game
 * calls it from the frame path, so `record` in the input handlers has a spare to switch to and never allocates. (A
 * caller that never calls `prepare` still works: `record` allocates the chunk itself when it runs out.)
 */
export class TraceRecorder {
  private chunks: Chunk[] = [];
  private cur: Chunk;
  private spare: Chunk | null = null;
  private used = 0;
  private total = 0;

  constructor(private readonly chunkEvents: number = TRACE.chunkEvents) {
    this.cur = newChunk(chunkEvents);
    this.chunks.push(this.cur);
  }

  get count(): number {
    return this.total;
  }

  /** Append one event. x and y are 0 for ops without a position. */
  record(op: number, t: number, x: number, y: number): void {
    if (this.used === this.chunkEvents) {
      this.cur = this.spare ?? newChunk(this.chunkEvents);
      this.spare = null;
      this.chunks.push(this.cur);
      this.used = 0;
    }
    const c = this.cur;
    const i = this.used++;
    c.ops[i] = op;
    c.t[i] = t;
    c.x[i] = x;
    c.y[i] = y;
    this.total++;
  }

  /** Allocate the spare chunk when the current one is 75% full. Call from the frame path, never from input handlers. */
  prepare(): void {
    if (this.spare === null && this.used >= this.chunkEvents * 0.75) this.spare = newChunk(this.chunkEvents);
  }

  /** One trace with exactly `count` events. The recorder can still be used afterwards. */
  toTrace(): InputTrace {
    const n = this.total;
    const out: InputTrace = { count: n, ops: new Uint8Array(n), t: new Float64Array(n), x: new Float32Array(n), y: new Float32Array(n) };
    let at = 0;
    for (const c of this.chunks) {
      const len = Math.min(this.chunkEvents, n - at);
      if (len <= 0) break;
      out.ops.set(c.ops.subarray(0, len), at);
      out.t.set(c.t.subarray(0, len), at);
      out.x.set(c.x.subarray(0, len), at);
      out.y.set(c.y.subarray(0, len), at);
      at += len;
    }
    return out;
  }
}
