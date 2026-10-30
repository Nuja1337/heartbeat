import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DIFFICULTY, DEFAULT_SETTINGS, LEVEL_PRESETS, TRACE_OP } from '../../shared/catalog';
import { decodeReplay, encodeReplay } from '../../shared/replay';
import type { GameCallbacks, GameHandle, ModId, PlayResult, Settings } from '../../shared/types';
import { installFakeDom, key, pointer } from '../testing/fakeDom';
import type { FakeEnv } from '../testing/fakeDom';
import { ReplayRunner } from '../replay/feed';
import { launchFor } from '../testing/fixtures';
import { createGameImpl } from './game';

let env: FakeEnv | null = null;
afterEach(() => {
  env?.cleanup();
  env = null;
});

function start(
  overrides: {
    settings?: Partial<Settings['input']>;
    display?: Partial<Settings['display']>;
    audio?: Partial<Settings['audio']>;
    mode?: 'dynamic' | 'jumps';
    rawUpdate?: boolean;
    length?: number;
    noRetry?: boolean;
    mods?: ModId[];
  } = {},
) {
  const e = installFakeDom({ rawUpdate: overrides.rawUpdate });
  env = e;
  const results: PlayResult[] = [];
  const pauses: boolean[] = [];
  const errors: string[] = [];
  const retries: PlayResult[] = [];
  const callbacks: GameCallbacks = {
    onPause: (p) => pauses.push(p),
    onFinish: (r) => results.push(r),
    onError: (m) => errors.push(m),
    ...(overrides.noRetry ? {} : { onRetry: (r: PlayResult) => retries.push(r) }),
  };
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    input: { ...DEFAULT_SETTINGS.input, ...overrides.settings },
    display: { ...DEFAULT_SETTINGS.display, ...overrides.display },
    audio: { ...DEFAULT_SETTINGS.audio, ...overrides.audio },
  };
  const mode = overrides.mode ?? 'dynamic';
  const launch = launchFor(mode === 'dynamic' ? LEVEL_PRESETS[2]!.difficulty : DEFAULT_DIFFICULTY, 5, overrides.length ?? 20, overrides.mods ?? [], mode);
  const handle: GameHandle = createGameImpl(e.canvas as unknown as HTMLCanvasElement, launch, settings, callbacks);
  return { e, handle, results, pauses, errors, retries };
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

