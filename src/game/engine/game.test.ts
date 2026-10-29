import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DIFFICULTY, DEFAULT_SETTINGS, LEVEL_PRESETS } from '../../shared/catalog';
import type { GameCallbacks, GameHandle, PlayResult, Settings } from '../../shared/types';
import { installFakeDom, key, pointer } from '../testing/fakeDom';
import type { FakeEnv } from '../testing/fakeDom';
import { launchFor } from '../testing/fixtures';
import { createGameImpl } from './game';

let env: FakeEnv | null = null;
afterEach(() => {
  env?.cleanup();
  env = null;
});

function start(overrides: { settings?: Partial<Settings['input']>; mode?: 'dynamic' | 'jumps'; rawUpdate?: boolean; length?: number } = {}) {
  const e = installFakeDom({ rawUpdate: overrides.rawUpdate });
  env = e;
  const results: PlayResult[] = [];
  const pauses: boolean[] = [];
  const errors: string[] = [];
  const callbacks: GameCallbacks = {
    onPause: (p) => pauses.push(p),
    onFinish: (r) => results.push(r),
    onError: (m) => errors.push(m),
  };
  const settings: Settings = { ...DEFAULT_SETTINGS, input: { ...DEFAULT_SETTINGS.input, ...overrides.settings } };
  const mode = overrides.mode ?? 'dynamic';
  const launch = launchFor(mode === 'dynamic' ? LEVEL_PRESETS[2]!.difficulty : DEFAULT_DIFFICULTY, 5, overrides.length ?? 20, [], mode);
  const handle: GameHandle = createGameImpl(e.canvas as unknown as HTMLCanvasElement, launch, settings, callbacks);
  return { e, handle, results, pauses, errors };
}

