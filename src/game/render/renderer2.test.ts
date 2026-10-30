// Rendering 2.0 (PLAN-2 5.4 and 5.6): skins, approach styles, effects pools and the visual offset.

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, LEVEL_PRESETS, PALETTES } from '../../shared/catalog';
import type { ModId, PaletteId, PlayableMap, Settings } from '../../shared/types';
import { computeLayout, Playfield } from '../engine/playfield';
import { GameSession } from '../engine/session';
import type { FeedbackEvent } from '../engine/session';
import { NOISY_PLAYER } from '../sim/autoplay';
import { runHeadless } from '../sim/headless';
import { fakeCanvasFactory, fakeContext } from '../testing/fakes';
import type { CallLog } from '../testing/fakes';
import { launchFor, makeCircle, makeMap, makeSlider, makeSpinner } from '../testing/fixtures';
import { Effects } from './effects';
import { FrameStats } from './frameStats';
import { Renderer, ringFraction } from './renderer';
import type { RenderState } from './renderer';
import { resolveSkin } from './skin';

const STYLES = ['ring', 'fill', 'brackets'] as const;
const PALETTE_IDS = Object.keys(PALETTES) as PaletteId[];
const FLAGS = { earlyLate: true, crispPopups: true, reduceMotion: false };

const newLog = (): CallLog => ({ calls: 0, names: new Map() });

function setup(log: CallLog): Renderer {
  const pf = new Playfield({} as HTMLCanvasElement);
  pf.layout = computeLayout(1280, 720);
  pf.dpr = 2;
  return new Renderer(fakeContext(log), pf, fakeCanvasFactory(log));
}

function settingsWith(skin: Partial<Settings['skin']> = {}, display: Partial<Settings['display']> = {}, input: Partial<Settings['input']> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    skin: { ...DEFAULT_SETTINGS.skin, ...skin },
    display: { ...DEFAULT_SETTINGS.display, ...display },
    input: { ...DEFAULT_SETTINGS.input, cursor: 'drawn', ...input },
  };
}

/** A small hand-made scene: a circle, a slider with a reverse and ticks, a second circle and a spinner. */
function scene(mods: ModId[] = [], extra: { beatOffsetMs?: number } = {}): GameSession {
  const objects = [
    makeCircle(0, 2000, 300, 200, 50),
    makeSlider(1, 3200, { x: 200, y: 400 }, [{ type: 'line', to: { x: 500, y: 400 } }], { spanMs: 600, repeats: 1, tickDistance: 100 }),
    makeCircle(2, 5200, 700, 150, 40),
    makeSpinner(3, 6500, 2500, 4),
  ];
  const map: PlayableMap = { ...makeMap(objects, { beatMs: 500, ...extra }), mods, rate: 1 };
  return new GameSession({ map, launch: launchFor(), progressMs: map.durationMs });
}

function stateFor(session: GameSession, fx: Effects, settings: Settings, playT: number): RenderState {
  return {
    session,
    fx,
    settings,
    playT,
    now: playT,
    cursorX: 420,
    cursorY: 330,
    drawCursor: true,
    overlay: 'none',
    overlayT0: 0,
    startLabel: 'Z',
    raw: false,
    fps: 240,
    showScore: true,
    level: null,
    set: null,
    lengthMs: 60000,
    retry: 0,
    frames: null,
  };
}

const event = (type: FeedbackEvent['type'], judgment: FeedbackEvent['judgment'], value = 0, index = 0): FeedbackEvent => ({
  type,
  t: 0,
  index,
  judgment,
  x: 300,
  y: 200,
  value,
  combo: 1,
  head: false,
  reason: null,
  setEnd: null,
});

