// The browser wrapper. It wires the clock, input, session, renderer and audio together and implements GameHandle.

import { MODES, RETRY_HOLD_MS } from '../../shared/catalog';
import type { CreateGame, GameCallbacks, GameHandle, InputInfo, InputSlot, LaunchRequest, PlayStatus, Settings } from '../../shared/types';
import { AudioEngine } from '../audio/audio';
import type { Grid } from '../audio/metronome';
import { ringSetsFor, setupPlay } from '../modes/runner';
import { SYSTEM_CURSOR } from '../render/cursor';
import { Effects } from '../render/effects';
import type { DisplayFlags } from '../render/effects';
import { FrameStats } from '../render/frameStats';
import { Renderer } from '../render/renderer';
import type { OverlayKind, RenderState } from '../render/renderer';
import { keyLabel, STRINGS } from '../render/strings';
import { Clock } from './clock';
import { Decimator } from './decimate';
import { InputHandler } from './input';
import type { InputSink } from './input';
import { Loop } from './loop';
import { Playfield } from './playfield';
import { GameSession } from './session';
import type { FeedbackEvent } from './session';

type State = 'ready' | 'playing' | 'paused' | 'locking' | 'countdown' | 'needsClick' | 'failing' | 'done';

const OVERLAY_OF: Record<State, OverlayKind> = {
  ready: 'ready',
  playing: 'none',
  paused: 'none',
  locking: 'none',
  countdown: 'countdown',
  needsClick: 'needsClick',
  failing: 'failing',
  done: 'none',
};

const COUNTDOWN_MS = 1000;
const FAIL_BANNER_MS = 1200;

class Game implements GameHandle, InputSink {
  private state: State = 'ready';
  private session!: GameSession;
  private dec: Decimator;
  private clock = new Clock();
  private pf: Playfield;
  private renderer!: Renderer;
  private fx = new Effects();
  private audio: AudioEngine;
  private input: InputHandler;
  private loop: Loop;
  private rs!: RenderState;
  private flags: DisplayFlags = { earlyLate: true, crispPopups: false, reduceMotion: false };
  private amb = { tracking: false, speed: 0, rpm: 0 };
  private grid: Grid = { beatMs: 500, beatOffsetMs: undefined };
  private finished = false;
  private destroyed = false;
  private startedAt = 0;
  private overlayT0 = 0;
  private failStart = 0;
  private countdownStart = 0;
  private everRaw = false;
  private penFirst = false;
  /** Bumped whenever a pending lock should no longer start anything. */
  private lockSeq = 0;
  private relockFails = 0;
  /** Raw input was given up for this play after the lock failed twice. */
  private rawOff = false;
  private cursorStyle = '';
  private lengthMs = 0;
  private fpsAt = 0;
  private fps: number | null = null;
  /** Frame times while playing, for the frame graph and InputInfo.frameP99Ms. */
  private frames = new FrameStats();
  private lastTs = 0;
  /** When the retry key went down, or -1 when it is not held. */
  private retryAt = -1;

  constructor(
    private canvas: HTMLCanvasElement,
    launch: LaunchRequest,
    private settings: Settings,
    private callbacks: GameCallbacks,
    ctx: CanvasRenderingContext2D,
  ) {
    const setup = setupPlay(launch);
    this.session = new GameSession({ map: setup.map, launch, controller: setup.controller, progressMs: setup.progressMs });
    this.dec = new Decimator(this.session);
    this.lengthMs = setup.controller ? launch.lengthSec * 1000 : setup.map.durationMs;
    this.pf = new Playfield(canvas);
    this.renderer = new Renderer(ctx, this.pf);
    this.pf.onResize = () => this.renderer.invalidate();
    this.pf.attach();
    this.audio = new AudioEngine(settings.audio);
    this.input = new InputHandler(canvas, this.pf, () => this.settings, this);
    this.input.attach();
    this.session.on((e) => this.onEvent(e));
    this.syncFlags();
    const status = this.session.levelStatus();
    this.rs = {
      session: this.session,
      fx: this.fx,
      settings,
      playT: 0,
      now: performance.now(),
      cursorX: 500,
      cursorY: 312.5,
      drawCursor: false,
      overlay: 'ready',
      overlayT0: performance.now(),
      startLabel: keyLabel(settings.input.keys[0]),
      raw: settings.input.rawInput,
      fps: null,
      showScore: !MODES[launch.modeId].adaptive,
      level: status ? status.level : null,
      set: status ? status.set : null,
      lengthMs: this.lengthMs,
      ringSets: ringSetsFor(launch),
      retry: 0,
      frames: this.frames,
    };
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('blur', this.onBlur);
    this.loop = new Loop((ts) => this.frame(ts));
    this.loop.start();
  }