describe('quick retry', () => {
  const begin = (e: FakeEnv) => {
    key(e, 'keydown', 'KeyZ');
    key(e, 'keyup', 'KeyZ');
    e.run(500);
  };

  it('ends the play with status quit after a 300 ms hold, and calls onRetry instead of onFinish', () => {
    const { e, results, retries } = start({ mode: 'jumps' });
    begin(e);
    key(e, 'keydown', 'Backquote');
    e.run(250);
    expect(retries).toHaveLength(0);
    e.run(100);
    expect(retries).toHaveLength(1);
    expect(retries[0]!.status).toBe('quit');
    expect(retries[0]!.replay).toBeDefined();
    expect(results).toHaveLength(0);
    key(e, 'keyup', 'Backquote');
    e.run(500);
    expect(retries).toHaveLength(1);
    expect(results).toHaveLength(0);
  });

  it('ends a play whose health already ran out with status failed, as quit() does', () => {
    const { e, handle, results, retries } = start({ mode: 'dynamic' });
    begin(e);
    // The health runs out between two frames, then the player pauses and holds the retry key.
    const session = (handle as unknown as { session: { advance(t: number): void; now: number; failed: boolean } }).session;
    session.advance(session.now + 60000);
    expect(session.failed).toBe(true);
    key(e, 'keydown', 'Escape');
    key(e, 'keydown', 'Backquote');
    e.run(350);
    expect(retries).toHaveLength(1);
    expect(retries[0]!.status).toBe('failed');
    expect(results).toHaveLength(0);
  });

  it('does nothing when the key is let go at 200 ms', () => {
    const { e, handle, results, retries } = start({ mode: 'jumps' });
    begin(e);
    key(e, 'keydown', 'Backquote');
    e.run(200);
    key(e, 'keyup', 'Backquote');
    e.run(600);
    expect(retries).toHaveLength(0);
    // The hold starts over on the next press.
    key(e, 'keydown', 'Backquote');
    e.run(150);
    key(e, 'keyup', 'Backquote');
    e.run(400);
    expect(retries).toHaveLength(0);
    handle.quit();
    expect(results).toHaveLength(1);
  });

  it('hands the renderer the progress of the hold', () => {
    const { e, handle } = start({ mode: 'jumps' });
    begin(e);
    const rs = (handle as unknown as { rs: { retry?: number } }).rs;
    expect(rs.retry).toBe(0);
    key(e, 'keydown', 'Backquote');
    e.run(150);
    expect(rs.retry!).toBeGreaterThan(0.3);
    expect(rs.retry!).toBeLessThan(0.8);
    key(e, 'keyup', 'Backquote');
    e.run(50);
    expect(rs.retry).toBe(0);
  });

  it('does nothing when onRetry is not given', () => {
    const { e, handle, results } = start({ mode: 'jumps', noRetry: true });
    begin(e);
    key(e, 'keydown', 'Backquote');
    e.run(800);
    key(e, 'keyup', 'Backquote');
    expect(results).toHaveLength(0);
    handle.quit();
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('quit');
  });

  it('is off when the retry key is empty', () => {
    const { e, retries } = start({ mode: 'jumps', settings: { retryKey: '' } });
    begin(e);
    key(e, 'keydown', 'Backquote');
    e.run(600);
    expect(retries).toHaveLength(0);
  });

  it('never fires from Escape or a hit key', () => {
    for (const code of ['Escape', 'KeyZ']) {
      const { e, retries, handle } = start({ mode: 'jumps', settings: { retryKey: code } });
      begin(e);
      key(e, 'keydown', code);
      e.run(600);
      key(e, 'keyup', code);
      expect(retries, code).toHaveLength(0);
      handle.destroy();
      e.cleanup();
      env = null;
    }
  });

  it('counts while the play is paused', () => {
    const { e, retries, pauses } = start({ mode: 'jumps' });
    begin(e);
    key(e, 'keydown', 'Escape');
    expect(pauses).toEqual([true]);
    key(e, 'keydown', 'Backquote');
    e.run(350);
    expect(retries).toHaveLength(1);
    expect(retries[0]!.status).toBe('quit');
  });

  it('counts during the resume countdown', () => {
    const { e, handle, retries } = start({ mode: 'jumps' });
    begin(e);
    key(e, 'keydown', 'Escape');
    handle.resume();
    e.run(100);
    key(e, 'keydown', 'Backquote');
    e.run(350);
    expect(retries).toHaveLength(1);
  });

  it('does not fire on the start screen', () => {
    const { e, retries } = start({ mode: 'jumps' });
    e.run(100);
    key(e, 'keydown', 'Backquote');
    e.run(600);
    expect(retries).toHaveLength(0);
  });

  it('gives the pointer lock back', async () => {
    const { e, retries } = start({ mode: 'jumps', settings: { rawInput: true } });
    pointer(e, 'pointerdown', 640, 360, 1);
    pointer(e, 'pointerup', 640, 360, 0);
    await Promise.resolve();
    await Promise.resolve();
    e.run(500);
    expect(e.document.pointerLockElement).toBe(e.canvas);
    key(e, 'keydown', 'Backquote');
    e.run(350);
    expect(retries).toHaveLength(1);
    expect(e.document.pointerLockElement).toBeNull();
  });

  it('forgets a held key when the window loses focus', () => {
    const { e, retries } = start({ mode: 'jumps' });
    begin(e);
    key(e, 'keydown', 'Backquote');
    e.run(100);
    e.window.dispatch('blur');
    e.run(600);
    expect(retries).toHaveLength(0);
  });
});

