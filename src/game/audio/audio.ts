// The Web Audio graph: voices into category gains, then master, a compressor and the output.

import type { Settings } from '../../shared/types';
import type { FeedbackEvent } from '../engine/session';
import { sounds } from './sounds';
import type { Bus } from './sounds';

type AudioSettings = Settings['audio'];

/** Slider values are squared so the low end of the control is useful. */
const curve = (v: number) => Math.max(0, Math.min(1, v)) ** 2;

type CtxFactory = () => AudioContext;

const defaultFactory: CtxFactory = () => {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error('No Web Audio');
  return new Ctor({ latencyHint: 'interactive' });
};

export class AudioEngine {
  private bus: Bus | null = null;
  private master: GainNode | null = null;
  private failed = false;
  private hum: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private spin: { osc: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private humOn = false;

  constructor(
    private settings: AudioSettings,
    private factory: CtxFactory = defaultFactory,
  ) {}

  /** Create the context on first use. Call inside a click or key handler. */
  resume(): void {
    if (this.failed) return;
    try {
      if (!this.bus) this.build();
      const ctx = (this.bus as Bus).ctx;
      if (ctx.state === 'suspended') void ctx.resume();
    } catch {
      this.failed = true;
    }
  }

  private build(): void {
    const ctx = this.factory();
    const master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 6;
    comp.ratio.value = 3;
    comp.attack.value = 0.002;
    comp.release.value = 0.08;
    master.connect(comp);
    comp.connect(ctx.destination);
    const make = () => {
      const g = ctx.createGain();
      g.connect(master);
      return g;
    };
    const len = ctx.sampleRate;
    const noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.master = master;
    this.bus = { ctx, hits: make(), effects: make(), ambient: make(), noise, live: { n: 0, max: 24 } };
    this.apply(true);
  }

  setSettings(s: AudioSettings): void {
    this.settings = s;
    this.apply(false);
  }

  private apply(immediate: boolean): void {
    const b = this.bus;
    if (!b || !this.master) return;
    const t = b.ctx.currentTime;
    const set = (g: GainNode, v: number) => {
      if (immediate) g.gain.value = v;
      else g.gain.setTargetAtTime(v, t, 0.01);
    };
    set(this.master, this.settings.muted ? 0 : curve(this.settings.master));
    set(b.hits, curve(this.settings.hits));
    set(b.effects, curve(this.settings.effects));
    set(b.ambient, curve(this.settings.ambient));
  }

  get ready(): boolean {
    return this.bus !== null && !this.failed;
  }

  /** Sound for a session event. `combo` is the combo after it. */
  onEvent(e: FeedbackEvent): void {
    const b = this.bus;
    if (!b || this.failed) return;
    switch (e.type) {
      case 'hit':
        if (e.judgment === 'crisp') sounds.crisp(b, e.combo);
        else if (e.judgment === 'solid') sounds.solid(b);
        else sounds.rough(b);
        break;
      case 'miss':
        sounds.miss(b);
        break;
      case 'tick':
        sounds.tick(b);
        break;
      case 'tickMiss':
      case 'repeatMiss':
      case 'endMiss':
        sounds.tickMiss(b);
        break;
      case 'repeat':
        sounds.repeat(b);
        break;
      case 'endHit':
        sounds.sliderEnd(b);
        break;
      case 'comboBreak':
        sounds.comboBreak(b);
        break;
      case 'milestone':
        sounds.milestone(b);
        break;
      case 'spinComplete':
        sounds.spinChime(b);
        break;
      case 'spinBonus':
        sounds.spinBonus(b);
        break;
      case 'setEnd':
        if (e.setEnd) sounds.setResult(b, e.setEnd.direction);
        break;
      case 'fail':
        sounds.fail(b);
        break;
      default:
        break;
    }
  }

  countdown(): void {
    if (this.bus) sounds.countdown(this.bus);
  }

  /** Slider tracking hum. speed is the ball speed over 0..1 of a fast slider. */
  setTracking(on: boolean, speed: number): void {
    const b = this.bus;
    if (!b || this.failed) return;
    if (!this.hum) {
      if (!on) return;
      const ctx = b.ctx;
      const src = ctx.createBufferSource();
      src.buffer = b.noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 700;
      filter.Q.value = 0.8;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(b.ambient);
      src.start();
      this.hum = { src, filter, gain };
    }
    const t = b.ctx.currentTime;
    if (on !== this.humOn) {
      this.hum.gain.gain.setTargetAtTime(on ? 0.05 : 0, t, on ? 0.05 : 0.02);
      this.humOn = on;
    }
    if (on) this.hum.filter.frequency.setTargetAtTime(600 + 400 * Math.max(0, Math.min(1, speed)), t, 0.05);
  }

  /** Spinner hum that follows the player's rotation speed. */
  setSpinning(rpm: number): void {
    const b = this.bus;
    if (!b || this.failed) return;
    if (!this.spin) {
      if (rpm <= 20) return;
      const ctx = b.ctx;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 90;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 4;
      filter.frequency.value = 400;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(b.ambient);
      osc.start();
      this.spin = { osc, filter, gain };
    }
    const t = b.ctx.currentTime;
    this.spin.osc.frequency.setTargetAtTime(90 + 0.8 * rpm, t, 0.05);
    this.spin.filter.frequency.setTargetAtTime(400 + 6 * rpm, t, 0.05);
    this.spin.gain.gain.setTargetAtTime(rpm > 20 ? 0.07 : 0, t, rpm > 20 ? 0.05 : 0.08);
  }

  /** Silence the hums, for a pause. */
  quiet(): void {
    this.setTracking(false, 0);
    if (this.spin && this.bus) this.spin.gain.gain.setTargetAtTime(0, this.bus.ctx.currentTime, 0.03);
  }

  destroy(): void {
    try {
      this.hum?.src.stop();
      this.spin?.osc.stop();
    } catch {
      // Already stopped.
    }
    this.hum = null;
    this.spin = null;
    const b = this.bus;
    this.bus = null;
    if (b) void b.ctx.close().catch(() => undefined);
  }

  /** Play one of the sounds the settings page offers for testing. */
  playTest(kind: 'hit' | 'miss' | 'combo'): void {
    this.resume();
    const b = this.bus;
    if (!b) return;
    if (kind === 'hit') sounds.crisp(b, 0);
    else if (kind === 'miss') sounds.miss(b);
    else sounds.milestone(b);
  }
}

let shared: AudioEngine | null = null;

/** Plays one feedback sound for the settings page. Call from a click handler. */
export function playTestSound(settings: Settings, sound: 'hit' | 'miss' | 'combo'): void {
  if (!shared) shared = new AudioEngine(settings.audio);
  shared.setSettings(settings.audio);
  shared.playTest(sound);
}
