// The sound sets (PLAN-2 5.5). Each set maps every sounding feedback type to a recipe built from `blip` and `noise`.

import type { SoundSetId } from '../../shared/types';
import { blip, comboPitch, noise, sounds } from './sounds';
import type { Bus } from './sounds';

export interface SoundSetRecipes {
  crisp(bus: Bus, combo: number): void;
  solid(bus: Bus): void;
  rough(bus: Bus): void;
  miss(bus: Bus): void;
  tick(bus: Bus): void;
  tickMiss(bus: Bus): void;
  repeat(bus: Bus): void;
  sliderEnd(bus: Bus): void;
  comboBreak(bus: Bus): void;
  milestone(bus: Bus): void;
  spinChime(bus: Bus): void;
  spinBonus(bus: Bus): void;
  countdown(bus: Bus): void;
  setResult(bus: Bus, direction: 'up' | 'down' | 'hold'): void;
  fail(bus: Bus): void;
}

export type RecipeKey = keyof SoundSetRecipes;

/** Every recipe a set has to supply. Tests walk this list. */
export const RECIPE_KEYS: readonly RecipeKey[] = [
  'crisp',
  'solid',
  'rough',
  'miss',
  'tick',
  'tickMiss',
  'repeat',
  'sliderEnd',
  'comboBreak',
  'milestone',
  'spinChime',
  'spinBonus',
  'countdown',
  'setResult',
  'fail',
];

/** The tonal sounds that are not hits. A wave and a gain scale turn one table into the next set. */
function tonal(
  wave: OscillatorType,
  scale: number,
  lowpass: number,
): Pick<
  SoundSetRecipes,
  'repeat' | 'sliderEnd' | 'comboBreak' | 'milestone' | 'spinChime' | 'spinBonus' | 'countdown' | 'setResult' | 'fail'
> {
  const b = (bus: Bus, f0: number, f1: number, dur: number, gain: number, delay = 0) =>
    blip(bus, 'effects', wave, f0, f1, dur, gain * scale, delay, lowpass);
  return {
    repeat: (bus) => b(bus, 1480, 1660, 0.03, 0.15),
    sliderEnd(bus) {
      b(bus, 990, 990, 0.09, 0.18);
      b(bus, 1485, 1485, 0.09, 0.18);
    },
    comboBreak: (bus) => sounds.comboBreak(bus, wave),
    milestone(bus) {
      [880, 1109, 1319].forEach((hz, i) => b(bus, hz, hz, 0.12, 0.18, i * 0.045));
    },
    spinChime(bus) {
      b(bus, 1319, 1319, 0.2, 0.18);
      b(bus, 1976, 1976, 0.2, 0.14);
    },
    spinBonus: (bus) => b(bus, 2093, 2093, 0.03, 0.1),
    countdown(bus) {
      b(bus, 660, 660, 0.07, 0.2, 0);
      b(bus, 660, 660, 0.07, 0.2, 0.333);
      b(bus, 990, 990, 0.07, 0.2, 0.666);
    },
    setResult(bus, direction) {
      b(bus, 660, 660, 0.09, 0.2);
      if (direction === 'up') b(bus, 990, 990, 0.12, 0.2, 0.1);
      if (direction === 'down') b(bus, 495, 495, 0.12, 0.2, 0.1);
    },
    fail(bus) {
      [440, 330, 262].forEach((hz, i) => b(bus, hz, hz, 0.15, 0.25, i * 0.15));
    },
  };
}

const glass: SoundSetRecipes = {
  crisp: (bus, combo) => sounds.crisp(bus, combo),
  solid: (bus) => sounds.solid(bus),
  rough: (bus) => sounds.rough(bus),
  miss: (bus) => sounds.miss(bus),
  tick: (bus) => sounds.tick(bus),
  tickMiss: (bus) => sounds.tickMiss(bus),
  repeat: (bus) => sounds.repeat(bus),
  sliderEnd: (bus) => sounds.sliderEnd(bus),
  comboBreak: (bus) => sounds.comboBreak(bus),
  milestone: (bus) => sounds.milestone(bus),
  spinChime: (bus) => sounds.spinChime(bus),
  spinBonus: (bus) => sounds.spinBonus(bus),
  countdown: (bus) => sounds.countdown(bus),
  setResult: (bus, direction) => sounds.setResult(bus, direction),
  fail: (bus) => sounds.fail(bus),
};

const wood: SoundSetRecipes = {
  ...tonal('triangle', 1, 0),
  crisp(bus, combo) {
    const p = comboPitch(combo);
    blip(bus, 'hits', 'triangle', 880 * p, 660 * p, 0.045, 0.3);
    noise(bus, 'hits', 'bandpass', 1800, 3, 0.012, 0.18);
  },
  solid(bus) {
    blip(bus, 'hits', 'triangle', 740, 560, 0.045, 0.28);
    noise(bus, 'hits', 'bandpass', 1500, 3, 0.012, 0.15);
  },
  rough(bus) {
    blip(bus, 'hits', 'triangle', 520, 400, 0.045, 0.26);
    noise(bus, 'hits', 'bandpass', 1100, 3, 0.012, 0.13);
  },
  miss(bus) {
    noise(bus, 'hits', 'lowpass', 300, 0.7, 0.09, 0.25);
    blip(bus, 'hits', 'sine', 140, 70, 0.12, 0.3);
  },
  tick: (bus) => noise(bus, 'effects', 'bandpass', 2400, 3, 0.008, 0.1),
  tickMiss: (bus) => noise(bus, 'effects', 'lowpass', 300, 0.7, 0.03, 0.12),
};

const pulse: SoundSetRecipes = {
  ...tonal('square', 0.45, 4000),
  crisp(bus, combo) {
    const p = comboPitch(combo);
    blip(bus, 'hits', 'square', 1320 * p, 1320 * p, 0.03, 0.12, 0, 4000);
    blip(bus, 'hits', 'square', 1980 * p, 1980 * p, 0.03, 0.12, 0.015, 4000);
  },
  solid: (bus) => blip(bus, 'hits', 'square', 990, 990, 0.03, 0.12, 0, 4000),
  rough: (bus) => blip(bus, 'hits', 'square', 660, 660, 0.03, 0.12, 0, 4000),
  miss: (bus) => blip(bus, 'hits', 'square', 165, 110, 0.12, 0.14, 0, 1200),
  tick: (bus) => blip(bus, 'effects', 'square', 2640, 2640, 0.01, 0.05),
  tickMiss: (bus) => blip(bus, 'effects', 'square', 220, 180, 0.04, 0.06, 0, 1200),
};

export const SOUND_SET_RECIPES: Record<SoundSetId, SoundSetRecipes> = { glass, wood, pulse };

/** The spinner hum of each set. The pitch and cutoff follow the rotation speed in the audio engine. */
export interface SpinHum {
  wave: OscillatorType;
  filter: BiquadFilterType;
  q: number;
  gain: number;
}

export const SPIN_HUMS: Record<SoundSetId, SpinHum> = {
  glass: { wave: 'sawtooth', filter: 'lowpass', q: 4, gain: 0.07 },
  wood: { wave: 'triangle', filter: 'bandpass', q: 2, gain: 0.09 },
  pulse: { wave: 'square', filter: 'lowpass', q: 1, gain: 0.035 },
};