describe('recording in the game', () => {
  it('puts a replay and the offsets in the result', () => {
    const { e, handle, results } = start({ mode: 'jumps', display: { visualOffsetMs: 12 }, audio: { offsetMs: 40 } });
    pointer(e, 'pointerdown', 640, 360, 1);
    pointer(e, 'pointerup', 640, 360, 0);
    e.run(2500);
    for (let i = 0; i < 10; i++) {
      pointer(e, 'pointermove', 100 + i * 40, 200, 0);
      key(e, 'keydown', 'KeyZ');
      key(e, 'keyup', 'KeyZ');
      e.run(60);
    }
    handle.quit();
    const r = results[0]!;
    expect(r.input.visualOffsetMs).toBe(12);
    expect(r.input.audioOffsetMs).toBe(40);
    const replay = r.replay!;
    expect(replay.endT).toBe(r.playedMs);
    expect(replay.trace.count).toBeGreaterThan(100);
    const back = decodeReplay(encodeReplay(replay));
    expect(back.trace.count).toBe(replay.trace.count);
    expect(back.judgments).toBe(replay.judgments);
  });

  for (const mode of ['dynamic', 'jumps'] as const) {
    it(`${mode}: a ReplayRunner over the game's replay reproduces the records, through the decimator, syncCursor, pause and resume`, () => {
      const { e, handle, results } = start({ mode, length: 60, mods: mode === 'dynamic' ? ['nofail'] : [] });
      // The start click, a dense burst of pointer samples, hits, a pause and a resume, then more of the same.
      pointer(e, 'pointerdown', 600, 300, 1);
      pointer(e, 'pointerup', 600, 300, 0);
      const burst = (n: number, x0: number) => {
        const t0 = e.now();
        for (let i = 0; i < n; i++) pointer(e, 'pointermove', x0 + (i % 400), 150 + (i % 200), 0, { timeStamp: t0 + i * 0.1 });
      };
      e.run(2200);
      for (let round = 0; round < 3; round++) {
        for (let i = 0; i < 25; i++) {
          burst(30, 100 + i * 30);
          key(e, 'keydown', i % 2 ? 'KeyZ' : 'KeyX');
          e.run(40);
          key(e, 'keyup', i % 2 ? 'KeyZ' : 'KeyX');
          e.run(30);
        }
        // Pause with a key held, move while paused, resume through the countdown.
        key(e, 'keydown', 'KeyZ');
        e.run(20);
        key(e, 'keydown', 'Escape');
        pointer(e, 'pointermove', 333, 222, 0);
        e.run(400);
        handle.resume();
        e.run(1200);
      }
      handle.quit();
      const r = results[0]!;
      const replay = r.replay!;
      const ops = Array.from(replay.trace.ops);
      expect(ops.filter((o) => o === TRACE_OP.pause)).toHaveLength(3);
      expect(ops.filter((o) => o === TRACE_OP.resume)).toHaveLength(3);
      expect(ops.filter((o) => o === TRACE_OP.move).length).toBeGreaterThan(300);
      expect(r.records.length).toBeGreaterThan(5);
      const run = new ReplayRunner(decodeReplay(encodeReplay(replay)));
      run.feedAll();
      const again = run.session.finish(r.status, { startedAt: 0, endedAt: 0, input: r.input });
      expect(again.records).toEqual(r.records);
      expect(again.score).toBe(r.score);
      expect(again.counts).toEqual(r.counts);
      expect(again.maxCombo).toBe(r.maxCombo);
      expect(again.strayPresses).toBe(r.strayPresses);
      expect(again.pauses).toBe(r.pauses);
      expect(again.healthAtEnd).toBe(r.healthAtEnd);
      expect(run.judgments()).toBe(replay.judgments);
    });
  }

  it('writes the 99th percentile frame time into the result', () => {
    const { e, handle, results } = start({ mode: 'jumps' });
    key(e, 'keydown', 'KeyZ');
    key(e, 'keyup', 'KeyZ');
    // 240 Hz is 4.17 ms a frame.
    e.run(1500, 240);
    handle.quit();
    const p99 = results[0]!.input.frameP99Ms;
    expect(p99).toBeGreaterThan(4);
    expect(p99).toBeLessThan(4.4);
  });

  it('leaves frameP99Ms null for a play too short to measure', () => {
    const { e, handle, results } = start({ mode: 'jumps' });
    key(e, 'keydown', 'KeyZ');
    e.run(60, 240);
    handle.quit();
    expect(results[0]!.input.frameP99Ms).toBeNull();
  });

  it('makes a click ripple on a press, unless the skin or reduced motion turns it off', () => {
    const ripples = (opts: Parameters<typeof start>[0], skin: Partial<Settings['skin']> = {}) => {
      const { e, handle } = start(opts);
      if (Object.keys(skin).length > 0) handle.setSettings({ ...DEFAULT_SETTINGS, display: { ...DEFAULT_SETTINGS.display, ...opts?.display }, skin: { ...DEFAULT_SETTINGS.skin, ...skin } });
      key(e, 'keydown', 'KeyZ');
      key(e, 'keyup', 'KeyZ');
      e.run(300);
      pointer(e, 'pointermove', 500, 300, 0);
      key(e, 'keydown', 'KeyX');
      const fx = (handle as unknown as { fx: { live: { ripples: number } } }).fx;
      const n = fx.live.ripples;
      handle.destroy();
      return n;
    };
    expect(ripples({ mode: 'jumps' })).toBeGreaterThanOrEqual(1);
    expect(ripples({ mode: 'jumps' }, { clickRipple: false })).toBe(0);
    expect(ripples({ mode: 'jumps', display: { reduceMotion: true } })).toBe(0);
  });

  it('takes a new palette from setSettings', () => {
    const { e, handle } = start({ mode: 'jumps' });
    e.run(100);
    const renderer = (handle as unknown as { renderer: { currentSkin: { palette: string } } }).renderer;
    expect(renderer.currentSkin.palette).toBe('heartbeat');
    handle.setSettings({ ...DEFAULT_SETTINGS, skin: { ...DEFAULT_SETTINGS.skin, palette: 'contrast' } });
    expect(renderer.currentSkin.palette).toBe('contrast');
    e.run(50);
    expect(renderer.currentSkin.palette).toBe('contrast');
    handle.destroy();
  });

  it('feeds the session at most one move per 0.5 ms and draws the newest sample', () => {
    const { e, handle, results } = start({ mode: 'jumps' });
    pointer(e, 'pointerdown', 640, 360, 1);
    pointer(e, 'pointerup', 640, 360, 0);
    e.run(300);
    const t0 = e.now();
    const before = (handle as unknown as { session: { cursor: { size: number } } }).session.cursor.size;
    for (let i = 0; i < 200; i++) pointer(e, 'pointermove', 400 + i, 300, 0, { timeStamp: t0 + i * 0.1 });
    const rs = (handle as unknown as { rs: { cursorX: number } }).rs;
    const fed = (handle as unknown as { session: { cursor: { size: number } } }).session.cursor.size - before;
    // 200 samples over 20 ms are thinned to about 40, and the drawn cursor already follows the last one.
    expect(fed).toBeLessThanOrEqual(41);
    expect(fed).toBeGreaterThan(20);
    expect(rs.cursorX).toBeGreaterThan(300);
    e.run(50);
    handle.quit();
    expect(results).toHaveLength(1);
  });
});
