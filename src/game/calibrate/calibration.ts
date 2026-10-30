// The calibration screens (PLAN-2 5.6). A run of 4 lead-in beats and 24 taps against a 600 ms beat. The visual kind
// shows a ring closing on a target and the audio kind plays metronome clicks. Presses come through the same input
// handler as the game, so their times are event timestamps.

import { PLAYFIELD } from '../../shared/catalog';
import type { CalibrationCallbacks, CalibrationHandle, CalibrationKind, CreateCalibration, Settings } from '../../shared/types';
import { AudioEngine } from '../audio/audio';
import type { Grid } from '../audio/metronome';
import { InputHandler } from '../engine/input';
import type { InputSink } from '../engine/input';
import { Loop } from '../engine/loop';
import { Playfield } from '../engine/playfield';
import type { ApproachShape } from '../render/approach';
import { drawApproachIndicator } from '../render/indicator';
import { buildFieldBackground, defaultCanvasFactory, FIELD_PAD, SpriteCache } from '../render/objects';
import { resolveSkin } from '../render/skin';
import type { Skin } from '../render/skin';
import { COLORS, FONT } from '../render/theme';
import { BEAT_MS, CalibrationRun, FIRST_BEAT_MS, LEAD_IN_BEATS } from './run';
import { CALIBRATION_STRINGS as S } from './strings';

const TAU = Math.PI * 2;
const CENTER = { x: PLAYFIELD.width / 2, y: PLAYFIELD.height / 2 };
/** Radius of the target, in playfield units, for each kind. */
const RADIUS: Record<CalibrationKind, number> = { visual: 60, audio: 40 };
/** How long the flash after a tap lasts, ms. */
const FLASH_MS = 160;

const F_TITLE = `600 17px ${FONT}`;
const F_SUB = `500 14px ${FONT}`;
const F_SMALL = `500 12px ${FONT}`;
const F_COUNT = `700 22px ${FONT}`;
const F_BIG = `700 30px ${FONT}`;

