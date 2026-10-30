// Replay container (PLAN-2 4.3 and 4.11). Pure and synchronous. Gzip is the data layer's job.
//
// Layout, little-endian:
//   0   4  magic "HBRP"
//   4   1  container version (REPLAY_FORMAT)
//   5   1  flags, 0
//   6   2  reserved, 0
//   8   4  H, header length
//   12  H  header: UTF-8 JSON of ReplayData without `trace`
//   then   N (u32), P (u32), N op bytes, then LT + t stream, LX + x stream, LY + y stream.
// Each stream holds second differences of the quantized values as unsigned LEB128 of the zigzag. The t stream has
// N values and runs over all events in order, so t may go down. The x and y streams have P values and run over the
// events that carry a position (ops 0 to 4). Arithmetic only: no 32-bit bitwise operators on stream values.
//
// A quantized -0 is written as +0, so a replay with -0 reads back as +0.
// A replay with a corrupt value can still decode (there is no checksum), but its structure is always checked.

import { REPLAY_FORMAT, TRACE, TRACE_OP } from './catalog';
import type { InputTrace, ReplayData } from './types';

export type ReplayErrorKind = 'damaged' | 'newer';

export class ReplayFormatError extends Error {
  readonly kind: ReplayErrorKind;
  constructor(kind: ReplayErrorKind) {
    super(kind === 'newer' ? 'This replay was made by a newer version of Heartbeat.' : 'This replay is damaged.');
    this.name = 'ReplayFormatError';
    this.kind = kind;
  }
}

const damaged = (): ReplayFormatError => new ReplayFormatError('damaged');

const MAGIC = [0x48, 0x42, 0x52, 0x50] as const;
const PREFIX_BYTES = 12;
const MAX_OP = TRACE_OP.resume;
/** Ops 0 to 4 carry a position. */
const LAST_POSITIONED_OP = TRACE_OP.pressAt + 3;
const MAX_VARINT_BYTES = 8;
const U32_MAX = 0xffffffff;
/** |second difference| must stay below this, so zigzag fits in 2^53. */
const MAX_DD = 2 ** 52;

/** true when the view covers its whole buffer. IndexedDB copies the whole buffer of a view it stores. */
export function isTightBuffer(u8: Uint8Array): boolean {
  return u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength;
}

/* ------------------------------------------------------------------ encode */

class ByteWriter {
  private buf = new Uint8Array(256);
  length = 0;

  private ensure(extra: number): void {
    if (this.length + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }

  /** Unsigned LEB128 of a safe integer, by arithmetic. */
  varint(value: number): void {
    this.ensure(MAX_VARINT_BYTES);
    let v = value;
    while (v >= 128) {
      this.buf[this.length++] = (v % 128) + 128;
      v = Math.floor(v / 128);
    }
    this.buf[this.length++] = v;
  }

  bytes(): Uint8Array {
    return this.buf.subarray(0, this.length);
  }
}

const zigzag = (n: number): number => (n >= 0 ? 2 * n : -2 * n - 1);

/** The grid value of `v`, or a throw when it is off the grid. Adding 0 turns -0 into +0. */
function quantize(v: number, steps: number, what: string, index: number): number {
  const q = v * steps + 0;
  if (!Number.isSafeInteger(q)) throw new RangeError(`Replay ${what} at event ${index} is not on the 1/${steps} grid: ${v}`);
  return q;
}

function writeSecondDiffs(w: ByteWriter, count: number, valueAt: (i: number) => number): void {
  let prev = 0;
  let prevD = 0;
  for (let i = 0; i < count; i++) {
    const q = valueAt(i);
    const d = q - prev;
    const dd = d - prevD;
    if (!Number.isSafeInteger(d) || !Number.isSafeInteger(dd) || Math.abs(dd) >= MAX_DD) {
      throw new RangeError(`Replay value at event ${i} is too large to encode`);
    }
    w.varint(zigzag(dd));
    prev = q;
    prevD = d;
  }
}

function u32le(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, true);
  return out;
}

/**
 * Encodes a replay. Throws RangeError when a time is off the 1/64 ms grid, a position is off the 1/16 grid, an op
 * is unknown or a value is too large. The result is a tight Uint8Array.
 */
export function encodeReplay(data: ReplayData): Uint8Array {
  const { trace, ...head } = data;
  const n = trace.count;
  if (!Number.isInteger(n) || n < 0 || n > U32_MAX) throw new RangeError('Replay event count is invalid');
  if (trace.ops.length < n || trace.t.length < n || trace.x.length < n || trace.y.length < n) {
    throw new RangeError('Replay trace arrays are shorter than its count');
  }

  const positioned: number[] = [];
  for (let i = 0; i < n; i++) {
    const op = trace.ops[i]!;
    if (op > MAX_OP) throw new RangeError(`Replay op ${op} at event ${i} is unknown`);
    if (op <= LAST_POSITIONED_OP) positioned.push(i);
  }

  const tStream = new ByteWriter();
  writeSecondDiffs(tStream, n, (i) => quantize(trace.t[i]!, TRACE.timeSteps, 't', i));
  const xStream = new ByteWriter();
  writeSecondDiffs(xStream, positioned.length, (k) => quantize(trace.x[positioned[k]!]!, TRACE.posSteps, 'x', positioned[k]!));
  const yStream = new ByteWriter();
  writeSecondDiffs(yStream, positioned.length, (k) => quantize(trace.y[positioned[k]!]!, TRACE.posSteps, 'y', positioned[k]!));

  const header = new TextEncoder().encode(JSON.stringify(head));
  const t = tStream.bytes();
  const x = xStream.bytes();
  const y = yStream.bytes();
  const total = PREFIX_BYTES + header.length + 8 + n + 4 + t.length + 4 + x.length + 4 + y.length;
  if (total > U32_MAX) throw new RangeError('Replay is too large');

  const out = new Uint8Array(total);
  out.set(MAGIC, 0);
  out[4] = REPLAY_FORMAT;
  out.set(u32le(header.length), 8);
  let at = PREFIX_BYTES;
  const put = (bytes: Uint8Array): void => {
    out.set(bytes, at);
    at += bytes.length;
  };
  put(header);
  put(u32le(n));
  put(u32le(positioned.length));
  put(trace.ops.subarray(0, n));
  put(u32le(t.length));
  put(t);
  put(u32le(x.length));
  put(x);
  put(u32le(y.length));
  put(y);
  return out;
}

