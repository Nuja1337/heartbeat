// Replay and autoplay playback on a canvas (PLAN-2 5.2 and 4.11). Browser code.
//
// A ReplayRunner feeds the trace into a fresh GameSession. The existing renderer draws that session at play time T,
// and the effects clock is play time too, so effects slow down at 0.25x and stand still while paused. A backward
// seek rebuilds the session and feeds from the start, skipping effects older than 800 ms before the target.
// Seeks are applied at most once per animation frame.

import { MODES } from '../../shared/catalog';
import type {
  CreatePlayback,
  PlaybackCallbacks,
  PlaybackHandle,
  PlaybackSource,
  ReplayData,
  Settings,
} from '../../shared/types';
import { AudioEngine } from '../audio/audio';
import { Loop } from '../engine/loop';
import { Playfield } from '../engine/playfield';
import type { FeedbackEvent } from '../engine/session';
import { Effects } from '../render/effects';
import type { DisplayFlags } from '../render/effects';
import { Renderer } from '../render/renderer';
import type { RenderState } from '../render/renderer';
import { keyLabel } from '../render/strings';
import { ENGINE_VERSION } from '../version';
import { autoplayReplay } from './autoplayReplay';
import { countMismatches, ReplayRunner } from './feed';

/** Effects older than this before the seek target are not made. */
export const SEEK_EFFECT_MS = 800;
/** onTime is called at most this often while playing. */
const TIME_CALLBACK_MS = 100;
/** A frame that took longer than this counts as this long. */
const MAX_FRAME_MS = 100;

export const NEWER_ENGINE_MESSAGE = 'This replay was made by a newer version of Flickwise.';
const COULD_NOT_PLAY = 'This replay could not be played.';
const NO_CANVAS = 'This browser could not start the game canvas.';

class Playback implements PlaybackHandle {
  private pf: Playfield;
  private renderer: Renderer;
  private fx = new Effects();
  private audio: AudioEngine;
  private loop: Loop;
  private flags: DisplayFlags = { earlyLate: true, crispPopups: false, reduceMotion: false };
  private runner: ReplayRunner | null = null;
  private rs: RenderState | null = null;
  private amb = { tracking: false, speed: 0, rpm: 0 };