describe('createGame', () => {
  it('shows the start screen and waits for input', () => {
    const { e, results, errors } = start();
    e.run(500);
    expect(errors).toEqual([]);
    expect(results).toEqual([]);
    expect(e.log.names.get('fillText')).toBeGreaterThan(2);
  });

  it('starts on a click and finishes once when the map ends', () => {
    const { e, handle, results } = start({ length: 12 });
    pointer(e, 'pointerdown', 600, 300, 1);
    pointer(e, 'pointerup', 600, 300, 0);
    e.run(30000);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('failed');
    handle.destroy();
    expect(results).toHaveLength(1);
  });

  it('quits with a result and never fires twice', () => {
    const { e, handle, results } = start({ mode: 'jumps' });
    key(e, 'keydown', 'KeyZ');
    key(e, 'keyup', 'KeyZ');
    e.run(3000);
    handle.quit();
    handle.quit();
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('quit');
    expect(results[0]!.input.displayHz).toBeGreaterThan(100);
    handle.destroy();
    handle.destroy();
    expect(results).toHaveLength(1);
  });

  it('completes a training play when the length is up', () => {
    const { e, results } = start({ mode: 'jumps', length: 10 });
    key(e, 'keydown', 'KeyX');
    e.run(60000);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('completed');
    expect(results[0]!.levels.length).toBeGreaterThan(0);
  });

  it('presses keys and mouse buttons into the play', () => {
    const { e, handle, results } = start({ mode: 'jumps' });
    pointer(e, 'pointerdown', 640, 360, 1);
    pointer(e, 'pointerup', 640, 360, 0);
    e.run(2500);
    for (let i = 0; i < 20; i++) {
      pointer(e, 'pointermove', 100 + i * 40, 200, 0);
      key(e, 'keydown', 'KeyZ');
      key(e, 'keyup', 'KeyZ');
      pointer(e, 'pointerdown', 300, 300, 2);
      pointer(e, 'pointerup', 300, 300, 0);
      e.run(100);
    }
    handle.quit();
    const r = results[0]!;
    expect(r.strayPresses + r.records.length).toBeGreaterThan(5);
    expect(r.input.pointer).toBe('mouse');
  });

  it('pauses on Escape, resumes through a countdown, and keeps play time still', () => {
    const { e, handle, results, pauses } = start({ mode: 'jumps' });
    key(e, 'keydown', 'KeyZ');
    key(e, 'keyup', 'KeyZ');
    e.run(1000);
    key(e, 'keydown', 'Escape');
    expect(pauses).toEqual([true]);
    e.run(5000);
    handle.resume();
    expect(pauses).toEqual([true, false]);
    e.run(1100);
    handle.quit();
    const r = results[0]!;
    expect(r.pauses).toBe(1);
    // About a second before the pause and about 0.1 s after the countdown.
    expect(r.playedMs).toBeGreaterThan(900);
    expect(r.playedMs).toBeLessThan(1500);
  });

  it('pauses when the tab is hidden or the window loses focus', () => {
    const { e, pauses } = start({ mode: 'jumps' });
    key(e, 'keydown', 'KeyZ');
    e.run(500);
    e.document.visibilityState = 'hidden';
    e.document.dispatch('visibilitychange');
    expect(pauses).toEqual([true]);
    e.document.visibilityState = 'visible';
    e.window.dispatch('blur');
    expect(pauses).toEqual([true]);
  });

  it('locks the pointer in raw mode and moves the cursor by deltas', async () => {
    const { e, handle, results, pauses } = start({ settings: { rawInput: true, sensitivity: 2 }, mode: 'jumps' });
    pointer(e, 'pointermove', 640, 360, 0);
    pointer(e, 'pointerdown', 640, 360, 1);
    pointer(e, 'pointerup', 640, 360, 0);
    await Promise.resolve();
    await Promise.resolve();
    expect(e.document.pointerLockElement).toBe(e.canvas);
    e.run(2200);
    for (let i = 0; i < 40; i++) {
      pointer(e, 'pointermove', 0, 0, 0, { movementX: 5, movementY: 1 });
      e.run(8);
    }
    // Losing the lock pauses.
    e.document.pointerLockElement = null;
    e.document.dispatch('pointerlockchange');
    expect(pauses).toEqual([true]);
    handle.resume();
    await Promise.resolve();
    await Promise.resolve();
    expect(pauses).toEqual([true, false]);
    e.run(1100);
    handle.quit();
    expect(results[0]!.input.rawInput).toBe(true);
    expect(results[0]!.input.unadjusted).toBe(true);
  });

  it('falls back to a click when the lock cannot be taken again', async () => {
    const { e, handle, pauses } = start({ settings: { rawInput: true }, mode: 'jumps' });
    pointer(e, 'pointerdown', 640, 360, 1);
    await Promise.resolve();
    e.run(500);
    e.document.pointerLockElement = null;
    e.document.dispatch('pointerlockchange');
    expect(pauses).toEqual([true]);
    const real = e.canvas.requestPointerLock as () => Promise<void>;
    e.canvas.requestPointerLock = () => Promise.reject(new Error('blocked'));
    handle.resume();
    await new Promise((r) => setTimeout(r, 5));
    e.run(100);
    e.canvas.requestPointerLock = real;
    pointer(e, 'pointerdown', 640, 360, 1);
    await Promise.resolve();
    await Promise.resolve();
    e.run(1200);
    expect(e.document.pointerLockElement).toBe(e.canvas);
    handle.destroy();
  });

  it('goes back to the pause menu on Escape while it waits for a click', async () => {
    const { e, handle, pauses } = start({ settings: { rawInput: true }, mode: 'jumps' });
    pointer(e, 'pointerdown', 640, 360, 1);
    await new Promise((r) => setTimeout(r, 5));
    e.run(500);
    e.document.pointerLockElement = null;
    e.document.dispatch('pointerlockchange');
    const real = e.canvas.requestPointerLock as () => Promise<void>;
    e.canvas.requestPointerLock = () => Promise.reject(new Error('blocked'));
    handle.resume();
    await new Promise((r) => setTimeout(r, 5));
    e.run(50);
    expect(pauses).toEqual([true, false]);
    key(e, 'keydown', 'Escape');
    expect(pauses).toEqual([true, false, true]);
    // The menu works again.
    e.canvas.requestPointerLock = real;
    handle.resume();
    await new Promise((r) => setTimeout(r, 5));
    e.run(1100);
    expect(pauses).toEqual([true, false, true, false]);
    expect(e.document.pointerLockElement).toBe(e.canvas);
    handle.destroy();
  });

  it('gives up on raw input after two failed locks and plays on', async () => {
    const { e, handle, results, pauses } = start({ settings: { rawInput: true }, mode: 'jumps' });
    pointer(e, 'pointerdown', 640, 360, 1);
    await new Promise((r) => setTimeout(r, 5));
    e.run(500);
    e.document.pointerLockElement = null;
    e.document.dispatch('pointerlockchange');
    e.canvas.requestPointerLock = () => Promise.reject(new Error('blocked'));
    handle.resume();
    await new Promise((r) => setTimeout(r, 5));
    pointer(e, 'pointerdown', 640, 360, 1);
    await new Promise((r) => setTimeout(r, 5));
    e.run(1200);
    expect(pauses).toEqual([true, false]);
    const before = e.now();
    e.run(2000);
    handle.quit();
    expect(e.now() - before).toBeGreaterThan(1000);
    expect(results[0]!.playedMs).toBeGreaterThan(2000);
    // Absolute input from here on: movement events move the cursor again.
    handle.destroy();
  });

  it('records a failed play when the player quits during the out of health banner', () => {
    const { e, handle, results } = start({ mode: 'dynamic', length: 60 });
    pointer(e, 'pointerdown', 600, 300, 1);
    const state = () => (handle as unknown as { state: string }).state;
    let guard = 0;
    while (state() !== 'failing' && guard++ < 600) e.run(100);
    expect(state()).toBe('failing');
    handle.quit();
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('failed');
  });

  it('lets go of a lock that arrives after destroy', async () => {
    const { e, handle } = start({ settings: { rawInput: true }, mode: 'jumps' });
    let grant: () => void = () => undefined;
    e.canvas.requestPointerLock = () =>
      new Promise<void>((resolve) => {
        grant = () => {
          e.document.pointerLockElement = e.canvas;
          e.document.dispatch('pointerlockchange');
          resolve();
        };
      });
    pointer(e, 'pointerdown', 640, 360, 1);
    handle.destroy();
    grant();
    await new Promise((r) => setTimeout(r, 5));
    expect(e.document.pointerLockElement).toBeNull();
  });

  it('removes its listeners on destroy', () => {
    const { e, handle } = start();
    expect(e.window.count('keydown')).toBeGreaterThan(0);
    handle.destroy();
    expect(e.window.count('keydown')).toBe(0);
    expect(e.window.count('keyup')).toBe(0);
    expect(e.canvas.count('pointerdown')).toBe(0);
    expect(e.document.count('visibilitychange')).toBe(0);
  });

  it('reports an error when the canvas has no context', () => {
    const e = installFakeDom();
    env = e;
    e.canvas.getContext = () => null;
    const errors: string[] = [];
    createGameImpl(e.canvas as unknown as HTMLCanvasElement, launchFor(), DEFAULT_SETTINGS, { onPause: vi.fn(), onFinish: vi.fn(), onError: (m) => errors.push(m) });
    expect(errors).toHaveLength(1);
  });
});
