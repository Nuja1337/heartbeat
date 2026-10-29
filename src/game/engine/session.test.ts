import { describe, expect, it } from 'vitest';
import type { HitObject, InputSlot, PlayableMap } from '../../shared/types';
import { healthRulesFor } from '../rules/scoring';
import { launchFor, makeCircle, makeMap, makeSlider, makeSpinner } from '../testing/fixtures';
import { GameSession } from './session';
import type { FeedbackEvent } from './session';

function sessionFor(objects: HitObject[], opts: { health?: boolean; mods?: ('nofail' | 'onelife')[] } = {}) {
  const mods = opts.mods ?? [];
  const base = makeMap(objects, { health: opts.health ? { ...healthRulesFor(5, mods), canFail: !mods.includes('nofail'), failOnFirstMiss: mods.includes('onelife') } : null });
  const map: PlayableMap = { ...base, mods: [], rate: 1 };
  const s = new GameSession({ map, launch: launchFor() });
  const events: FeedbackEvent[] = [];
  s.on((e) => events.push(e));
  return { s, events };
}

/** Advance in 1 ms steps with the cursor held at a point. */
function run(s: GameSession, from: number, to: number, x = 0, y = 0) {
  for (let t = from; t <= to; t++) {
    s.move(t, { x, y });
    s.advance(t);
  }
}

const press = (s: GameSession, t: number, x: number, y: number, slot: InputSlot = 'key1') => {
  s.move(t, { x, y });
  s.press(slot, t, { x, y });
};

