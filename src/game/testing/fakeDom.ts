// A very small browser stand-in, enough to run the game wrapper in Node.

import { vi } from 'vitest';
import { fakeContext } from './fakes';
import type { CallLog } from './fakes';

type Listener = (e: never) => void;

export class FakeTarget {
  private listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, fn: Listener): void {
    let s = this.listeners.get(type);
    if (!s) this.listeners.set(type, (s = new Set()));
    s.add(fn);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type: string, e: Record<string, unknown> = {}): void {
    const ev = { type, timeStamp: performance.now(), preventDefault() {}, ...e };
    for (const fn of Array.from(this.listeners.get(type) ?? [])) fn(ev as never);
  }
  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

export interface FakeEnv {
  window: FakeTarget & Record<string, unknown>;
  document: FakeTarget & Record<string, unknown>;
  canvas: FakeTarget & Record<string, unknown>;
  log: CallLog;
  /** Advance the clock and run animation frames at the given rate. */
  run(ms: number, hz?: number): void;
  now(): number;
  cleanup(): void;
}

export function installFakeDom(opts: { rawUpdate?: boolean } = {}): FakeEnv {
  let time = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  const log: CallLog = { calls: 0, names: new Map() };
  const win = new FakeTarget() as FakeEnv['window'];
  win.devicePixelRatio = 1;
  win.setTimeout = (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number;
  win.clearTimeout = (id: number) => clearTimeout(id as never);
  if (opts.rawUpdate) win.onpointerrawupdate = null;
  const doc = new FakeTarget() as FakeEnv['document'];
  doc.visibilityState = 'visible';
  doc.pointerLockElement = null;
  doc.exitPointerLock = () => {
    if (doc.pointerLockElement) {
      doc.pointerLockElement = null;
      doc.dispatch('pointerlockchange');
    }
  };
  const canvas = new FakeTarget() as FakeEnv['canvas'];
  canvas.clientWidth = 1280;
  canvas.clientHeight = 720;
  canvas.width = 1280;
  canvas.height = 720;
  canvas.style = {};
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 720 });
  canvas.setPointerCapture = () => undefined;
  canvas.requestPointerLock = () => {
    doc.pointerLockElement = canvas;
    doc.dispatch('pointerlockchange');
    return Promise.resolve();
  };
  const ctx = fakeContext(log);
  canvas.getContext = () => ctx;
  doc.createElement = () => {
    const c = { width: 1, height: 1, getContext: () => fakeContext(log) };
    return c;
  };
  let frameId = 0;
  const frames = new Map<number, (ts: number) => void>();
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, document: g.document, raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
  g.window = win;
  g.document = doc;
  g.requestAnimationFrame = (fn: (ts: number) => void) => {
    frames.set(++frameId, fn);
    return frameId;
  };
  g.cancelAnimationFrame = (id: number) => {
    frames.delete(id);
  };
  return {
    window: win,
    document: doc,
    canvas,
    log,
    run(ms: number, hz = 120) {
      const step = 1000 / hz;
      const end = time + ms;
      while (time < end) {
        time += step;
        const batch = Array.from(frames.entries());
        frames.clear();
        for (const [, fn] of batch) fn(time);
      }
    },
    now: () => time,
    cleanup() {
      vi.restoreAllMocks();
      g.window = saved.window;
      g.document = saved.document;
      g.requestAnimationFrame = saved.raf;
      g.cancelAnimationFrame = saved.caf;
    },
  };
}

export function pointer(env: FakeEnv, type: string, x: number, y: number, buttons: number, extra: Record<string, unknown> = {}): void {
  env.canvas.dispatch(type, {
    pointerType: 'mouse',
    pointerId: 1,
    clientX: x,
    clientY: y,
    buttons,
    movementX: 0,
    movementY: 0,
    timeStamp: env.now(),
    ...extra,
  });
}

export function key(env: FakeEnv, type: 'keydown' | 'keyup', code: string, extra: Record<string, unknown> = {}): void {
  env.window.dispatch(type, { code, repeat: false, timeStamp: env.now(), ...extra });
}