describe('Renderer 2.0', () => {
  it('draws every approach style in every palette without throwing', () => {
    for (const approach of STYLES) {
      for (const palette of PALETTE_IDS) {
        const log = newLog();
        const renderer = setup(log);
        const fx = new Effects();
        const settings = settingsWith({ approach, palette });
        const session = scene();
        // Through the approach of the circle, the slider, the second circle and the spinner.
        for (let t = 1000; t < 9200; t += 47) renderer.render(stateFor(session, fx, settings, t));
        expect(log.calls, `${approach} ${palette}`).toBeGreaterThan(500);
        expect(renderer.currentSkin.palette).toBe(palette);
        expect(renderer.currentSkin.approach).toBe(approach);
      }
    }
  });

  it('draws every cursor style with the trail, a ripple and the quick retry bar', () => {
    for (const cursorStyle of ['ring', 'cross', 'dot'] as const) {
      const log = newLog();
      const renderer = setup(log);
      const fx = new Effects();
      const settings = settingsWith({ cursorStyle }, { frameGraph: true, showFps: true }, { cursorTrail: true, cursorScale: 1.5 });
      const session = scene();
      const frames = new FrameStats();
      for (let i = 0; i < 200; i++) frames.push(4 + (i % 7) * 0.3);
      for (let i = 0; i < 40; i++) session.move(2000 + i * 5, { x: 100 + i * 8, y: 300 });
      const rs = { ...stateFor(session, fx, settings, 2200), frames, retry: 0.5 };
      fx.ripple(300, 300, 2190);
      renderer.render(rs);
      expect(log.names.get('fillText')).toBeGreaterThan(5);
      expect(log.calls, cursorStyle).toBeGreaterThan(100);
    }
  });

  it('draws the frame graph only when the setting is on', () => {
    const run = (frameGraph: boolean) => {
      const log = newLog();
      const renderer = setup(log);
      const frames = new FrameStats();
      for (let i = 0; i < 120; i++) frames.push(4.2);
      renderer.render({ ...stateFor(scene(), new Effects(), settingsWith({}, { frameGraph }), 500), frames });
      return log.names.get('fillRect') ?? 0;
    };
    // 120 bars and the panel.
    expect(run(true) - run(false)).toBeGreaterThanOrEqual(120);
  });

  it('draws no approach indicator with Fade or No Rings, and draws one otherwise', () => {
    for (const approach of STYLES) {
      const calls = (mods: ModId[]) => {
        const log = newLog();
        const renderer = setup(log);
        renderer.render(stateFor(scene(mods), new Effects(), settingsWith({ approach }), 1500));
        return log.calls;
      };
      const plain = calls([]);
      expect(calls(['norings']), approach).toBeLessThan(plain);
      expect(calls(['fade']), approach).toBeLessThan(plain);
    }
  });

  it('draws the inner ring of a target with Bullseye, and not otherwise', () => {
    const arcs = (mods: ModId[]) => {
      const log = newLog();
      setup(log).render(stateFor(scene(mods), new Effects(), settingsWith(), 1500));
      return log.names.get('arc') ?? 0;
    };
    expect(arcs(['bullseye'])).toBeGreaterThan(arcs([]));
  });

  it('draws objects at play time plus the visual offset', () => {
    const drawn = (visualOffsetMs: number, t: number) => {
      const log = newLog();
      setup(log).render(stateFor(scene(), new Effects(), settingsWith({}, { visualOffsetMs }), t));
      return { images: log.names.get('drawImage') ?? 0, texts: log.names.get('fillText') ?? 0 };
    };
    // The circle at 2000 ms appears 800 ms earlier, at 1200. A target is an image on top of the field bitmap.
    const before = drawn(0, 1190);
    expect(drawn(0, 1210).images).toBe(before.images + 1);
    expect(drawn(20, 1190).images).toBe(before.images + 1);
    expect(drawn(-20, 1210).images).toBe(before.images);
    // Its number is text.
    expect(drawn(150, 1190).texts).toBe(before.texts + 1);
  });

  it('puts the HUD on plain play time', () => {
    // A score that eases toward its value and the time ring are HUD: the offset changes neither of them.
    const arcsOf = (visualOffsetMs: number) => {
      const log = newLog();
      setup(log).render({ ...stateFor(scene(), new Effects(), settingsWith({}, { visualOffsetMs }), 100), lengthMs: 1000 });
      return log.names.get('arc') ?? 0;
    };
    expect(arcsOf(-50)).toBe(arcsOf(150));
  });

  it('draws the slider ball and its follow ring at the offset time', () => {
    const arcsAt = (visualOffsetMs: number, t: number) => {
      const log = newLog();
      setup(log).render(stateFor(scene(), new Effects(), settingsWith({}, { visualOffsetMs }), t));
      return log.names.get('arc') ?? 0;
    };
    // At 3100 the slider (starting at 3200) has no ball yet. With 150 ms of offset the ball is drawn.
    expect(arcsAt(150, 3100)).toBeGreaterThan(arcsAt(0, 3100));
  });

  it('reads the skin from the settings once, and again when they change', () => {
    const log = newLog();
    const renderer = setup(log);
    const fx = new Effects();
    const session = scene();
    const a = settingsWith({ palette: 'classic' });
    renderer.render(stateFor(session, fx, a, 1500));
    const skin = renderer.currentSkin;
    renderer.render(stateFor(session, fx, a, 1600));
    expect(renderer.currentSkin).toBe(skin);
    renderer.setSettings(settingsWith({ palette: 'contrast', approach: 'fill' }));
    expect(renderer.currentSkin).not.toBe(skin);
    expect(renderer.currentSkin.palette).toBe('contrast');
    expect(renderer.currentSkin.groups).toEqual([...PALETTES.contrast.groups]);
  });

  it('draws the follow ring of a tracked slider and reversals, with and without a beat grid', () => {
    for (const beatOffsetMs of [undefined, 130]) {
      const log = newLog();
      const renderer = setup(log);
      const fx = new Effects();
      const session = scene([], beatOffsetMs === undefined ? {} : { beatOffsetMs });
      const slider = session.objs[1]!;
      slider.slider!.tracking = true;
      fx.onEvent(event('trackOn', null, 0, 1), 3300, slider.obj, FLAGS);
      for (let t = 3200; t < 4600; t += 25) renderer.render(stateFor(session, fx, settingsWith(), t));
      expect(log.names.get('arc')).toBeGreaterThan(100);
    }
  });
});