class Calibration implements CalibrationHandle, InputSink {
  private run: CalibrationRun;
  private pf: Playfield;
  private input: InputHandler;
  private loop: Loop;
  private audio: AudioEngine | null = null;
  private sprites = new SpriteCache(defaultCanvasFactory);
  private skin: Skin;
  private shape: ApproachShape = { size: 0, rot: 0, alpha: 0 };
  private grid: Grid = { beatMs: BEAT_MS, beatOffsetMs: FIRST_BEAT_MS };
  private bg: HTMLCanvasElement | null = null;
  private bgKey = '';
  private destroyed = false;
  /** The page lost focus in the middle of a run, so the next press starts a new one. */
  private interrupted = false;
  private cursor = '';
  /** Web Audio could not start, so the audio run is off. */
  private silent = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private kind: CalibrationKind,
    settings: Settings,
    private callbacks: CalibrationCallbacks,
    private ctx: CanvasRenderingContext2D,
  ) {
    this.run = new CalibrationRun(kind);
    this.skin = resolveSkin(settings);
    // Any mouse button counts as a tap here, whatever the game setting says.
    const forInput: Settings = { ...settings, input: { ...settings.input, mouseButtons: true } };
    if (kind === 'audio') {
      // Clicks at the metronome volume (at least half), with the offset at 0 so the result is the whole offset.
      const a = settings.audio;
      this.audio = new AudioEngine({ ...a, muted: false, metronome: 'beat', metronomeVolume: Math.max(0.5, a.metronomeVolume), offsetMs: 0 });
    }
    this.pf = new Playfield(canvas);
    this.pf.onResize = () => {
      this.sprites.clear();
      this.bg = null;
    };
    this.pf.attach();
    this.input = new InputHandler(canvas, this.pf, () => forInput, this);
    this.input.attach();
    this.cursor = canvas.style.cursor;
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('blur', this.onBlur);
    this.loop = new Loop(() => this.frame());
    this.loop.start();
  }

  /* ---------------------------------------------------------------- input */

  move(): void {}
  release(): void {}
  escape(): void {}
  retry(): void {}
  lockLost(): void {}

  active(): boolean {
    return !this.destroyed;
  }

  press(_slot: unknown, ts: number): void {
    if (this.destroyed || this.silent) return;
    if (this.interrupted) {
      this.interrupted = false;
      this.run.reset();
    }
    const out = this.run.press(ts);
    if (out === 'started') {
      // The first press is a user gesture, so the audio context can start now. Without sound the run has nothing to
      // tap to, so it stops and says why instead of going on in silence.
      if (this.audio) void this.audio.start().then((ok) => ok || this.soundFailed());
      return;
    }
    if (out === 'tap' || out === 'finished') this.callbacks.onTap(this.run.taps, this.run.needed);
    if (out === 'finished') {
      this.audio?.quiet();
      this.callbacks.onDone(this.run.result());
    }
  }

  private soundFailed(): void {
    if (this.destroyed || this.silent) return;
    this.silent = true;
    this.audio?.quiet();
    this.run.reset();
    this.callbacks.onTap(0, this.run.needed);
    this.callbacks.onError(S.noSound);
  }

  /* ------------------------------------------------------------------ api */

  restart(): void {
    if (this.destroyed) return;
    this.interrupted = false;
    this.audio?.quiet();
    this.run.reset();
    this.callbacks.onTap(0, this.run.needed);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loop.stop();
    this.input.detach();
    this.pf.detach();
    this.audio?.destroy();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('blur', this.onBlur);
    this.canvas.style.cursor = this.cursor;
  }

  private onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.interrupt();
  };

  private onBlur = (): void => this.interrupt();

  /** A run that loses focus cannot be trusted, so it starts again at the next press. */
  private interrupt(): void {
    if (this.run.state !== 'running') return;
    this.interrupted = true;
    this.audio?.quiet();
    this.run.reset();
    this.callbacks.onTap(0, this.run.needed);
  }

  /* ----------------------------------------------------------------- draw */

  private frame(): void {
    if (this.destroyed) return;
    const now = performance.now();
    if (this.audio && this.run.state === 'running') this.audio.tickMetronome(this.grid, this.run.elapsed(now), now);
    this.draw(now);
  }

  private draw(now: number): void {
    const ctx = this.ctx;
    const pf = this.pf;
    const l = pf.layout;
    const dpr = pf.dpr;
    const ppu = dpr * l.scale;
    const run = this.run;
    pf.setHudTransform(ctx);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, l.cssW, l.cssH);
    const key = `${this.skin.bitmapKey}|${l.cssW}|${l.cssH}|${dpr}`;
    if (!this.bg || key !== this.bgKey) {
      this.bg = buildFieldBackground(defaultCanvasFactory, ppu, dpr, this.skin.fieldGrid);
      this.bgKey = key;
    }
    const pad = FIELD_PAD * l.scale;
    ctx.drawImage(this.bg, l.ox - pad, l.oy - pad, PLAYFIELD.width * l.scale + 2 * pad, PLAYFIELD.height * l.scale + 2 * pad);

    // The target. The ring is drawn at beat time with no visual offset, so the result is the whole offset.
    pf.setFieldTransform(ctx);
    const r = RADIUS[this.kind];
    const sp = this.sprites.target(this.skin, 0, r, ppu, false);
    ctx.globalAlpha = run.state === 'done' ? 0.4 : 1;
    ctx.drawImage(sp.canvas, CENTER.x - sp.half, CENTER.y - sp.half, sp.half * 2, sp.half * 2);
    const u = this.kind === 'visual' && run.state === 'running' ? run.ringProgress(now) : null;
    if (u !== null) drawApproachIndicator(ctx, this.skin, this.shape, CENTER.x, CENTER.y, r, 0, u, true);
    // A flash around the target after a tap.
    const since = now - run.lastPressAt;
    if (since >= 0 && since < FLASH_MS) {
      ctx.globalAlpha = 0.8 * (1 - since / FLASH_MS);
      ctx.lineWidth = 3;
      ctx.strokeStyle = run.lastKept ? COLORS.accent : COLORS.danger;
      ctx.beginPath();
      ctx.arc(CENTER.x, CENTER.y, r + 8 + 10 * (since / FLASH_MS), 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Text, in CSS pixels.
    pf.setHudTransform(ctx);
    this.drawText(now, l.ox, l.oy, PLAYFIELD.width * l.scale, PLAYFIELD.height * l.scale, l.cssH);
  }

  private drawText(now: number, ox: number, oy: number, w: number, h: number, cssH: number): void {
    const ctx = this.ctx;
    const run = this.run;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = F_TITLE;
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(S.title[this.kind], ox, 28);
    if (run.state !== 'ready') {
      ctx.textAlign = 'right';
      ctx.font = F_COUNT;
      ctx.fillStyle = run.state === 'done' ? COLORS.accent : COLORS.ink;
      ctx.fillText(S.progress(run.taps, run.needed), ox + w, 28);
    }
    ctx.textAlign = 'center';
    ctx.font = F_SUB;
    ctx.fillStyle = COLORS.ink2;
    let line: string;
    if (run.state === 'ready') line = this.interrupted ? S.paused : S.ready[this.kind];
    else if (run.state === 'done') line = S.doneSub(run.result().offsetMs);
    else if (run.leadInBeat(now) > 0) line = S.leadIn[this.kind];
    else line = run.lastError !== null && !run.lastKept && now - run.lastPressAt < 1500 ? S.tooFar : S.tapping[this.kind];
    ctx.fillText(line, ox + w / 2, cssH - 24);

    const cx = ox + w / 2;
    const cy = oy + h / 2;
    if (run.state === 'ready') {
      this.panel(cx, cy + 130, 360, 40);
      ctx.fillStyle = COLORS.ink;
      ctx.font = F_SUB;
      ctx.fillText(S.start, cx, cy + 130);
    } else if (run.state === 'running') {
      const beat = run.leadInBeat(now);
      if (beat > 0) {
        ctx.font = F_SMALL;
        ctx.fillStyle = COLORS.ink3;
        ctx.fillText(S.beat(beat, LEAD_IN_BEATS), cx, cy + 130);
      }
    } else {
      ctx.font = F_BIG;
      ctx.fillStyle = COLORS.accent;
      ctx.fillText(S.done, cx, cy + 130);
    }
  }

  private panel(cx: number, cy: number, w: number, h: number): void {
    const ctx = this.ctx;
    ctx.globalAlpha = 0.66;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.reticle;
    ctx.strokeRect(cx - w / 2 + 0.5, cy - h / 2 + 0.5, w - 1, h - 1);
  }
}

export const createCalibrationImpl: CreateCalibration = (canvas, kind, settings, callbacks) => {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    callbacks.onError(S.noCanvas);
    return { restart() {}, destroy() {} };
  }
  try {
    return new Calibration(canvas, kind, settings, callbacks, ctx);
  } catch (err) {
    callbacks.onError(err instanceof Error && err.message ? err.message : S.noCanvas);
    return { restart() {}, destroy() {} };
  }
};