/* ------------------------------------------------------------------ decode */

class Reader {
  at = 0;
  constructor(readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.at;
  }

  u32(): number {
    if (this.remaining < 4) throw damaged();
    const v = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.at, 4).getUint32(0, true);
    this.at += 4;
    return v;
  }

  take(length: number): Uint8Array {
    if (length > this.remaining) throw damaged();
    const out = this.bytes.subarray(this.at, this.at + length);
    this.at += length;
    return out;
  }
}

/** One minimal unsigned LEB128 value of at most 8 bytes and at most 2^53 - 1, read from [at, end). */
function readVarint(bytes: Uint8Array, at: number, end: number): { value: number; next: number } {
  let value = 0;
  let scale = 1;
  for (let i = 0; i < MAX_VARINT_BYTES; i++) {
    if (at + i >= end) throw damaged();
    const b = bytes[at + i]!;
    const low = b % 128;
    // The 8th byte sits at 2^49, so its low part must stay below 2^4 to keep the value under 2^53.
    if (i === MAX_VARINT_BYTES - 1 && low >= 16) throw damaged();
    value += low * scale;
    if (b < 128) {
      if (i > 0 && b === 0) throw damaged(); // not minimal
      return { value, next: at + i + 1 };
    }
    scale *= 128;
  }
  throw damaged();
}

/** Reads `count` second-difference values from exactly `stream` and turns them into quantized values. */
function readSecondDiffs(stream: Uint8Array, count: number, out: (i: number, q: number) => void): void {
  let at = 0;
  let prev = 0;
  let prevD = 0;
  for (let i = 0; i < count; i++) {
    const r = readVarint(stream, at, stream.length);
    at = r.next;
    const dd = r.value % 2 === 0 ? r.value / 2 : -(r.value + 1) / 2;
    const d = prevD + dd;
    const q = prev + d;
    if (!Number.isSafeInteger(d) || !Number.isSafeInteger(q)) throw damaged();
    out(i, q);
    prev = q;
    prevD = d;
  }
  if (at !== stream.length) throw damaged();
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseHeader(bytes: Uint8Array): Omit<ReplayData, 'trace'> {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw damaged();
  }
  if (!isObject(json)) throw damaged();
  const num = (k: string): boolean => typeof json[k] === 'number' && Number.isFinite(json[k] as number);
  const map = json.map;
  if (
    !num('format') || !num('engineVersion') || !num('progressMs') || !num('endT') ||
    typeof json.status !== 'string' || typeof json.judgments !== 'string' ||
    !isObject(json.launch) || !Array.isArray(json.levels) ||
    !isObject(map) || !Array.isArray(map.objects) || !Array.isArray(map.sections)
  ) {
    throw damaged();
  }
  return json as unknown as Omit<ReplayData, 'trace'>;
}

/**
 * Decodes a replay container. Throws ReplayFormatError: 'newer' for a newer container version or non-zero flags or
 * reserved bytes, 'damaged' for everything else that does not parse. Every length is checked against the bytes
 * remaining before anything is allocated.
 */
export function decodeReplay(bytes: Uint8Array): ReplayData {
  if (bytes.length < PREFIX_BYTES) throw damaged();
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC[i]) throw damaged();
  const version = bytes[4]!;
  if (version === 0) throw damaged();
  if (version > REPLAY_FORMAT) throw new ReplayFormatError('newer');
  if (bytes[5] !== 0 || bytes[6] !== 0 || bytes[7] !== 0) throw new ReplayFormatError('newer');

  const r = new Reader(bytes);
  r.at = 8;
  const headerLength = r.u32();
  const head = parseHeader(r.take(headerLength));

  const n = r.u32();
  const p = r.u32();
  if (p > n || n > r.remaining) throw damaged();
  const ops = new Uint8Array(r.take(n));
  let positioned = 0;
  for (let i = 0; i < n; i++) {
    const op = ops[i]!;
    if (op > MAX_OP) throw damaged();
    if (op <= LAST_POSITIONED_OP) positioned++;
  }
  if (positioned !== p) throw damaged();

  const stream = (): Uint8Array => r.take(r.u32());
  const tBytes = stream();
  const xBytes = stream();
  const yBytes = stream();
  if (r.remaining !== 0) throw damaged();

  const t = new Float64Array(n);
  readSecondDiffs(tBytes, n, (i, q) => {
    t[i] = q / TRACE.timeSteps;
  });
  const px = new Float32Array(p);
  readSecondDiffs(xBytes, p, (i, q) => {
    px[i] = q / TRACE.posSteps;
  });
  const py = new Float32Array(p);
  readSecondDiffs(yBytes, p, (i, q) => {
    py[i] = q / TRACE.posSteps;
  });

  const x = new Float32Array(n);
  const y = new Float32Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (ops[i]! <= LAST_POSITIONED_OP) {
      x[i] = px[k]!;
      y[i] = py[k]!;
      k++;
    }
  }

  const trace: InputTrace = { count: n, ops, t, x, y };
  return { ...head, trace };
}