describe('circles', () => {
  it('judges a press inside the window and records it', () => {
    const { s, events } = sessionFor([makeCircle(0, 1000, 100, 100)]);
    run(s, 0, 999, 100, 100);
    press(s, 1030, 100, 100);
    const hit = events.find((e) => e.type === 'hit')!;
    expect(hit.judgment).toBe('crisp');
    expect(hit.value).toBe(30);
    expect(s.scoring.combo).toBe(1);
    run(s, 1031, 2200, 100, 100);
    const r = s.finish('completed', { startedAt: 0, endedAt: 0, input: { pointer: null, rawInput: false, unadjusted: false, sensitivity: 1, pointerHz: null, displayHz: null } });
    expect(r.records).toHaveLength(1);
    expect(r.records[0]!.timingError).toBe(30);
    expect(r.records[0]!.judgment).toBe('crisp');
    expect(r.counts.crisp).toBe(1);
  });

  it('judges Solid and Rough by timing', () => {
    const { s } = sessionFor([makeCircle(0, 1000, 100, 100), makeCircle(1, 2000, 100, 100)]);
    run(s, 0, 999, 100, 100);
    press(s, 1070, 100, 100);
    run(s, 1071, 1999, 100, 100);
    press(s, 1890, 100, 100, 'key2');
    expect(s.records.map((r) => r.judgment)).toEqual(['solid', 'rough']);
  });

  it('misses with no reason when nothing was pressed', () => {
    const { s, events } = sessionFor([makeCircle(0, 1000, 100, 100)]);
    run(s, 0, 1200, 100, 100);
    const m = events.find((e) => e.type === 'miss')!;
    expect(m.reason).toBe('none');
    expect(s.records[0]!.missReason).toBe('none');
    expect(s.records[0]!.timingError).toBeNull();
    expect(s.records[0]!.hit).toBeNull();
  });

  it('turns a near stray press into an aim miss and records the press', () => {
    const { s } = sessionFor([makeCircle(0, 1000, 100, 100, 50)]);
    run(s, 0, 990, 250, 100);
    press(s, 1010, 250, 100); // 150 units away, 3 radii
    run(s, 1011, 1300, 250, 100);
    const r = s.records[0]!;
    expect(r.judgment).toBe('miss');
    expect(r.missReason).toBe('aim');
    expect(r.timingError).toBe(10);
    expect(r.hit).toEqual({ x: 250, y: 100 });
    expect(r.aimRadial).toBeCloseTo(150, 6);
    expect(s.strayPresses).toBe(1);
  });

  it('keeps the nearest of several stray presses', () => {
    const { s } = sessionFor([makeCircle(0, 1000, 100, 100, 50)]);
    run(s, 0, 990, 200, 100);
    press(s, 1000, 240, 100);
    press(s, 1020, 180, 100, 'key2');
    run(s, 1021, 1300, 200, 100);
    expect(s.records[0]!.hit).toEqual({ x: 180, y: 100 });
  });

  it('does not count a far stray press as an aim miss', () => {
    const { s } = sessionFor([makeCircle(0, 1000, 100, 100, 50)]);
    run(s, 0, 990, 600, 500);
    press(s, 1000, 600, 500);
    run(s, 1001, 1300, 600, 500);
    expect(s.records[0]!.missReason).toBe('none');
    expect(s.records[0]!.hit).toBeNull();
  });

  it('makes a press in the early band an early miss', () => {
    const { s } = sessionFor([makeCircle(0, 1000, 100, 100)]);
    run(s, 0, 840, 100, 100);
    press(s, 850, 100, 100);
    const r = s.records[0]!;
    expect(r.judgment).toBe('miss');
    expect(r.missReason).toBe('early');
    expect(r.timingError).toBe(-150);
  });

  it('ignores a press far too early', () => {
    const { s } = sessionFor([makeCircle(0, 1000, 100, 100)]);
    run(s, 0, 500, 100, 100);
    press(s, 600, 100, 100);
    expect(s.records).toHaveLength(0);
    expect(s.strayPresses).toBe(1);
    press(s, 1000, 100, 100, 'key2');
    expect(s.records[0]!.judgment).toBe('crisp');
  });

  it('marks an earlier object skipped when a later one is hit first', () => {
    const { s } = sessionFor([makeCircle(0, 1000, 100, 100), makeCircle(1, 1060, 400, 100)]);
    run(s, 0, 1065, 400, 100);
    press(s, 1070, 400, 100);
    const byIndex = [...s.records].sort((a, b) => a.index - b.index);
    expect(byIndex[0]!.missReason).toBe('skipped');
    expect(byIndex[1]!.judgment).toBe('crisp');
  });

  it('absorbs a press while an earlier object is still ahead', () => {
    const { s } = sessionFor([makeCircle(0, 1100, 100, 100), makeCircle(1, 1160, 400, 100)]);
    run(s, 0, 1049, 400, 100);
    press(s, 1050, 400, 100);
    expect(s.records).toHaveLength(0);
    expect(s.strayPresses).toBe(0);
  });

  it('breaks a long combo with a break event', () => {
    const objs = Array.from({ length: 13 }, (_, i) => makeCircle(i, 1000 + i * 400, 100, 100));
    const { s, events } = sessionFor(objs);
    run(s, 0, 999, 100, 100);
    for (let i = 0; i < 12; i++) {
      press(s, 1000 + i * 400, 100, 100, i % 2 ? 'key2' : 'key1');
      run(s, 1001 + i * 400, 1000 + (i + 1) * 400 - 1, 100, 100);
    }
    expect(s.scoring.combo).toBe(12);
    run(s, 1000 + 12 * 400, 1000 + 12 * 400 + 300, 100, 100);
    const br = events.find((e) => e.type === 'comboBreak')!;
    expect(br.value).toBe(12);
    expect(s.scoring.combo).toBe(0);
  });
});