  /* --------------------------------------------------------------- sink */

  move(ts: number, x: number, y: number): void {
    this.rs.cursorX = x;
    this.rs.cursorY = y;
    if (this.state !== 'playing') return;
    const t = this.clock.play(ts);
    if (t < 0) return;
    this.dec.move(t, x, y);
  }

  press(slot: InputSlot, ts: number, x: number | null, y: number | null): void {
    if (this.state === 'ready') {
      if (x !== null && y !== null) {
        this.rs.cursorX = x;
        this.rs.cursorY = y;
      }
      this.start(ts);
      return;
    }
    if (this.state === 'needsClick') {
      this.beginLock();
      return;
    }
    if (this.state !== 'playing') return;
    const t = this.clock.play(ts);
    if (t < 0) return;
    this.dec.press(slot, t, x, y);
    const skin = this.settings.skin;
    if (skin.clickRipple && !this.settings.display.reduceMotion) this.fx.ripple(x ?? this.rs.cursorX, y ?? this.rs.cursorY, performance.now());
    this.afterInput(performance.now());
  }

  release(slot: InputSlot, ts: number): void {
    if (this.state !== 'playing') return;
    const t = this.clock.play(ts);
    if (t < 0) return;
    this.dec.release(slot, t);
  }

  retry(ts: number, down: boolean): void {
    if (!down) {
      this.retryAt = -1;
      return;
    }
    if (this.retryAt >= 0 || !this.callbacks.onRetry || !this.retryAllowed()) return;
    this.retryAt = ts;
  }

  /** The hold counts while playing, paused or counting down, and in the short steps between a pause and play. */
  private retryAllowed(): boolean {
    const s = this.state;
    return s === 'playing' || s === 'paused' || s === 'countdown' || s === 'locking' || s === 'needsClick';
  }

  escape(ts: number): void {
    if (this.state === 'playing' || this.state === 'countdown') this.doPause(ts);
    else if (this.state === 'needsClick' || this.state === 'locking') {
      // Back to the pause menu, so Resume and Quit are there again.
      this.lockSeq++;
      this.state = 'paused';
      this.input.unlock();
      this.callbacks.onPause(true);
    } else if (this.state === 'paused' && !this.rawWanted()) this.resume();
  }

  private rawWanted(): boolean {
    return this.settings.input.rawInput && !this.penFirst && !this.rawOff;
  }

  lockLost(ts: number): void {
    if (this.state === 'playing' || this.state === 'countdown') this.doPause(ts);
  }

  active(): boolean {
    return this.state === 'ready' || this.state === 'playing' || this.state === 'countdown';
  }

  /* ------------------------------------------------------------- lifecycle */

  private start(ts: number): void {
    this.state = 'playing';
    this.clock.start(ts);
    this.startedAt = Date.now();
    this.audio.resume();
    this.fx.reset();
    this.renderer.reset();
    this.syncCursor(ts);
    this.frames.reset();
    this.penFirst = this.input.penSeen;
    if (this.rawWanted()) {
      const seq = ++this.lockSeq;
      void this.input.lock().then((ok) => {
        if (!ok) return;
        if (this.destroyed || this.finished || seq !== this.lockSeq || this.state === 'paused') {
          this.input.unlock();
          return;
        }
        this.everRaw = true;
      });
    }
  }

  /** Put the latest known cursor position into the play, so a key press before any movement lands in the right place. */
  private syncCursor(ts: number): void {
    const t = this.clock.play(ts);
    this.dec.moveNow(Math.max(0, t), this.rs.cursorX, this.rs.cursorY);
  }

