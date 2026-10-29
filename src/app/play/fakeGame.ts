// A stand-in for the game engine, used in dev builds with ?fake=1.
// It draws a message and returns a PlayResult made from fixtures after 3 seconds of unpaused time.

import { makeFixture } from '../../analytics/fixtures';
import type { FixtureOptions } from '../../analytics/fixtures';
import type { CreateGame, GameCallbacks, GameHandle, LaunchRequest, PlayResult, Settings } from '../../shared/types';

export const FAKE_PLAY_MS = 3000;

function optionsFor(launch: LaunchRequest): FixtureOptions {
  const base: FixtureOptions = {
    seed: launch.seed,
    modeId: launch.modeId,
    mods: launch.mods,
    presetLevel: launch.presetLevel,
    lengthSec: launch.lengthSec,
    drillId: launch.drillId,
    objects: 160,
    // A planted weakness so insights have something to find after a few plays.
    longAlong: -0.38,
    streamOffsetMs: 14,
  };
  switch (launch.modeId) {
    case 'tracking': return { ...base, jumpsOnly: false, sliderShare: 0.8, streamShare: 0, spinnerShare: 0, objects: 60 };
    case 'spinning': return { ...base, jumpsOnly: false, spinnerShare: 0.9, sliderShare: 0, streamShare: 0, objects: 14, spinnerFail: 0.3 };
    case 'streams': return { ...base, jumpsOnly: false, streamShare: 3, sliderShare: 0, spinnerShare: 0 };
    case 'jumps':
    case 'angles':
    case 'precision':
    case 'reading':
    case 'timing': return { ...base, jumpsOnly: true };
    default: return base;
  }
}

/** A PlayResult for a launch, with the launch itself kept as given. */
export function fakeResult(launch: LaunchRequest, status: PlayResult['status'] = 'completed'): PlayResult {
  const { result } = makeFixture({ ...optionsFor(launch), status, startedAt: Date.now() - 60_000 });
  const startedAt = Date.now() - result.playedMs;
  return {
    ...result,
    launch,
    startedAt,
    endedAt: startedAt + result.playedMs,
    map: { ...result.map, seed: launch.seed, mods: launch.mods },
  };
}

export const createFakeGame: CreateGame = (canvas: HTMLCanvasElement, launch: LaunchRequest, _settings: Settings, cb: GameCallbacks): GameHandle => {
  let paused = false;
  let destroyed = false;
  let finished = false;
  let left = FAKE_PLAY_MS;
  let last = performance.now();
  let raf = 0;

  const draw = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e5e7eb';
    ctx.textAlign = 'center';
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillText('Fake game', w / 2, h / 2 - 12);
    ctx.fillStyle = '#9ca3af';
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillText(paused ? 'Paused' : `Result in ${(left / 1000).toFixed(1)} s. Press Esc to pause.`, w / 2, h / 2 + 16);
  };

  const finish = (status: PlayResult['status']) => {
    if (finished || destroyed) return;
    finished = true;
    cancelAnimationFrame(raf);
    cb.onFinish(fakeResult(launch, status));
  };

  const tick = (now: number) => {
    if (destroyed || finished) return;
    if (!paused) left -= now - last;
    last = now;
    draw();
    if (left <= 0) finish('completed');
    else raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const setPaused = (p: boolean) => {
    if (paused === p || finished || destroyed) return;
    paused = p;
    last = performance.now();
    cb.onPause(p);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape') setPaused(true);
  };
  window.addEventListener('keydown', onKey);

  return {
    resume: () => setPaused(false),
    pause: () => setPaused(true),
    quit: () => finish('quit'),
    setSettings: () => undefined,
    destroy: () => {
      destroyed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
    },
  };
};