describe('sliders', () => {
  it('adds one combo for the head and one per part', () => {
    const o = makeSlider(0, 1000, { x: 100, y: 300 }, [{ type: 'line', to: { x: 400, y: 300 } }], { spanMs: 500, tickDistance: 75 });
    const { s, events } = sessionFor([o]);
    run(s, 0, 999, 100, 300);
    s.move(1000, { x: 100, y: 300 });
    s.press('key1', 1000, null);
    for (let t = 1001; t <= 1700; t++) {
      const x = 100 + Math.min(300, ((t - 1000) / 500) * 300);
      s.move(t, { x, y: 300 });
      s.advance(t);
    }
    s.release('key1', 1505);
    run(s, 1701, 1800, 400, 300);
    const parts = events.filter((e) => e.type === 'tick' || e.type === 'endHit').length;
    expect(parts).toBe(4); // ticks at 75, 150, 225 and the end
    expect(s.scoring.maxCombo).toBe(1 + parts);
    const rec = s.records[0]!;
    expect(rec.judgment).toBe('crisp');
    expect(rec.slider!.ticksHit).toBe(3);
    expect(rec.slider!.endHit).toBe(true);
  });

  it('breaks the combo on a missed part and grades by the share hit', () => {
    const o = makeSlider(0, 1000, { x: 100, y: 300 }, [{ type: 'line', to: { x: 400, y: 300 } }], { spanMs: 500, tickDistance: 75 });
    const { s, events } = sessionFor([o]);
    run(s, 0, 999, 100, 300);
    s.move(1000, { x: 100, y: 300 });
    s.press('key1', 1000, null);
    // Stay at the head: tracking is lost once the ball is out of the follow radius.
    for (let t = 1001; t <= 1700; t++) {
      s.move(t, { x: 100, y: 300 });
      s.advance(t);
    }
    expect(events.some((e) => e.type === 'tickMiss')).toBe(true);
    const rec = s.records[0]!;
    expect(rec.judgment === 'miss' || rec.judgment === 'rough').toBe(true);
    expect(rec.headJudgment).toBe('crisp');
    expect(rec.slider!.breaks).toBeGreaterThan(0);
  });
});

describe('spinners', () => {
  it('misses with reason spin when untouched', () => {
    const { s } = sessionFor([makeSpinner(0, 1000, 2000, 5)]);
    run(s, 0, 3100, 500, 312);
    expect(s.records[0]!.judgment).toBe('miss');
    expect(s.records[0]!.missReason).toBe('spin');
    expect(s.records[0]!.spinner!.rotations).toBe(0);
  });
});

describe('health and fail', () => {
  it('fails at zero health and stops judging', () => {
    const objs = Array.from({ length: 40 }, (_, i) => makeCircle(i, 1000 + i * 300, 100, 100));
    const { s, events } = sessionFor(objs, { health: true });
    run(s, 0, 14000, 100, 100);
    expect(s.failed).toBe(true);
    expect(events.filter((e) => e.type === 'fail')).toHaveLength(1);
    const n = s.records.length;
    run(s, 14001, 15000, 100, 100);
    expect(s.records.length).toBe(n);
  });

  it('does not fail with No Fail', () => {
    const objs = Array.from({ length: 40 }, (_, i) => makeCircle(i, 1000 + i * 300, 100, 100));
    const { s } = sessionFor(objs, { health: true, mods: ['nofail'] });
    run(s, 0, 14000, 100, 100);
    expect(s.failed).toBe(false);
    expect(s.scoring.health).toBe(0);
  });

  it('fails on the first miss with One Life', () => {
    const { s } = sessionFor([makeCircle(0, 1000, 100, 100), makeCircle(1, 2000, 100, 100)], { health: true, mods: ['onelife'] });
    run(s, 0, 999, 100, 100);
    press(s, 1000, 100, 100);
    run(s, 1001, 2300, 100, 100);
    expect(s.failed).toBe(true);
  });
});

describe('pauses', () => {
  it('marks objects on screen when a pause starts', () => {
    const { s } = sessionFor([makeCircle(0, 1000, 100, 100), makeCircle(1, 3000, 100, 100), makeCircle(2, 9000, 100, 100)]);
    run(s, 0, 900, 100, 100);
    s.notePause(900);
    run(s, 901, 1200, 100, 100);
    run(s, 1201, 3200, 100, 100);
    const flags = [...s.records].sort((a, b) => a.index - b.index).map((r) => r.afterPause);
    expect(flags).toEqual([true, false]);
    expect(s.pauses).toBe(1);
    expect(s.objs[2]!.afterPause).toBe(false);
  });
});