  private doPause(ts: number): void {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    if (this.state === 'playing') {
      const t = this.clock.play(ts);
      this.dec.advance(t);
      this.input.releaseAll(ts);
      this.dec.notePause(t);
      this.clock.pause(ts);
    }
    this.state = 'paused';
    this.audio.quiet();
    this.input.unlock();
    this.callbacks.onPause(true);
  }

  resume(): void {
    if (this.destroyed || this.finished) return;
    if (this.state === 'needsClick') {
      this.beginLock();
      return;
    }
    if (this.state !== 'paused') return;
    this.callbacks.onPause(false);
    if (this.rawWanted()) this.beginLock();
    else this.startCountdown();
  }

  /** Lock the pointer again, from a click, then count down. */
  private beginLock(): void {
    this.state = 'locking';
    const seq = ++this.lockSeq;
    void this.input.lock().then((ok) => {
      // A lock that arrives after a destroy, a finish or an Esc is let go and starts nothing.
      if (this.destroyed || this.finished || seq !== this.lockSeq) {
        if (ok) this.input.unlock();
        return;
      }
      if (ok) {
        this.everRaw = true;
        this.relockFails = 0;
        this.startCountdown();
      } else if (++this.relockFails >= 2) {
        // Give up on raw input for this play and carry on with the system pointer.
        this.rawOff = true;
        this.fx.banner = Renderer.notice(STRINGS.rawOffTitle, STRINGS.rawOffSub, performance.now());
        this.startCountdown();
      } else {
        this.state = 'needsClick';
        this.overlayT0 = performance.now();
      }
    });
  }

  private startCountdown(): void {
    this.state = 'countdown';
    this.countdownStart = performance.now();
    this.audio.resume();
    this.audio.countdown();
  }

  pause(): void {
    this.doPause(performance.now());
  }

  quit(): void {
    // Quitting while the out of health banner shows still counts as a failed play.
    this.finish(this.session.failed ? 'failed' : 'quit');
  }

  setSettings(s: Settings): void {
    this.settings = s;
    this.rs.settings = s;
    this.audio.setSettings(s.audio);
    this.rs.startLabel = keyLabel(s.input.keys[0]);
    this.renderer.setSettings(s);
    this.syncFlags();
  }

  private syncFlags(): void {
    const d = this.settings.display;
    this.flags.earlyLate = d.earlyLate;
    this.flags.crispPopups = d.crispPopups;
    this.flags.reduceMotion = d.reduceMotion;
  }

