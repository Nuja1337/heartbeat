// Pointer, pen, touch and keyboard input. Presses are passed on the moment they arrive.

import type { InputSlot, PointerKind, Settings } from '../../shared/types';
import type { Playfield } from './playfield';

export interface InputSink {
  /** A cursor sample. ts is a performance.now() style timestamp. */
  move(ts: number, x: number, y: number): void;
  /** x and y are null for keys, which use the cursor position at ts. */
  press(slot: InputSlot, ts: number, x: number | null, y: number | null): void;
  release(slot: InputSlot, ts: number): void;
  escape(ts: number): void;
  /** The retry key went down or up. Never called for Escape or a hit key. */
  retry(ts: number, down: boolean): void;
  lockLost(ts: number): void;
  /** True while the game wants to keep keys such as Space from the page. */
  active(): boolean;
}

const SLOT_OF_BIT: [number, InputSlot][] = [
  [1, 'mouse1'],
  [2, 'mouse2'],
];

type LockableCanvas = HTMLCanvasElement & {
  requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
};

export class InputHandler {
  x = 500;
  y = 312.5;
  /** Raw mode is on: the pointer is locked and the cursor moves by deltas. */
  rawActive = false;
  /** The lock was granted with unadjusted movement. */
  unadjusted = false;
  penSeen = false;
  private kinds = new Set<PointerKind>();
  private buttons = 0;
  private heldKeys = { key1: false, key2: false };
  private lastRawT = -1e9;
  private usingRawUpdate = typeof window !== 'undefined' && 'onpointerrawupdate' in window;
  private tmp = { x: 0, y: 0 };
  private intervals = new Float32Array(512);
  private nIntervals = 0;
  private iIntervals = 0;
  private lastSampleT = 0;
  private scratch = new Float32Array(512);
  private attached = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private pf: Playfield,
    private getSettings: () => Settings,
    private sink: InputSink,
  ) {}

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.style.userSelect = 'none';
    c.addEventListener('pointerdown', this.onPointer);
    c.addEventListener('pointerup', this.onPointer);
    c.addEventListener('pointermove', this.onPointer);
    c.addEventListener('pointercancel', this.onCancel);
    if (this.usingRawUpdate) c.addEventListener('pointerrawupdate' as 'pointermove', this.onRaw);
    c.addEventListener('contextmenu', this.onContext);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onPointer);
    c.removeEventListener('pointerup', this.onPointer);
    c.removeEventListener('pointermove', this.onPointer);
    c.removeEventListener('pointercancel', this.onCancel);
    c.removeEventListener('pointerrawupdate' as 'pointermove', this.onRaw);
    c.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    document.removeEventListener('pointerlockchange', this.onLockChange);
  }

  /* -------------------------------------------------------------- pointer */

  private onContext = (e: Event): void => e.preventDefault();

  private onPointer = (e: PointerEvent): void => {
    if (e.type === 'pointermove' && this.usingRawUpdate && e.timeStamp - this.lastRawT < 200) {
      // The raw updates already carried the positions. Buttons still need a look.
      this.syncButtons(e);
      return;
    }
    this.handle(e);
  };

  private onRaw = (e: PointerEvent): void => {
    this.lastRawT = e.timeStamp;
    this.handle(e);
  };

  private onCancel = (e: PointerEvent): void => {
    this.buttonsTo(0, e.timeStamp);
  };

  private handle(e: PointerEvent): void {
    const kind = e.pointerType as PointerKind;
    if (kind === 'mouse' || kind === 'pen' || kind === 'touch') this.kinds.add(kind);
    if (kind === 'pen') this.penSeen = true;
    if (e.type === 'pointerdown' && !this.rawActive) {
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // Not all pointers can be captured.
      }
    }
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const samples: PointerEvent[] = list.length > 0 ? list : [e];
    let sumMx = 0;
    let sumMy = 0;
    if (this.rawActive) for (const s of samples) { sumMx += s.movementX; sumMy += s.movementY; }
    const useParent = this.rawActive && sumMx === 0 && sumMy === 0 && (e.movementX !== 0 || e.movementY !== 0);
    const sens = this.getSettings().input.sensitivity;
    const l = this.pf.layout;
    const use = useParent ? [e] : samples;
    for (const s of use) {
      if (this.rawActive) {
        this.x += (s.movementX * sens) / l.scale;
        this.y += (s.movementY * sens) / l.scale;
        this.x = Math.max(-50, Math.min(1050, this.x));
        this.y = Math.max(-31.25, Math.min(656.25, this.y));
      } else {
        this.pf.toField(s.clientX, s.clientY, this.tmp);
        this.x = this.tmp.x;
        this.y = this.tmp.y;
      }
      this.noteInterval(s.timeStamp);
      this.sink.move(s.timeStamp, this.x, this.y);
    }
    this.syncButtons(e);
  }

  private noteInterval(ts: number): void {
    const d = ts - this.lastSampleT;
    this.lastSampleT = ts;
    if (d > 0 && d < 100) {
      this.intervals[this.iIntervals] = d;
      this.iIntervals = (this.iIntervals + 1) % this.intervals.length;
      if (this.nIntervals < this.intervals.length) this.nIntervals++;
    }
  }

  /** Press and release events for the buttons that changed since the last pointer event. */
  private syncButtons(e: PointerEvent): void {
    this.buttonsTo(e.buttons, e.timeStamp);
  }

  private buttonsTo(buttons: number, ts: number): void {
    const diff = buttons ^ this.buttons;
    if (diff === 0) return;
    const use = this.getSettings().input.mouseButtons;
    for (const [bit, slot] of SLOT_OF_BIT) {
      if ((diff & bit) === 0) continue;
      const down = (buttons & bit) !== 0;
      if (down && use) this.sink.press(slot, ts, this.x, this.y);
      else if (!down) this.sink.release(slot, ts);
    }
    this.buttons = buttons;
  }

  /* ------------------------------------------------------------- keyboard */

  private slotFor(code: string): 'key1' | 'key2' | null {
    const keys = this.getSettings().input.keys;
    if (code === keys[0]) return 'key1';
    if (code === keys[1]) return 'key2';
    return null;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;
    const slot = this.slotFor(code);
    if (code === 'Escape') {
      if (this.sink.active()) e.preventDefault();
      if (!e.repeat) this.sink.escape(e.timeStamp);
      return;
    }
    if (slot || code === 'Space') {
      if (this.sink.active()) e.preventDefault();
    }
    if (!slot && this.isRetryKey(code)) {
      if (this.sink.active()) e.preventDefault();
      if (!e.repeat) this.sink.retry(e.timeStamp, true);
      return;
    }
    if (!slot || e.repeat || this.heldKeys[slot]) return;
    this.heldKeys[slot] = true;
    this.sink.press(slot, e.timeStamp, null, null);
  };

  /** The retry key is never Escape and never a hit key. '' turns it off. */
  private isRetryKey(code: string): boolean {
    const k = this.getSettings().input.retryKey;
    return k !== '' && code === k && code !== 'Escape' && this.slotFor(code) === null;
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    const slot = this.slotFor(e.code);
    if (!slot) {
      if (this.isRetryKey(e.code)) this.sink.retry(e.timeStamp, false);
      return;
    }
    if (this.sink.active()) e.preventDefault();
    if (!this.heldKeys[slot]) return;
    this.heldKeys[slot] = false;
    this.sink.release(slot, e.timeStamp);
  };

  /** Release everything that is held, for a pause. */
  releaseAll(ts: number): void {
    for (const k of ['key1', 'key2'] as const) {
      if (this.heldKeys[k]) {
        this.heldKeys[k] = false;
        this.sink.release(k, ts);
      }
    }
    this.buttonsTo(0, ts);
  }

  /* --------------------------------------------------------- pointer lock */

  private onLockChange = (): void => {
    const locked = document.pointerLockElement === this.canvas;
    if (!locked && this.rawActive) {
      this.rawActive = false;
      this.sink.lockLost(performance.now());
    }
  };

  private waitForLock(): Promise<boolean> {
    return new Promise((resolve) => {
      const done = (v: boolean) => {
        document.removeEventListener('pointerlockchange', onChange);
        document.removeEventListener('pointerlockerror', onError);
        window.clearTimeout(timer);
        resolve(v);
      };
      const onChange = () => done(document.pointerLockElement === this.canvas);
      const onError = () => done(false);
      const timer = window.setTimeout(() => done(document.pointerLockElement === this.canvas), 600);
      document.addEventListener('pointerlockchange', onChange);
      document.addEventListener('pointerlockerror', onError);
    });
  }

  /** Lock the pointer for raw input. Asks for unadjusted movement first and falls back without it. */
  async lock(): Promise<boolean> {
    const c = this.canvas as LockableCanvas;
    if (typeof c.requestPointerLock !== 'function') return false;
    if (document.pointerLockElement === c) {
      this.rawActive = true;
      return true;
    }
    let ok = false;
    try {
      const p = c.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof (p as Promise<void>).then === 'function') {
        await p;
        this.unadjusted = true;
        ok = true;
      } else {
        ok = await this.waitForLock();
        this.unadjusted = false;
      }
    } catch {
      try {
        const p2 = c.requestPointerLock();
        if (p2 && typeof (p2 as Promise<void>).then === 'function') {
          await p2;
          ok = true;
        } else {
          ok = await this.waitForLock();
        }
        this.unadjusted = false;
      } catch {
        ok = false;
      }
    }
    this.rawActive = ok && document.pointerLockElement === c;
    return this.rawActive;
  }

  unlock(): void {
    this.rawActive = false;
    if (typeof document !== 'undefined' && document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /* ----------------------------------------------------------------- info */

  pointerKind(): PointerKind | 'mixed' | null {
    if (this.kinds.size === 0) return null;
    if (this.kinds.size > 1) return 'mixed';
    return this.kinds.values().next().value as PointerKind;
  }

  pointerHz(): number | null {
    if (this.nIntervals < 50) return null;
    const s = this.scratch.subarray(0, this.nIntervals);
    s.set(this.intervals.subarray(0, this.nIntervals));
    s.sort();
    const med = s[this.nIntervals >> 1] as number;
    return med > 0 ? Math.round((1000 / med) * 10) / 10 : null;
  }
}