  private ready = false;
  private wantPlay = false;
  private destroyed = false;
  private playing = false;
  private speed = 1;
  /** Play time being shown. */
  private time = 0;
  private durationMs = 0;
  private pendingSeek: number | null = null;
  private lastFrame = 0;
  private lastTimeCb = -1e9;
  /** Effects for events earlier than this are skipped. */
  private fxFrom = -Infinity;
  /** Hit sounds are made for the events being fed. */
  private sound = false;
  private soundOn = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private source: PlaybackSource,
    private settings: Settings,
    private cb: PlaybackCallbacks,
    ctx: CanvasRenderingContext2D,
  ) {
    this.pf = new Playfield(canvas);
    this.renderer = new Renderer(ctx, this.pf);
    this.pf.onResize = () => this.renderer.invalidate();
    this.pf.attach();
    this.audio = new AudioEngine(settings.audio);
    this.syncFlags();
    this.loop = new Loop(this.frame);
    this.loop.start();
    // The checks and the first build take a moment, and the caller has no handle until the constructor returns.
    setTimeout(() => this.load(), 0);
  }

  /* ---------------------------------------------------------------- load */

  private load(): void {
    if (this.destroyed) return;
    try {
      const replay: ReplayData = this.source.kind === 'replay' ? this.source.replay : autoplayReplay(this.source.launch);
      if (replay.engineVersion > ENGINE_VERSION) {
        this.cb.onError(NEWER_ENGINE_MESSAGE);
        return;
      }
      // One silent run over the whole trace. An older engine can judge differently, and the page says so.
      let mismatches = 0;
      if (this.source.kind === 'replay') {
        const check = new ReplayRunner(replay);
        check.feedAll();
        mismatches = countMismatches(check.judgments(), replay.judgments);
      }
      const runner = new ReplayRunner(replay, this.onEvent, this.onPress);
      this.runner = runner;
      this.durationMs = runner.durationMs;
      this.fx.spinHintShown = true;
      runner.feedTo(0);
      this.rs = this.initialState(replay, runner);
      this.ready = true;
      this.lastFrame = performance.now();
      this.cb.onReady({ durationMs: this.durationMs, mismatches });
      if (this.wantPlay && !this.destroyed) this.play();
    } catch {
      this.cb.onError(COULD_NOT_PLAY);
    }
  }

  private initialState(replay: ReplayData, runner: ReplayRunner): RenderState {
    const adaptive = MODES[replay.launch.modeId].adaptive;
    return {
      session: runner.session,
      fx: this.fx,
      settings: this.settings,
      playT: 0,
      now: 0,
      cursorX: 500,
      cursorY: 312.5,
      drawCursor: true,
      overlay: 'none',
      overlayT0: 0,
      startLabel: keyLabel(this.settings.input.keys[0]),
      raw: false,
      fps: null,
      showScore: !adaptive,
      level: null,
      set: null,
      lengthMs: adaptive ? replay.launch.lengthSec * 1000 : runner.session.map.durationMs,
      retry: 0,
    };
  }

  /* -------------------------------------------------------------- handle */

  play(): void {
    if (this.destroyed) return;
    if (!this.ready) {
      this.wantPlay = true;
      return;
    }
    if (this.time >= this.durationMs) this.pendingSeek = 0;
    this.playing = true;
    this.lastFrame = performance.now();
    this.audio.resume();
  }

  pause(): void {
    this.wantPlay = false;
    this.playing = false;
    this.stopSound();
  }

  seek(t: number): void {
    if (!this.ready || !Number.isFinite(t)) return;
    this.pendingSeek = Math.max(0, Math.min(this.durationMs, t));
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0.25, Math.min(2, speed));
    if (this.speed !== 1) this.stopSound();
  }

  setSettings(s: Settings): void {
    this.settings = s;
    if (this.rs) this.rs.settings = s;
    this.renderer.setSettings(s);
    this.audio.setSettings(s.audio);
    this.syncFlags();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loop.stop();
    this.pf.detach();
    this.audio.destroy();
    this.canvas.style.cursor = '';
  }

  private syncFlags(): void {
    const d = this.settings.display;
    this.flags.earlyLate = d.earlyLate;
    this.flags.crispPopups = d.crispPopups;
    this.flags.reduceMotion = d.reduceMotion;
  }

  private stopSound(): void {
    if (this.soundOn) {
      this.soundOn = false;
      this.audio.quiet();
    }
  }

  /* --------------------------------------------------------------- feed */

  private onEvent = (e: FeedbackEvent): void => {
    if (e.t < this.fxFrom) return;
    const runner = this.runner;
    if (!runner) return;
    const obj = e.index >= 0 ? (runner.session.objs[e.index]?.obj ?? null) : null;
    this.fx.onEvent(e, e.t, obj, this.flags);
    if (this.sound) this.audio.onEvent(e);
  };

  /** A press in the trace makes a click ripple, unless the skin or reduced motion says no. */
  private onPress = (t: number, x: number, y: number): void => {
    if (t < this.fxFrom || !this.settings.skin.clickRipple || this.settings.display.reduceMotion) return;
    this.fx.ripple(x, y, t);
  };

  /** Show time t after a jump. Rebuilds the session when it has to go back. */
  private applySeek(t: number): void {
    const runner = this.runner as ReplayRunner;
    this.fxFrom = t - SEEK_EFFECT_MS;
    this.sound = false;
    if (runner.seekTo(t)) this.fx.reset();
    this.fx.spinHintShown = true;
    this.renderer.reset();
    // The HUD eases toward the score and combo. After a jump it starts from the right numbers.
    const s = runner.session;
    this.fx.scoreShown = s.scoring.total(s.map.mods);
    this.fx.comboShown = s.scoring.combo;
    this.time = t;
    this.stopSound();
  }

  private frame = (): void => {
    const rs = this.rs;
    const runner = this.runner;
    if (this.destroyed || !this.ready || !rs || !runner) return;
    const now = performance.now();
    const dt = Math.min(MAX_FRAME_MS, Math.max(0, now - this.lastFrame));
    this.lastFrame = now;
    let jumped = false;

    if (this.pendingSeek !== null) {
      const t = this.pendingSeek;
      this.pendingSeek = null;
      this.applySeek(t);
      jumped = true;
    } else if (this.playing) {
      let t = this.time + dt * this.speed;
      let ended = false;
      if (t >= this.durationMs) {
        t = this.durationMs;
        ended = true;
      }
      this.fxFrom = t - SEEK_EFFECT_MS;
      this.sound = this.speed === 1;
      runner.feedTo(t);
      this.sound = false;
      this.time = t;
      if (ended) {
        if (this.source.kind === 'autoplay' && this.source.loop) {
          this.applySeek(0);
          jumped = true;
        } else {
          this.playing = false;
          this.stopSound();
          this.cb.onTime(this.time);
          this.cb.onEnd();
        }
      }
    }

    this.render(rs, runner);
    this.ambient(runner);

    if (jumped || (this.playing && now - this.lastTimeCb >= TIME_CALLBACK_MS)) {
      this.lastTimeCb = now;
      this.cb.onTime(this.time);
    }
  };

  /** Tracking and spinner sounds follow the play at normal speed. */
  private ambient(runner: ReplayRunner): void {
    if (this.playing && this.speed === 1) {
      runner.session.ambient(this.time, this.amb);
      this.audio.setTracking(this.amb.tracking, Math.min(1, this.amb.speed / 1.2));
      this.audio.setSpinning(this.amb.rpm);
      this.soundOn = true;
    } else {
      this.stopSound();
    }
  }

  private render(rs: RenderState, runner: ReplayRunner): void {
    const s = runner.session;
    rs.session = s;
    rs.playT = this.time;
    rs.now = this.time;
    if (s.cursor.size > 0) {
      const p = s.cursor.positionAt(this.time, this.cursorTmp);
      rs.cursorX = p.x;
      rs.cursorY = p.y;
    }
    // The replay controller knows the level of the set being played, closed or still open at the end.
    const status = s.levelStatus();
    if (status) {
      rs.set = status.set;
      rs.level = status.level;
    }
    this.renderer.render(rs);
  }

  private cursorTmp = { x: 0, y: 0 };
}

export const createPlayback: CreatePlayback = (canvas, source, settings, callbacks) => {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    callbacks.onError(NO_CANVAS);
    return inertHandle();
  }
  try {
    return new Playback(canvas, source, settings, callbacks, ctx);
  } catch (err) {
    callbacks.onError(err instanceof Error && err.message ? err.message : COULD_NOT_PLAY);
    return inertHandle();
  }
};

function inertHandle(): PlaybackHandle {
  return { play() {}, pause() {}, seek() {}, setSpeed() {}, setSettings() {}, destroy() {} };
}
