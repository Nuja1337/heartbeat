import { describe, expect, it } from 'vitest';
import { DEFAULT_DIFFICULTY, DEFAULT_SETTINGS, LEVEL_PRESETS, MODES } from '../../shared/catalog';
import type { ModId, ModeId } from '../../shared/types';
import { computeLayout, Playfield } from '../engine/playfield';
import { fakeCanvasFactory, fakeContext } from '../testing/fakes';
import type { CallLog } from '../testing/fakes';
import { launchFor } from '../testing/fixtures';
import { NOISY_PLAYER, PERFECT_PLAYER } from '../sim/autoplay';
import { runHeadless } from '../sim/headless';
import { Effects } from './effects';
import { Renderer } from './renderer';
import type { OverlayKind, RenderState } from './renderer';

function setup(log: CallLog) {
  const pf = new Playfield({} as HTMLCanvasElement);
  pf.layout = computeLayout(1280, 720);
  pf.dpr = 2;
  return new Renderer(fakeContext(log), pf, fakeCanvasFactory(log));
}

function play(modeId: ModeId, mods: ModId[], model = PERFECT_PLAYER, overlay: OverlayKind = 'none', lengthSec = 30) {
  const log: CallLog = { calls: 0, names: new Map() };
  const renderer = setup(log);
  const fx = new Effects();
  const base = { ...launchFor(modeId === 'dynamic' ? LEVEL_PRESETS[5]!.difficulty : DEFAULT_DIFFICULTY, 77, lengthSec, mods, modeId), options: MODES[modeId].defaultOptions };
  let frames = 0;
  let rs: RenderState | null = null;
  const flags = { earlyLate: true, crispPopups: true, reduceMotion: false };
  runHeadless({
    launch: base,
    model,
    listener: (e) => fx.onEvent(e, e.t, null, flags),
    onFrame: (t, session) => {
      if (!rs) {
        rs = {
          session,
          fx,
          settings: { ...DEFAULT_SETTINGS, input: { ...DEFAULT_SETTINGS.input, cursor: 'drawn', cursorTrail: true }, display: { ...DEFAULT_SETTINGS.display, showFps: true } },
          playT: 0,
          now: 0,
          cursorX: 500,
          cursorY: 300,
          drawCursor: true,
          overlay,
          overlayT0: 0,
          startLabel: 'Z',
          raw: false,
          fps: 144,
          showScore: !MODES[modeId].adaptive,
          level: 3.5,
          set: 1,
          lengthMs: lengthSec * 1000,
        };
      }
      rs.playT = t;
      rs.now = t;
      rs.cursorX = session.cursor.lastX;
      rs.cursorY = session.cursor.lastY;
      renderer.render(rs);
      frames++;
    },
  });
  return { log, frames };
}

describe('Renderer', () => {
  const modes: ModeId[] = ['dynamic', 'jumps', 'streams', 'tracking', 'spinning', 'precision', 'reading', 'timing', 'warmup'];

  it('draws every mode without throwing', () => {
    for (const m of modes) {
      const { log, frames } = play(m, []);
      expect(frames, m).toBeGreaterThan(100);
      expect(log.calls, m).toBeGreaterThan(1000);
    }
  });

  it('draws with Fade, Spotlight and Mirror', () => {
    for (const mods of [['fade'], ['spotlight'], ['mirror', 'fade', 'spotlight']] as ModId[][]) {
      const { frames } = play('dynamic', mods, NOISY_PLAYER);
      expect(frames).toBeGreaterThan(100);
    }
  });

  it('draws sliders, targets and text', () => {
    const { log } = play('dynamic', [], PERFECT_PLAYER, 'none', 60);
    expect(log.names.get('drawImage')).toBeGreaterThan(50);
    expect(log.names.get('fillText')).toBeGreaterThan(50);
  });

  it('draws every overlay', () => {
    for (const o of ['ready', 'countdown', 'needsClick', 'failing'] as OverlayKind[]) {
      const { frames } = play('jumps', [], PERFECT_PLAYER, o, 20);
      expect(frames).toBeGreaterThan(10);
    }
  });

  it('lets go of slider bodies as the sliders finish', () => {
    const log: CallLog = { calls: 0, names: new Map() };
    const renderer = setup(log);
    const fx = new Effects();
    let most = 0;
    let sliders = 0;
    const launch = { ...launchFor(DEFAULT_DIFFICULTY, 5, 60, [], 'tracking'), options: MODES.tracking.defaultOptions };
    runHeadless({
      launch,
      model: PERFECT_PLAYER,
      onFrame: (t, session) => {
        sliders = session.map.objects.length;
        renderer.render({
          session, fx, settings: DEFAULT_SETTINGS, playT: t, now: t, cursorX: 500, cursorY: 300, drawCursor: false, overlay: 'none',
          overlayT0: 0, startLabel: 'Z', raw: false, fps: null, showScore: false, level: 3, set: 0, lengthMs: 60000,
        });
        most = Math.max(most, renderer.bodyCount);
      },
    });
    expect(sliders).toBeGreaterThan(10);
    expect(most).toBeLessThanOrEqual(3);
    expect(renderer.bodyCount).toBeLessThanOrEqual(2);
  });

  it('shows the set banner', () => {
    const log: CallLog = { calls: 0, names: new Map() };
    const renderer = setup(log);
    const fx = new Effects();
    fx.banner = Renderer.banner('up', 3.5, 4, 0);
    const { session } = runHeadless({ launch: launchFor(DEFAULT_DIFFICULTY, 1, 20, [], 'jumps'), model: PERFECT_PLAYER, maxMs: 3000 });
    renderer.render({
      session,
      fx,
      settings: DEFAULT_SETTINGS,
      playT: 3000,
      now: 400,
      cursorX: 0,
      cursorY: 0,
      drawCursor: false,
      overlay: 'none',
      overlayT0: 0,
      startLabel: 'Z',
      raw: false,
      fps: null,
      showScore: false,
      level: 4,
      set: 0,
      lengthMs: 20000,
    });
    expect(log.names.get('fillText')).toBeGreaterThan(2);
  });
});
