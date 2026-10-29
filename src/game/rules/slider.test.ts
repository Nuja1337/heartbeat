import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../shared/types';
import { CursorBuffer, HoldLog } from '../engine/cursor';
import { makeSlider } from '../testing/fixtures';
import {
  ballDirection,
  ballPos,
  buildSliderGeometry,
  endCheckTime,
  SliderRun,
  sliderOutcome,
  trackingJudgment,
  trackingNext,
  worseOf,
} from './slider';
import type { SliderSink } from './slider';

const straight = (len: number, opts = {}) => makeSlider(0, 1000, { x: 100, y: 300 }, [{ type: 'line', to: { x: 100 + len, y: 300 } }], opts);

class Sink implements SliderSink {
  parts: { kind: number; hit: boolean }[] = [];
  track: boolean[] = [];
  onPart(kind: number, hit: boolean) {
    this.parts.push({ kind, hit });
  }
  onTrack(on: boolean) {
    this.track.push(on);
  }
}

/** Run a slider with the cursor given by a function of time and a hold function. */
function run(
  obj: ReturnType<typeof straight>,
  cursorAt: (t: number) => Vec2,
  held: (t: number) => boolean,
) {
  const g = buildSliderGeometry(obj);
  const r = new SliderRun(g);
  const buf = new CursorBuffer(8192);
  const log = new HoldLog();
  let lastHeld = false;
  const sink = new Sink();
  for (let t = obj.time - 50; t <= obj.endTime + 60; t++) {
    const p = cursorAt(t);
    buf.push(t, p.x, p.y);
    const h = held(t);
    if (h !== lastHeld) {
      log.set(t, h ? 1 : 0);
      lastHeld = h;
    }
    if (t % 4 === 0) r.step(t - 20, buf, log, sink);
  }
  r.step(obj.endTime + 100, buf, log, sink);
  return { r, sink, g };
}

describe('slider geometry', () => {
  it('places ticks at the tick distance and skips one at the end', () => {
    const o = straight(300, { tickDistance: 75 }); // 75, 150, 225 and 300 (skipped, at the end)
    const g = buildSliderGeometry(o);
    // three ticks plus the end
    expect(g.checkT.length).toBe(4);
    expect(g.partsBeforeEnd).toBe(3);
    expect(Array.from(g.checkKind)).toEqual([1, 1, 1, 3]);
  });

  it('adds a repeat check at each reversal and mirrors ticks', () => {
    const o = straight(300, { tickDistance: 100, repeats: 1, spanMs: 400 });
    const g = buildSliderGeometry(o);
    // ticks at 100 and 200 on each of two passes, one repeat, one end
    expect(g.checkT.length).toBe(2 + 2 + 1 + 1);
    expect(Array.from(g.checkKind).filter((k) => k === 2).length).toBe(1);
    // reverse pass: the tick at 200 comes first
    const times = Array.from(g.checkT);
    expect(times[2]).toBeCloseTo(o.time + 400, 6); // repeat
    expect(times[3]).toBeCloseTo(o.time + 400 + (1 - 200 / 300) * 400, 6);
  });

  it('puts the end check 40 ms before the end, or mid-pass for short spans', () => {
    const o = straight(300, { spanMs: 500 });
    expect(endCheckTime(o)).toBe(o.endTime - 40);
    const s = straight(300, { spanMs: 120 });
    expect(endCheckTime(s)).toBe(s.time + 60);
  });

  it('moves the ball and turns it around on repeats', () => {
    const o = straight(300, { repeats: 1, spanMs: 400 });
    const g = buildSliderGeometry(o);
    const p = { x: 0, y: 0 };
    ballPos(g, o.time + 200, p);
    expect(p.x).toBeCloseTo(250, 6);
    ballPos(g, o.time + 600, p);
    expect(p.x).toBeCloseTo(250, 6);
    const d = { x: 0, y: 0 };
    ballDirection(g, o.time + 100, d);
    expect(d.x).toBeCloseTo(1, 6);
    ballDirection(g, o.time + 600, d);
    expect(d.x).toBeCloseTo(-1, 6);
  });
});

describe('tracking', () => {
  it('uses 1 radius to start and the follow radius to continue', () => {
    expect(trackingNext(false, true, 50, 50, 100)).toBe(true);
    expect(trackingNext(false, true, 50.1, 50, 100)).toBe(false);
    expect(trackingNext(true, true, 100, 50, 100)).toBe(true);
    expect(trackingNext(true, true, 100.1, 50, 100)).toBe(false);
    expect(trackingNext(true, false, 0, 50, 100)).toBe(false);
  });

  it('hits every part when the cursor rides the ball', () => {
    const o = straight(300, { tickDistance: 75 });
    const g = buildSliderGeometry(o);
    const { r, sink } = run(
      o,
      (t) => {
        const p = { x: 0, y: 0 };
        ballPos(g, t, p);
        return p;
      },
      (t) => t >= o.time && t <= o.endTime + 5,
    );
    expect(r.done).toBe(true);
    expect(r.partsHit).toBe(r.partsTotal);
    expect(sink.parts.every((p) => p.hit)).toBe(true);
    expect(r.stats().trackedFraction).toBeGreaterThan(0.98);
    expect(r.stats().breaks).toBe(0);
    expect(r.stats().endHit).toBe(true);
  });

  it('loses the ball when the cursor stays behind past the follow radius', () => {
    const o = straight(300, { tickDistance: 75 });
    const g = buildSliderGeometry(o);
    const { r, sink } = run(
      o,
      (t) => {
        const p = { x: 0, y: 0 };
        if (t < o.time + 150) ballPos(g, t, p);
        else {
          ballPos(g, o.time + 150, p); // stops
        }
        return p;
      },
      (t) => t >= o.time,
    );
    expect(r.breaks).toBe(1);
    expect(r.partsHit).toBeLessThan(r.partsTotal);
    expect(sink.track[0]).toBe(true);
    expect(sink.track[1]).toBe(false);
    expect(r.stats().firstLossAt).not.toBeNull();
  });

  it('does not track without a held button', () => {
    const o = straight(300);
    const g = buildSliderGeometry(o);
    const { r } = run(
      o,
      (t) => {
        const p = { x: 0, y: 0 };
        ballPos(g, t, p);
        return p;
      },
      () => false,
    );
    expect(r.partsHit).toBe(0);
    expect(r.stats().trackedFraction).toBe(0);
  });
});

describe('final judgment', () => {
  it('grades by the share of parts', () => {
    expect(trackingJudgment(1)).toBe('crisp');
    expect(trackingJudgment(0.75)).toBe('solid');
    expect(trackingJudgment(0.4)).toBe('rough');
    expect(trackingJudgment(0.39)).toBe('miss');
    expect(worseOf('crisp', 'rough')).toBe('rough');
  });

  it('takes the worse of head and tracking', () => {
    expect(sliderOutcome('crisp', null, 1).judgment).toBe('crisp');
    expect(sliderOutcome('solid', null, 1).judgment).toBe('solid');
    expect(sliderOutcome('crisp', null, 0.5).judgment).toBe('rough');
    const m = sliderOutcome('crisp', null, 0.1);
    expect(m.judgment).toBe('miss');
    expect(m.missReason).toBe('tracking');
  });

  it('caps a missed head at Rough, and misses when nothing was tracked', () => {
    expect(sliderOutcome('miss', 'aim', 1).judgment).toBe('rough');
    expect(sliderOutcome('miss', 'aim', 0.8).judgment).toBe('rough');
    const m = sliderOutcome('miss', 'early', 0);
    expect(m.judgment).toBe('miss');
    expect(m.missReason).toBe('early');
  });
});
