import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DIFFICULTY, DEFAULT_SETTINGS, LEVEL_PRESETS, MODES, TRACE_OP } from '../../shared/catalog';
import type { LaunchRequest, PlaybackCallbacks, PlaybackHandle, PlaybackInfo, PlaybackSource, ReplayData, Settings } from '../../shared/types';
import { AudioEngine } from '../audio/audio';
import { NOISY_PLAYER } from '../sim/autoplay';
import { runHeadless } from '../sim/headless';
import { installFakeDom } from '../testing/fakeDom';
import type { FakeEnv } from '../testing/fakeDom';
import { launchFor } from '../testing/fixtures';
import { ENGINE_VERSION } from '../version';
import { NEWER_ENGINE_MESSAGE, createPlayback } from './playback';

let env: FakeEnv | null = null;
afterEach(() => {
  env?.cleanup();
  env = null;
});

const launch = launchFor(LEVEL_PRESETS[2]!.difficulty, 93, 20);
let cached: ReplayData | null = null;
const replay = (): ReplayData => (cached ??= runHeadless({ launch, model: NOISY_PLAYER, stepMs: 5 }).result.replay as ReplayData);

const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));

async function open(source: PlaybackSource, settings: Settings = DEFAULT_SETTINGS) {
  const e = installFakeDom();
  env = e;
  const infos: PlaybackInfo[] = [];
  const times: number[] = [];
  const errors: string[] = [];
  let ends = 0;
  const cb: PlaybackCallbacks = {
    onReady: (i) => infos.push(i),
    onTime: (t) => times.push(t),
    onEnd: () => ends++,
    onError: (m) => errors.push(m),
  };
  const handle: PlaybackHandle = createPlayback(e.canvas as unknown as HTMLCanvasElement, source, settings, cb);
  await wait();
  return { e, handle, infos, times, errors, ends: () => ends };
}

