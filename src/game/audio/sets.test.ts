import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SOUND_SETS } from '../../shared/catalog';
import type { SoundSetId, TestSound } from '../../shared/types';
import { fakeAudioContext } from '../testing/fakes';
import type { AudioLog } from '../testing/fakes';
import { AudioEngine } from './audio';
import { RECIPE_KEYS, SOUND_SET_RECIPES, SPIN_HUMS } from './sets';
import type { Bus } from './sounds';

const saved = (globalThis as Record<string, unknown>).window;
beforeEach(() => {
  (globalThis as Record<string, unknown>).window = { setTimeout: () => 0 };
});
afterEach(() => {
  (globalThis as Record<string, unknown>).window = saved;
});

const IDS = Object.keys(SOUND_SETS) as SoundSetId[];

interface Voice {
  type: string;
  f0: number | null;
}

/** A bus on the fake context that remembers each oscillator's type and first frequency. */
function recordingBus() {
  const log: AudioLog = { oscillators: 0, sources: 0 };
  const ctx = fakeAudioContext(log) as unknown as Record<string, unknown>;
  const voices: Voice[] = [];
  const make = ctx.createOscillator as () => { type: string; frequency: { setValueAtTime: (v: number) => void } };
  ctx.createOscillator = () => {
    const o = make();
    const v: Voice = { type: '', f0: null };
    voices.push(v);
    o.frequency.setValueAtTime = (f: number) => {
      v.f0 ??= f;
    };
    return new Proxy(o, {
      set(t, p, value) {
        if (p === 'type') v.type = String(value);
        (t as Record<string | symbol, unknown>)[p] = value;
        return true;
      },
    });
  };
  const c = ctx as unknown as AudioContext;
  const gain = () => c.createGain();
  const bus: Bus = {
    ctx: c,
    hits: gain(),
    effects: gain(),
    ambient: gain(),
    metronome: gain(),
    noise: c.createBuffer(1, 48000, 48000),
    live: { n: 0, max: 1000 },
  };
  return { bus, log, voices };
}

describe('sound sets', () => {
  it('has a set for every id in the catalog', () => {
    expect(Object.keys(SOUND_SET_RECIPES).sort()).toEqual(IDS.slice().sort());
    expect(Object.keys(SPIN_HUMS).sort()).toEqual(IDS.slice().sort());
  });

  it('gives every sounding feedback type a recipe in each set, and each recipe makes a sound', () => {
    for (const id of IDS) {
      const set = SOUND_SET_RECIPES[id];
      for (const key of RECIPE_KEYS) {
        expect(typeof set[key], `${id}.${key}`).toBe('function');
        const { bus, log } = recordingBus();
        if (key === 'crisp') set.crisp(bus, 0);
        else if (key === 'setResult') set.setResult(bus, 'up');
        else set[key](bus);
        expect(log.oscillators + log.sources, `${id}.${key} made no sound`).toBeGreaterThan(0);
      }
    }
  });

  it('covers every key the audio engine plays', () => {
    expect(RECIPE_KEYS).toHaveLength(15);
    for (const id of IDS) expect(Object.keys(SOUND_SET_RECIPES[id]).sort(), id).toEqual([...RECIPE_KEYS].sort());
  });

  it('raises the pitch of Crisp with the combo in every set', () => {
    for (const id of IDS) {
      const lo = recordingBus();
      SOUND_SET_RECIPES[id].crisp(lo.bus, 0);
      const hi = recordingBus();
      SOUND_SET_RECIPES[id].crisp(hi.bus, 100);
      expect(hi.voices[0]!.f0! / lo.voices[0]!.f0!, id).toBeCloseTo(Math.pow(2, 8 / 12), 9);
    }
  });

  it('keeps the glass table as the 1.0 recipes', () => {
    const { bus, voices } = recordingBus();
    SOUND_SET_RECIPES.glass.crisp(bus, 0);
    expect(voices[0]).toEqual({ type: 'sine', f0: 1240 });
    const miss = recordingBus();
    SOUND_SET_RECIPES.glass.miss(miss.bus);
    expect(miss.voices[0]).toEqual({ type: 'sine', f0: 190 });
  });

  it('builds wood from triangles and pulse from square waves', () => {
    const w = recordingBus();
    SOUND_SET_RECIPES.wood.crisp(w.bus, 0);
    expect(w.voices[0]).toEqual({ type: 'triangle', f0: 880 });
    const ws = recordingBus();
    SOUND_SET_RECIPES.wood.solid(ws.bus);
    expect(ws.voices[0]).toEqual({ type: 'triangle', f0: 740 });
    const wr = recordingBus();
    SOUND_SET_RECIPES.wood.rough(wr.bus);
    expect(wr.voices[0]).toEqual({ type: 'triangle', f0: 520 });
    const p = recordingBus();
    SOUND_SET_RECIPES.pulse.crisp(p.bus, 0);
    expect(p.voices.map((v) => [v.type, v.f0])).toEqual([['square', 1320], ['square', 1980]]);
    const ps = recordingBus();
    SOUND_SET_RECIPES.pulse.solid(ps.bus);
    expect(ps.voices[0]).toEqual({ type: 'square', f0: 990 });
    const pr = recordingBus();
    SOUND_SET_RECIPES.pulse.rough(pr.bus);
    expect(pr.voices[0]).toEqual({ type: 'square', f0: 660 });
    expect(SPIN_HUMS.wood.wave).toBe('triangle');
    expect(SPIN_HUMS.wood.filter).toBe('bandpass');
    expect(SPIN_HUMS.pulse.wave).toBe('square');
  });
});

describe('playTest', () => {
  const kinds: TestSound[] = ['hit', 'miss', 'combo', 'tick', 'metronome', 'countdown'];

  it('plays every test sound in every set', () => {
    for (const id of IDS) {
      for (const kind of kinds) {
        const log: AudioLog = { oscillators: 0, sources: 0 };
        const a = new AudioEngine({ ...DEFAULT_SETTINGS.audio, soundSet: id }, () => fakeAudioContext(log));
        a.playTest(kind);
        expect(log.oscillators + log.sources, `${id} ${kind}`).toBeGreaterThan(0);
      }
    }
  });

  it('plays the metronome test at the metronome volume, whatever the mode', () => {
    const log: AudioLog = { oscillators: 0, sources: 0 };
    const a = new AudioEngine({ ...DEFAULT_SETTINGS.audio, metronome: 'off' }, () => fakeAudioContext(log));
    a.playTest('metronome');
    // A bar of four clicks, each a sine and a burst of noise.
    expect(log.oscillators).toBe(4);
    expect(log.sources).toBe(4);
  });
});

describe('metronome gain', () => {
  it('is metronomeVolume squared', () => {
    const gains: { gain: { value: number } }[] = [];
    const a = new AudioEngine({ ...DEFAULT_SETTINGS.audio, metronomeVolume: 0.5 }, () => {
      const ctx = fakeAudioContext({ oscillators: 0, sources: 0 });
      const make = ctx.createGain.bind(ctx) as () => { gain: { value: number } };
      ctx.createGain = (() => {
        const g = make();
        gains.push(g);
        return g;
      }) as never;
      return ctx;
    });
    a.resume();
    // Master first, then hits, effects, ambient and the metronome.
    expect(gains[4]!.gain.value).toBeCloseTo(0.25, 9);
    expect(gains[1]!.gain.value).toBeCloseTo(0.64, 9);
  });
});
