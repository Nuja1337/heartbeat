// The synthesized voices (PLAN section 10). Each one starts at ctx.currentTime so it sounds with the input.

export interface Bus {
  ctx: AudioContext;
  hits: GainNode;
  effects: GainNode;
  ambient: GainNode;
  /** The metronome's own gain (metronomeVolume squared). */
  metronome: GainNode;
  noise: AudioBuffer;
  /** Live voices. Capped so a long stream cannot pile up nodes. */
  live: { n: number; max: number };
}

export type Out = 'hits' | 'effects' | 'ambient' | 'metronome';

/**
 * An oscillator with an exponential glide, a 1 ms attack and an exponential decay. A `lowpass` above 0 (Hz) puts a
 * lowpass filter between the oscillator and its gain.
 */
export function blip(
  bus: Bus,
  out: Out,
  type: OscillatorType,
  f0: number,
  f1: number,
  dur: number,
  gain: number,
  delay = 0,
  lowpass = 0,
): void {
  if (bus.live.n >= bus.live.max) return;
  const ctx = bus.ctx;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let f: BiquadFilterNode | null = null;
  if (lowpass > 0) {
    f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpass;
    o.connect(f);
    f.connect(g);
  } else {
    o.connect(g);
  }
  g.connect(bus[out]);
  bus.live.n++;
  o.onended = () => {
    bus.live.n--;
    o.disconnect();
    f?.disconnect();
    g.disconnect();
  };
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** A short burst of filtered noise. */
export function noise(bus: Bus, out: Out, filter: BiquadFilterType, freq: number, q: number, dur: number, gain: number, delay = 0): void {
  if (bus.live.n >= bus.live.max) return;
  const ctx = bus.ctx;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  src.buffer = bus.noise;
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = q;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(bus[out]);
  bus.live.n++;
  src.onended = () => {
    bus.live.n--;
    src.disconnect();
    f.disconnect();
    g.disconnect();
  };
  const offset = Math.random() * Math.max(0, bus.noise.duration - dur - 0.05);
  src.start(t, offset, dur + 0.02);
}

/** Pitch factor for Crisp hits at a combo: two semitones per 25 combo, up to four steps. */
export function comboPitch(combo: number): number {
  return Math.pow(2, (2 * Math.min(Math.floor(combo / 25), 4)) / 12);
}

export const sounds = {
  crisp(bus: Bus, combo: number): void {
    const p = comboPitch(combo);
    blip(bus, 'hits', 'sine', 1240 * p, 930 * p, 0.07, 0.35);
    noise(bus, 'hits', 'bandpass', 5000, 1.5, 0.006, 0.12);
  },
  solid(bus: Bus): void {
    blip(bus, 'hits', 'sine', 990, 740, 0.06, 0.3);
    noise(bus, 'hits', 'bandpass', 3500, 1.5, 0.006, 0.1);
  },
  rough(bus: Bus): void {
    blip(bus, 'hits', 'triangle', 620, 470, 0.055, 0.28);
    noise(bus, 'hits', 'bandpass', 2000, 1.5, 0.008, 0.1);
  },
  miss(bus: Bus): void {
    blip(bus, 'hits', 'sine', 190, 80, 0.14, 0.4);
    noise(bus, 'hits', 'lowpass', 500, 0.7, 0.07, 0.2);
  },
  comboBreak(bus: Bus, wave: OscillatorType = 'triangle'): void {
    if (bus.live.n >= bus.live.max - 1) return;
    const ctx = bus.ctx;
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3000, t);
    f.frequency.exponentialRampToValueAtTime(600, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.25, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    f.connect(g);
    g.connect(bus.effects);
    for (const hz of [520, 523]) {
      const o = ctx.createOscillator();
      o.type = wave;
      o.frequency.setValueAtTime(hz, t);
      o.frequency.exponentialRampToValueAtTime(260, t + 0.28);
      o.connect(f);
      bus.live.n++;
      o.onended = () => {
        bus.live.n--;
        o.disconnect();
      };
      o.start(t);
      o.stop(t + 0.3);
    }
    window.setTimeout(() => {
      f.disconnect();
      g.disconnect();
    }, 400);
  },
  milestone(bus: Bus): void {
    [880, 1109, 1319].forEach((hz, i) => blip(bus, 'effects', 'sine', hz, hz, 0.12, 0.18, i * 0.045));
  },
  tick(bus: Bus): void {
    blip(bus, 'effects', 'sine', 1760, 1760, 0.025, 0.12);
  },
  tickMiss(bus: Bus): void {
    noise(bus, 'effects', 'lowpass', 800, 0.7, 0.03, 0.12);
  },
  repeat(bus: Bus): void {
    blip(bus, 'effects', 'sine', 1480, 1660, 0.03, 0.15);
  },
  sliderEnd(bus: Bus): void {
    blip(bus, 'effects', 'sine', 990, 990, 0.09, 0.18);
    blip(bus, 'effects', 'sine', 1485, 1485, 0.09, 0.18);
  },
  spinChime(bus: Bus): void {
    blip(bus, 'effects', 'sine', 1319, 1319, 0.2, 0.18);
    blip(bus, 'effects', 'sine', 1976, 1976, 0.2, 0.14);
  },
  spinBonus(bus: Bus): void {
    blip(bus, 'effects', 'sine', 2093, 2093, 0.03, 0.1);
  },
  countdown(bus: Bus): void {
    blip(bus, 'effects', 'sine', 660, 660, 0.07, 0.2, 0);
    blip(bus, 'effects', 'sine', 660, 660, 0.07, 0.2, 0.333);
    blip(bus, 'effects', 'sine', 990, 990, 0.07, 0.2, 0.666);
  },
  setResult(bus: Bus, direction: 'up' | 'down' | 'hold'): void {
    blip(bus, 'effects', 'sine', 660, 660, 0.09, 0.2);
    if (direction === 'up') blip(bus, 'effects', 'sine', 990, 990, 0.12, 0.2, 0.1);
    if (direction === 'down') blip(bus, 'effects', 'sine', 495, 495, 0.12, 0.2, 0.1);
  },
  fail(bus: Bus): void {
    [440, 330, 262].forEach((hz, i) => blip(bus, 'effects', 'triangle', hz, hz, 0.15, 0.25, i * 0.15));
  },
};