  private onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      // The key-up of a held retry key never arrives while the page is hidden.
      this.retryAt = -1;
      this.doPause(performance.now());
    }
  };

  private onBlur = (): void => {
    this.retryAt = -1;
    this.doPause(performance.now());
  };

  private finish(status: PlayStatus, retry = false): void {
    if (this.finished || this.destroyed) return;
    this.finished = true;
    this.retryAt = -1;
    const wasPlaying = this.state === 'playing';
    const now = performance.now();
    if (wasPlaying) this.dec.advance(this.clock.play(now));
    this.state = 'done';
    const info: InputInfo = {
      pointer: this.input.pointerKind(),
      rawInput: this.everRaw,
      unadjusted: this.everRaw && this.input.unadjusted,
      sensitivity: this.settings.input.sensitivity,
      pointerHz: this.input.pointerHz(),
      displayHz: this.loop.displayHz(),
      visualOffsetMs: this.settings.display.visualOffsetMs,
      audioOffsetMs: this.settings.audio.offsetMs,
      frameP99Ms: this.frames.p99(),
    };
    const result = this.session.finish(status, { startedAt: this.startedAt || Date.now(), endedAt: Date.now(), input: info });
    this.input.releaseAll(now);
    this.input.unlock();
    this.audio.quiet();
    this.rs.overlay = 'none';
    this.rs.retry = 0;
    this.renderFrame(now);
    this.loop.stop();
    if (retry && this.callbacks.onRetry) this.callbacks.onRetry(result);
    else this.callbacks.onFinish(result);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loop.stop();
    this.input.detach();
    this.input.unlock();
    this.pf.detach();
    this.audio.destroy();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('blur', this.onBlur);
    this.canvas.style.cursor = '';
  }

  /* ----------------------------------------------------------- per frame */

  private onEvent(e: FeedbackEvent): void {
    this.audio.onEvent(e);
    const obj = e.index >= 0 ? (this.session.objs[e.index]?.obj ?? null) : null;
    const now = performance.now();
    this.fx.onEvent(e, now, obj, this.flags);
    if (e.type === 'setEnd' && e.setEnd) {
      this.fx.banner = Renderer.banner(e.setEnd.direction, e.setEnd.from, e.setEnd.to, now);
    }
  }

  private afterInput(now: number): void {
    if (this.session.failed && this.state === 'playing') {
      this.state = 'failing';
      this.failStart = now;
      this.overlayT0 = now;
    }
  }

  private frame(ts: number): void {
    if (this.destroyed) return;
    const now = performance.now();
    if (now - this.fpsAt > 500) {
      this.fps = this.loop.displayHz();
      this.fpsAt = now;
    }
    if (this.retryAt >= 0) {
      if (!this.retryAllowed()) this.retryAt = -1;
      else if (now - this.retryAt >= RETRY_HOLD_MS) {
        this.retryAt = -1;
        // A hold that completes after the health ran out is a failed play, as in quit().
        this.finish(this.session.failed ? 'failed' : 'quit', true);
        return;
      }
    }
    this.rs.retry = this.retryAt >= 0 ? Math.min(1, (now - this.retryAt) / RETRY_HOLD_MS) : 0;
    if (this.state === 'playing') {
      if (this.lastTs > 0) this.frames.push(ts - this.lastTs);
      this.dec.advance(this.clock.play(now));
      this.afterInput(now);
      if (this.state === 'playing' && this.session.over) {
        this.finish('completed');
        return;
      }
    } else if (this.state === 'countdown') {
      if (now - this.countdownStart >= COUNTDOWN_MS) {
        this.clock.resume(now);
        this.state = 'playing';
        this.session.noteResume(this.clock.play(now));
        this.syncCursor(now);
      }
    }
    if (this.state === 'failing' && now - this.failStart >= FAIL_BANNER_MS) {
      this.finish('failed');
      return;
    }
    this.lastTs = ts;
    this.renderFrame(now);
  }

  private renderFrame(now: number): void {
    const rs = this.rs;
    rs.now = now;
    rs.playT = this.clock.started ? this.clock.play(now) : 0;
    rs.fps = this.fps;
    rs.raw = this.settings.input.rawInput;
    rs.drawCursor = this.input.rawActive || this.settings.input.cursor === 'drawn';
    const o = OVERLAY_OF[this.state];
    if (o !== rs.overlay) {
      rs.overlay = o;
      if (o === 'countdown') rs.overlayT0 = this.countdownStart;
      else rs.overlayT0 = this.state === 'failing' ? this.failStart : this.overlayT0 || now;
    }
    const status = this.session.levelStatus();
    if (status) {
      rs.level = status.level;
      rs.set = status.set;
    }
    // Ambient sounds follow the play.
    if (this.state === 'playing') {
      this.session.ambient(rs.playT, this.amb);
      this.audio.setTracking(this.amb.tracking, Math.min(1, this.amb.speed / 1.2));
      this.audio.setSpinning(this.amb.rpm);
      // The metronome clicks are scheduled on the audio clock from here. They never reach the session.
      this.grid.beatMs = this.session.map.beatMs;
      this.grid.beatOffsetMs = this.session.map.beatOffsetMs;
      this.audio.tickMetronome(this.grid, rs.playT, now);
    }
    const style = rs.drawCursor && this.state !== 'paused' ? 'none' : SYSTEM_CURSOR;
    if (style !== this.cursorStyle) {
      this.cursorStyle = style;
      this.canvas.style.cursor = style;
    }
    this.renderer.render(rs);
  }
}

export const createGameImpl: CreateGame = (canvas, launch, settings, callbacks) => {
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: settings.display.lowLatency });
  if (!ctx) {
    callbacks.onError('This browser could not start the game canvas.');
    return inertHandle();
  }
  try {
    return new Game(canvas, launch, settings, callbacks, ctx);
  } catch (err) {
    callbacks.onError(err instanceof Error && err.message ? `The game could not start. ${err.message}` : 'The game could not start.');
    return inertHandle();
  }
};

function inertHandle(): GameHandle {
  return { resume() {}, pause() {}, quit() {}, setSettings() {}, destroy() {} };
}