describe('Effects', () => {
  it('makes a ring, 8 sparks and a popped body for Crisp, and only the ring with reduced motion', () => {
    const circle = makeCircle(0, 1000, 300, 200, 50);
    const fx = new Effects();
    fx.onEvent(event('hit', 'crisp', 3), 0, circle, FLAGS);
    expect(fx.live.particles).toBe(1 + 8 + 1);
    const calm = new Effects();
    calm.onEvent(event('hit', 'crisp', 3), 0, circle, { ...FLAGS, reduceMotion: true });
    expect(calm.live.particles).toBe(1);
  });

  it('makes 4 sparks for Solid and a faint ring only for Rough', () => {
    const circle = makeCircle(0, 1000, 300, 200, 50);
    const solid = new Effects();
    solid.onEvent(event('hit', 'solid', 30), 0, circle, FLAGS);
    expect(solid.live.particles).toBe(1 + 4 + 1);
    const rough = new Effects();
    rough.onEvent(event('hit', 'rough', 90), 0, circle, FLAGS);
    expect(rough.live.particles).toBe(1 + 1);
  });

  it('makes the miss mark, the red flash and a Miss label', () => {
    const circle = makeCircle(0, 1000, 300, 200, 50);
    const fx = new Effects();
    fx.onEvent(event('miss', 'miss'), 0, circle, FLAGS);
    expect(fx.live.particles).toBe(2);
    expect(fx.live.popups).toBe(1);
    expect(fx.vignette(10)).toBeGreaterThan(0);
    const calm = new Effects();
    calm.onEvent(event('miss', 'miss'), 0, circle, { ...FLAGS, reduceMotion: true });
    expect(calm.vignette(10)).toBe(0);
  });

  it('lets effects end on their own', () => {
    const circle = makeCircle(0, 1000, 300, 200, 50);
    const fx = new Effects();
    const ctx = fakeContext(newLog());
    const skin = resolveSkin(DEFAULT_SETTINGS);
    fx.onEvent(event('hit', 'crisp', 3), 0, circle, FLAGS);
    fx.onEvent(event('miss', 'miss'), 0, circle, FLAGS);
    fx.drawField(ctx, 100, skin);
    fx.drawPopups(ctx, 100, skin);
    expect(fx.live.particles).toBeGreaterThan(5);
    fx.drawField(ctx, 5000, skin);
    fx.drawPopups(ctx, 5000, skin);
    expect(fx.live).toEqual({ particles: 0, popups: 0, ripples: 0 });
  });

  it('grows the follow ring in over 120 ms and shrinks it over 150 ms', () => {
    const fx = new Effects();
    const slider = makeSlider(1, 1000, { x: 100, y: 100 }, [{ type: 'line', to: { x: 300, y: 100 } }]);
    const out = { scale: 0, alpha: 0 };
    fx.onEvent(event('trackOn', null, 0, 1), 1000, slider, FLAGS);
    fx.followRing(1, true, 1000, out);
    expect(out.scale).toBeCloseTo(0.55);
    expect(out.alpha).toBe(0);
    fx.followRing(1, true, 1060, out);
    expect(out.scale).toBeGreaterThan(0.8);
    fx.followRing(1, true, 1120, out);
    expect(out).toEqual({ scale: 1, alpha: 1 });
    fx.onEvent(event('trackOff', null, 0, 1), 1500, slider, FLAGS);
    fx.followRing(1, false, 1500, out);
    expect(out.scale).toBe(1);
    expect(out.alpha).toBe(1);
    fx.followRing(1, false, 1575, out);
    expect(out.scale).toBeCloseTo(0.85);
    expect(out.alpha).toBeCloseTo(0.5);
    fx.followRing(1, false, 1650, out);
    expect(out.scale).toBe(0);
    // A slider this effects object never heard about is tracked at full size.
    fx.followRing(9, true, 1000, out);
    expect(out).toEqual({ scale: 1, alpha: 1 });
  });

  it('keeps click ripples in a pool of 16', () => {
    const fx = new Effects();
    for (let i = 0; i < 40; i++) fx.ripple(i, i, i);
    expect(fx.live.ripples).toBe(16);
  });
});