describe('createPlayback', () => {
  it('reports the duration and zero mismatches for a replay of this engine, after the constructor returns', async () => {
    const e = installFakeDom();
    env = e;
    const infos: PlaybackInfo[] = [];
    createPlayback(e.canvas as unknown as HTMLCanvasElement, { kind: 'replay', replay: replay() }, DEFAULT_SETTINGS, {
      onReady: (i) => infos.push(i),
      onTime: () => undefined,
      onEnd: () => undefined,
      onError: () => undefined,
    });
    expect(infos).toHaveLength(0);
    await wait();
    expect(infos).toHaveLength(1);
    expect(infos[0]!.mismatches).toBe(0);
    expect(infos[0]!.durationMs).toBeGreaterThanOrEqual(replay().endT);
  });

  it('counts judgments that differ from the recorded ones', async () => {
    const r = replay();
    const wrong = { ...r, judgments: r.judgments.replace(/c/g, 'm') };
    const { infos } = await open({ kind: 'replay', replay: wrong });
    expect(infos[0]!.mismatches).toBeGreaterThan(0);
  });

  it('refuses a replay from a newer engine, and plays one from an older engine', async () => {
    const newer = await open({ kind: 'replay', replay: { ...replay(), engineVersion: ENGINE_VERSION + 1 } });
    expect(newer.errors).toEqual([NEWER_ENGINE_MESSAGE]);
    expect(newer.infos).toHaveLength(0);
    env?.cleanup();
    const older = await open({ kind: 'replay', replay: { ...replay(), engineVersion: 1 } });
    expect(older.errors).toEqual([]);
    expect(older.infos).toHaveLength(1);
  });

  it('reports an error for a replay it cannot build', async () => {
    const broken = { ...replay(), map: { ...replay().map, objects: null as never } };
    const { errors } = await open({ kind: 'replay', replay: broken });
    expect(errors).toHaveLength(1);
  });

  it('reports an error when the canvas has no context', () => {
    const e = installFakeDom();
    env = e;
    e.canvas.getContext = () => null;
    const errors: string[] = [];
    const h = createPlayback(e.canvas as unknown as HTMLCanvasElement, { kind: 'replay', replay: replay() }, DEFAULT_SETTINGS, {
      onReady: vi.fn(),
      onTime: vi.fn(),
      onEnd: vi.fn(),
      onError: (m) => errors.push(m),
    });
    expect(errors).toHaveLength(1);
    h.play();
    h.seek(5);
    h.destroy();
  });

  it('stays at 0 until play, then follows the clock at the chosen speed and calls onTime at most 10 times a second', async () => {
    const { e, handle, times } = await open({ kind: 'replay', replay: replay() });
    e.run(500);
    expect(times).toEqual([]);
    handle.play();
    e.run(2000);
    expect(times.length).toBeLessThanOrEqual(21);
    expect(times.length).toBeGreaterThanOrEqual(15);
    const t1 = times[times.length - 1]!;
    expect(t1).toBeGreaterThan(1800);
    expect(t1).toBeLessThan(2100);
    handle.setSpeed(0.25);
    const n = times.length;
    e.run(2000);
    const t2 = times[times.length - 1]!;
    expect(times.length).toBeGreaterThan(n);
    expect(t2 - t1).toBeGreaterThan(400);
    expect(t2 - t1).toBeLessThan(600);
    handle.pause();
    e.run(1000);
    const frozen = times[times.length - 1]!;
    e.run(1000);
    expect(times[times.length - 1]).toBe(frozen);
    handle.setSpeed(9);
    handle.play();
    e.run(1000);
    expect(times[times.length - 1]! - frozen).toBeGreaterThan(1800);
    expect(times[times.length - 1]! - frozen).toBeLessThan(2200);
  });

  it('applies the last of several seeks in a frame, once, and reports the time', async () => {
    const { e, handle, times } = await open({ kind: 'replay', replay: replay() });
    handle.seek(3000);
    handle.seek(8000);
    handle.seek(5000);
    expect(times).toEqual([]);
    e.run(20);
    expect(times).toEqual([5000]);
    e.run(200);
    expect(times).toEqual([5000]);
    // A seek back rebuilds the session and draws.
    const calls = e.log.calls;
    handle.seek(1000);
    e.run(20);
    expect(times).toEqual([5000, 1000]);
    expect(e.log.calls).toBeGreaterThan(calls);
  });

  it('clamps seeks to the length of the play', async () => {
    const { e, handle, times, infos } = await open({ kind: 'replay', replay: replay() });
    handle.seek(-50);
    e.run(20);
    handle.seek(1e9);
    e.run(20);
    expect(times).toEqual([0, infos[0]!.durationMs]);
  });

  it('plays to the end, calls onEnd once, and starts over on the next play', async () => {
    const { e, handle, times, ends, infos } = await open({ kind: 'replay', replay: replay() });
    handle.setSpeed(2);
    handle.seek(infos[0]!.durationMs - 1500);
    handle.play();
    e.run(500);
    expect(ends()).toBe(0);
    e.run(1500);
    expect(ends()).toBe(1);
    expect(times[times.length - 1]).toBe(infos[0]!.durationMs);
    e.run(500);
    expect(ends()).toBe(1);
    handle.play();
    e.run(200);
    expect(times[times.length - 1]).toBeLessThan(1000);
  });

  it('draws every frame, including while paused', async () => {
    const { e, handle } = await open({ kind: 'replay', replay: replay() });
    handle.seek(4000);
    e.run(100);
    const a = e.log.calls;
    e.run(100);
    expect(e.log.calls).toBeGreaterThan(a);
  });

  it('plays hit sounds only at normal speed while playing forward', async () => {
    const spy = vi.spyOn(AudioEngine.prototype, 'onEvent');
    const { e, handle } = await open({ kind: 'replay', replay: replay() });
    // A seek makes no sound.
    handle.seek(6000);
    e.run(50);
    expect(spy).not.toHaveBeenCalled();
    // Normal speed does.
    handle.play();
    e.run(6000);
    const normal = spy.mock.calls.length;
    expect(normal).toBeGreaterThan(5);
    // Not at 2x, and not at 0.5x.
    handle.setSpeed(2);
    e.run(3000);
    handle.setSpeed(0.5);
    e.run(1000);
    expect(spy.mock.calls.length).toBe(normal);
  });

  it('repeats an autoplay source without ending', async () => {
    const short = launchFor(LEVEL_PRESETS[1]!.difficulty, 5, 10);
    const { e, handle, infos, times, ends, errors } = await open({ kind: 'autoplay', launch: short, loop: true });
    expect(errors).toEqual([]);
    expect(infos[0]!.mismatches).toBe(0);
    handle.setSpeed(2);
    handle.seek(infos[0]!.durationMs - 400);
    handle.play();
    e.run(1500);
    expect(ends()).toBe(0);
    expect(times.some((t) => t < 600)).toBe(true);
    expect(times.some((t) => t > infos[0]!.durationMs - 300)).toBe(true);
  });

  it('ends an autoplay source without a loop', async () => {
    const short = launchFor(LEVEL_PRESETS[1]!.difficulty, 5, 10);
    const { e, handle, infos, ends } = await open({ kind: 'autoplay', launch: short, loop: false });
    handle.setSpeed(2);
    handle.seek(infos[0]!.durationMs - 400);
    handle.play();
    e.run(1500);
    expect(ends()).toBe(1);
  });

  it('shows the level of an adaptive set, also one that was still open when the play ended', async () => {
    const mix: LaunchRequest = {
      ...launchFor(DEFAULT_DIFFICULTY, 8, 60, [], 'mix'),
      options: { ...MODES.mix.defaultOptions, mixModules: ['jumps', 'streams', 'tracking'] },
      levels: { jumps: 4, streams: 4, tracking: 3 },
    };
    const live = runHeadless({ launch: mix, model: NOISY_PLAYER, stepMs: 4, maxMs: 26000 });
    const { e, handle, infos } = await open({ kind: 'replay', replay: live.result.replay as ReplayData });
    const rs = (handle as unknown as { rs: { level: number | null; set: number | null } }).rs;
    const status = live.session.levelStatus() as { level: number; set: number };
    expect(status.set).toBeGreaterThan(1);
    // The play ended inside this set, so it has no level step of its own.
    expect(live.result.levels.some((s) => s.set === status.set)).toBe(false);
    handle.seek(infos[0]!.durationMs);
    e.run(50);
    expect(rs.set).toBe(status.set);
    expect(rs.level).toBe(status.level);
    // Earlier in the play, an earlier set shows its own level.
    handle.seek(3000);
    e.run(50);
    expect(rs.set).toBe(0);
    expect(rs.level).toBe(live.result.levels[0]!.level);
  });

  it('makes a click ripple for a press in the trace', async () => {
    const { e, handle } = await open({ kind: 'replay', replay: replay() });
    const fx = (handle as unknown as { fx: { live: { ripples: number } } }).fx;
    const r = replay();
    let firstPress = -1;
    for (let i = 0; i < r.trace.count; i++) {
      const op = r.trace.ops[i] as number;
      if (op >= TRACE_OP.pressAt && op < TRACE_OP.release) {
        firstPress = r.trace.t[i] as number;
        break;
      }
    }
    expect(firstPress).toBeGreaterThan(0);
    handle.seek(firstPress + 20);
    e.run(30);
    expect(fx.live.ripples).toBeGreaterThanOrEqual(1);
    // Not with the skin option off.
    handle.setSettings({ ...DEFAULT_SETTINGS, skin: { ...DEFAULT_SETTINGS.skin, clickRipple: false } });
    handle.seek(firstPress + 3000);
    e.run(2000);
    handle.seek(firstPress + 20);
    e.run(30);
    expect(fx.live.ripples).toBe(0);
  });

  it('takes new settings and stops drawing after destroy', async () => {
    const { e, handle } = await open({ kind: 'replay', replay: replay() });
    handle.setSettings({ ...DEFAULT_SETTINGS, display: { ...DEFAULT_SETTINGS.display, earlyLate: false } });
    handle.play();
    e.run(300);
    handle.destroy();
    handle.destroy();
    const calls = e.log.calls;
    e.run(300);
    expect(e.log.calls).toBe(calls);
    expect(e.window.count('resize')).toBe(0);
  });

  it('does nothing when destroyed before it finished loading', async () => {
    const e = installFakeDom();
    env = e;
    const infos: PlaybackInfo[] = [];
    const h = createPlayback(e.canvas as unknown as HTMLCanvasElement, { kind: 'replay', replay: replay() }, DEFAULT_SETTINGS, {
      onReady: (i) => infos.push(i),
      onTime: () => undefined,
      onEnd: () => undefined,
      onError: () => undefined,
    });
    h.destroy();
    await wait();
    expect(infos).toHaveLength(0);
  });

  it('starts playing when play() came before the replay was ready', async () => {
    const e = installFakeDom();
    env = e;
    const times: number[] = [];
    const h = createPlayback(e.canvas as unknown as HTMLCanvasElement, { kind: 'replay', replay: replay() }, DEFAULT_SETTINGS, {
      onReady: () => undefined,
      onTime: (t) => times.push(t),
      onEnd: () => undefined,
      onError: () => undefined,
    });
    h.play();
    await wait();
    e.run(500);
    expect(times.length).toBeGreaterThan(2);
  });
});
