// The Web Audio graph: voices into category gains, then master, a compressor and the output.

import type { Settings, TestSound } from '../../shared/types';
import type { FeedbackEvent } from '../engine/session';
import { Metronome } from './metronome';
import type { Grid } from './metronome';
import { SOUND_SET_RECIPES, SPIN_HUMS } from './sets';
import type { SoundSetRecipes } from './sets';
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
  private spin: { osc: OscillatorNode; filter: BiquadFilterNode; gain: GainNode; set: string } | null = null;
  private humOn = false;
  private metro = new Metronome();

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

  /**
   * Like `resume`, and then waits for the context to run. Resolves false when the context could not be made or did not
   * start, so a caller that needs sound can say so.
   */
  async start(): Promise<boolean> {
    this.resume();
    const b = this.bus;
    if (!b || this.failed) return false;
    try {
      if (b.ctx.state !== 'running') await b.ctx.resume();
    } catch {
      return false;
    }
    return (b.ctx.state as string) === 'running';
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
    this.bus = { ctx, hits: make(), effects: make(), ambient: make(), metronome: make(), noise, live: { n: 0, max: 24 } };
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
    set(b.metronome, curve(this.settings.metronomeVolume));
  }

  /** The recipes of the chosen sound set. */
  private get recipes(): SoundSetRecipes {
    return SOUND_SET_RECIPES[this.settings.soundSet] ?? SOUND_SET_RECIPES.glass;
  }

  get ready(): boolean {
    return this.bus !== null && !this.failed;
  }

  /** Sound for a session event. `combo` is the combo after it. */
  onEvent(e: FeedbackEvent): void {
    const b = this.bus;
    if (!b || this.failed) return;
    const sounds = this.recipes;
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
    if (this.bus) this.recipes.countdown(this.bus);
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
    if (this.spin && this.spin.set !== this.settings.soundSet) {
      // The set changed in the middle of a spinner.
      try {
        this.spin.osc.stop();
      } catch {
        // Already stopped.
      }
      this.spin.gain.disconnect();
      this.spin = null;
    }
    if (!this.spin) {
      if (rpm <= 20) return;
      const ctx = b.ctx;
      const hum = SPIN_HUMS[this.settings.soundSet] ?? SPIN_HUMS.glass;
      const osc = ctx.createOscillator();
      osc.type = hum.wave;
      osc.frequency.value = 90;
      const filter = ctx.createBiquadFilter();
      filter.type = hum.filter;
      filter.Q.value = hum.q;
      filter.frequency.value = 400;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(b.ambient);
      osc.start();
      this.spin = { osc, filter, gain, set: this.settings.soundSet };
    }
    const t = b.ctx.currentTime;
    this.spin.osc.frequency.setTargetAtTime(90 + 0.8 * rpm, t, 0.05);
    this.spin.filter.frequency.setTargetAtTime(400 + 6 * rpm, t, 0.05);
    const level = (SPIN_HUMS[this.settings.soundSet] ?? SPIN_HUMS.glass).gain;
    this.spin.gain.gain.setTargetAtTime(rpm > 20 ? level : 0, t, rpm > 20 ? 0.05 : 0.08);
  }

  /**
   * Schedule the metronome clicks for this frame. `playT` is play time and `perfNow` is performance.now() at the same
   * moment. Call it every frame while playing.
   */
  tickMetronome(grid: Grid, playT: number, perfNow: number): void {
    const b = this.bus;
    // A context that has not started has no clock to schedule on.
    if (!b || this.failed || this.settings.metronome === 'off' || b.ctx.state === 'suspended') return;
    this.metro.update(b, grid, this.settings.metronome, this.settings.offsetMs, playT, perfNow);
  }

  /** Silence the hums and stop the scheduled clicks, for a pause. */
  quiet(): void {
    this.metro.stop();
    this.setTracking(false, 0);
    if (this.spin && this.bus) this.spin.gain.gain.setTargetAtTime(0, this.bus.ctx.currentTime, 0.03);
  }

  destroy(): void {
    this.metro.stop();
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
  playTest(kind: TestSound): void {
    this.resume();
    const b = this.bus;
    if (!b || this.failed) return;
    const set = this.recipes;
    switch (kind) {
      case 'hit':
        set.crisp(b, 0);
        break;
      case 'miss':
        set.miss(b);
        break;
      case 'combo':
        set.milestone(b);
        break;
      case 'tick':
        set.tick(b);
        break;
      case 'countdown':
        set.countdown(b);
        break;
      case 'metronome':
        // A bar of four, so the downbeat can be heard against the others.
        for (let i = 0; i < 4; i++) this.metro.clickNow(b, i === 0, i * 0.4);
        break;
    }
  }
}

let shared: AudioEngine | null = null;

/** Plays one feedback sound for the settings page. Call from a click handler. */
export function playTestSound(settings: Settings, sound: TestSound): void {
  if (!shared) shared = new AudioEngine(settings.audio);
  shared.setSettings(settings.audio);
  shared.playTest(sound);
}