describe('Effects pools', () => {
  it('keep their fixed sizes through 600 frames of a busy Level 8 map', () => {
    const log = newLog();
    const renderer = setup(log);
    const fx = new Effects();
    const sizes = fx.capacity;
    expect(sizes).toEqual({ particles: 512, popups: 64, ripples: 16 });
    const keys = ['pOn', 'pX', 'uOn', 'uX', 'rOn'];
    const arrays = keys.map((k) => (fx as unknown as Record<string, unknown>)[k]);
    let frames = 0;
    let busiest = { particles: 0, popups: 0 };
    const settings = settingsWith({}, {}, { cursorTrail: true });
    runHeadless({
      launch: launchFor(LEVEL_PRESETS[7]!.difficulty, 4242, 60),
      model: NOISY_PLAYER,
      stepMs: 2,
      listener: (e) => {
        fx.onEvent(e, e.t, null, FLAGS);
        // Press ripples, as the game makes them, to fill that pool too.
        if (e.type === 'hit' || e.type === 'miss') fx.ripple(e.x, e.y, e.t);
      },
      onFrame: (t, session) => {
        if (frames >= 600) return;
        renderer.render({ ...stateFor(session, fx, settings, t), cursorX: session.cursor.lastX, cursorY: session.cursor.lastY });
        frames++;
        const live = fx.live;
        busiest = { particles: Math.max(busiest.particles, live.particles), popups: Math.max(busiest.popups, live.popups) };
        expect(fx.capacity).toEqual(sizes);
      },
    });
    expect(frames).toBe(600);
    // The pools were used, and are still the same arrays at the same length.
    expect(busiest.particles).toBeGreaterThan(20);
    expect(busiest.popups).toBeGreaterThan(2);
    expect(busiest.particles).toBeLessThanOrEqual(512);
    expect(busiest.popups).toBeLessThanOrEqual(64);
    keys.forEach((k, i) => expect((fx as unknown as Record<string, unknown>)[k], k).toBe(arrays[i]));
  });

  it('overwrite the oldest entry when full instead of growing', () => {
    const fx = new Effects();
    const circle = makeCircle(0, 1000, 300, 200, 50);
    for (let i = 0; i < 200; i++) fx.onEvent(event('hit', 'crisp', 3), i, circle, FLAGS);
    expect(fx.live.particles).toBeLessThanOrEqual(512);
    expect(fx.live.popups).toBeLessThanOrEqual(64);
    expect(fx.capacity).toEqual({ particles: 512, popups: 64, ripples: 16 });
  });
});

describe('ring fraction', () => {
  it('counts play time out of the length, or sets done out of the set count when there is one', () => {
    expect(ringFraction(30000, 60000, 2, null)).toBe(0.5);
    expect(ringFraction(30000, 60000, 2, undefined)).toBe(0.5);
    expect(ringFraction(30000, 0, null, null)).toBe(0);
    // Placement: 240 s declared, but the ring follows the sets.
    expect(ringFraction(30000, 240000, 5, 10)).toBe(0.5);
    expect(ringFraction(60000, 240000, 9, 10)).toBe(0.9);
    expect(ringFraction(60000, 240000, null, 10)).toBe(0);
    expect(ringFraction(1000, 240000, 12, 10)).toBe(1);
  });
});
