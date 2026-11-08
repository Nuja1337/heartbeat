import { describe, expect, it } from 'vitest';
import type { HitObject, InputSlot, PlayableMap } from '../../shared/types';
import { healthRulesFor } from '../rules/scoring';
import { launchFor, makeCircle, makeMap, makeSlider, makeSpinner } from '../testing/fixtures';
import { GameSession } from './session';
import type { FeedbackEvent } from './session';

function sessionFor(objects: HitObject[], opts: { health?: boolean; mods?: ('nofail' | 'onelife')[]; drain?: number } = {}) {
  const mods = opts.mods ?? [];
  const base = makeMap(objects, {
    health: opts.health
      ? {
          ...healthRulesFor(5, mods),
          drainPerSec: opts.drain ?? healthRulesFor(5, mods).drainPerSec,
          canFail: !mods.includes('nofail'),
          failOnFirstMiss: mods.includes('onelife'),
        }
      : null,
  });
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
    const r = s.finish('completed', {
      startedAt: 0,
      endedAt: 0,
      input: { pointer: null, rawInput: false, unadjusted: false, sensitivity: 1, pointerHz: null, displayHz: null },
    });
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

  it('gives a skipped object no press, even after a stray press near it', () => {
    const { s } = sessionFor([makeCircle(0, 1000, 100, 100), makeCircle(1, 1060, 400, 100)]);
    run(s, 0, 999, 240, 100);
    press(s, 1000, 240, 100); // near the first object, on neither
    run(s, 1001, 1065, 400, 100);
    press(s, 1070, 400, 100, 'key2');
    const first = [...s.records].sort((a, b) => a.index - b.index)[0]!;
    expect(first.missReason).toBe('skipped');
    expect(first.hit).toBeNull();
    expect(first.timingError).toBeNull();
    expect(first.aimRadial).toBeNull();
    expect(first.aimAlong).toBeNull();
    expect(first.input).toBeNull();
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

describe('the end of a play', () => {
  it('does not drain health after the last object is judged', () => {
    const { s } = sessionFor([makeCircle(0, 1000, 100, 100), makeCircle(1, 1500, 100, 100)], { health: true, drain: 0.9 });
    run(s, 0, 999, 100, 100);
    press(s, 1000, 100, 100);
    run(s, 1001, 1499, 100, 100);
    press(s, 1500, 100, 100, 'key2');
    const health = s.scoring.health;
    expect(health).toBeGreaterThan(0.3);
    run(s, 1501, 2600, 100, 100);
    expect(s.failed).toBe(false);
    expect(s.scoring.health).toBeCloseTo(health, 6);
    expect(s.over).toBe(true);
  });
});

describe('pauses', () => {
  it('keeps a cursor jump across a pause out of the next object movement', () => {
    const { s } = sessionFor([makeCircle(0, 1000, 150, 100), makeCircle(1, 3000, 400, 300)]);
    run(s, 0, 999, 150, 100);
    press(s, 1000, 150, 100);
    run(s, 1001, 1999, 150, 100);
    s.notePause(2000);
    // After the pause the pointer is somewhere else, and it travels to the target.
    s.noteResume(2000);
    s.move(2000, { x: 700, y: 500 });
    for (let t = 2001; t <= 2900; t++) {
      const u = Math.min(1, (t - 2000) / 800);
      const k = u * u * (3 - 2 * u);
      s.move(t, { x: 700 + (400 - 700) * k, y: 500 + (300 - 500) * k });
      s.advance(t);
    }
    run(s, 2901, 2999, 400, 300);
    press(s, 3000, 400, 300, 'key2');
    const rec = [...s.records].sort((a, b) => a.index - b.index)[1]!;
    expect(rec.afterPause).toBe(true);
    expect(rec.movement.efficiency!).toBeGreaterThan(0.95);
  });

  it('marks an object when the pause falls in the trip to it, even before its approach', () => {
    const o = [makeCircle(0, 1000, 150, 100), { ...makeCircle(1, 3000, 400, 300), approachMs: 300 }];
    const { s } = sessionFor(o);
    run(s, 0, 999, 150, 100);
    press(s, 1000, 150, 100);
    run(s, 1001, 1500, 150, 100);
    // The second object shows only from 2700, but the trip to it began at 1000.
    s.notePause(1500);
    expect(s.objs[1]!.afterPause).toBe(true);
  });

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

describe('recording', () => {
  const INFO = {
    startedAt: 0,
    endedAt: 0,
    input: { pointer: null, rawInput: false, unadjusted: false, sensitivity: 1, pointerHz: null, displayHz: null },
  };

  function recorded(act: (s: GameSession) => void) {
    const { s } = sessionFor([makeCircle(0, 1000, 100, 100)]);
    act(s);
    const result = s.finish('quit', INFO);
    const tr = result.replay!.trace;
    return Array.from({ length: tr.count }, (_, i) => [tr.ops[i], tr.t[i], tr.x[i], tr.y[i]]);
  }

  it('logs each public call with its op code', () => {
    const log = recorded((s) => {
      s.move(1, { x: 10, y: 20 });
      s.press('key2', 2, null);
      s.press('mouse1', 3, { x: 30, y: 40 });
      s.release('key2', 4);
      s.advance(5);
      s.notePause(5);
      s.noteResume(6);
    });
    expect(log).toEqual([
      [0, 1, 10, 20],
      [6, 2, 0, 0],
      [3, 3, 30, 40],
      [10, 4, 0, 0],
      [13, 5, 0, 0],
      [14, 5, 0, 0],
      [15, 6, 0, 0],
    ]);
  });

  it('snaps times to 1/64 ms and positions to 1/16 before it uses and logs them', () => {
    const { s } = sessionFor([makeCircle(0, 1000, 100, 100)]);
    s.move(10.01, { x: 100.04, y: 99.97 });
    s.press('key1', 10.02, { x: 100.04, y: 99.97 });
    s.advance(10.7);
    const tr = s.finish('quit', INFO).replay!.trace;
    expect(Array.from(tr.t.subarray(0, tr.count))).toEqual([10.015625, 10.015625, 10.703125]);
    expect(Array.from(tr.x.subarray(0, 2))).toEqual([100.0625, 100.0625]);
    expect(Array.from(tr.y.subarray(0, 2))).toEqual([100, 100]);
    expect(s.now).toBe(10.703125);
    expect(s.cursor.lastT).toBe(10.015625);
    expect(s.cursor.lastX).toBe(100.0625);
  });

  it('writes -0 as +0', () => {
    const log = recorded((s) => s.move(-0, { x: -0.01, y: -0 }));
    expect(Object.is(log[0]![1], 0)).toBe(true);
    expect(Object.is(log[0]![2], 0)).toBe(true);
    expect(Object.is(log[0]![3], 0)).toBe(true);
  });

  it('logs an advance only when it moves the clock forward', () => {
    const log = recorded((s) => {
      s.advance(10);
      s.advance(10);
      s.advance(9);
      s.advance(10.001);
      s.advance(11);
    });
    expect(log).toEqual([
      [13, 10, 0, 0],
      [13, 11, 0, 0],
    ]);
  });

  it('does not log the advance a press or a release makes inside', () => {
    const log = recorded((s) => {
      s.press('key1', 50, { x: 0, y: 0 });
      s.release('key1', 60);
    });
    expect(log.map((e) => e[0])).toEqual([1, 9]);
  });

  it('keeps calls that come out of order in the order they were made', () => {
    const log = recorded((s) => {
      s.move(20, { x: 1, y: 1 });
      s.press('key1', 17, null);
    });
    expect(log.map((e) => e[1])).toEqual([20, 17]);
  });

  it('leaves the replay out when record is off', () => {
    const base = makeMap([makeCircle(0, 1000, 100, 100)]);
    const s = new GameSession({ map: { ...base, mods: [], rate: 1 }, launch: launchFor(), record: false });
    s.move(1, { x: 1, y: 1 });
    expect(s.finish('quit', INFO).replay).toBeUndefined();
  });

  it('still finishes when the recording cannot be built', () => {
    const { s } = sessionFor([makeCircle(0, 1000, 100, 100)]);
    (s as unknown as { recorder: { toTrace(): never } }).recorder = {
      toTrace() {
        throw new Error('no memory');
      },
    };
    const r = s.finish('quit', INFO);
    expect(r.replay).toBeUndefined();
    expect(r.status).toBe('quit');
  });

  it('puts a copy of the map and its sections in the replay', () => {
    const { s } = sessionFor([makeCircle(0, 1000, 100, 100), makeCircle(1, 2000, 200, 100)]);
    const r = s.finish('quit', INFO);
    expect(r.replay!.map.objects).toHaveLength(2);
    expect(r.replay!.map.objects).not.toBe(s.map.objects);
    expect(r.replay!.judgments).toBe('--');
    expect(r.replay!.progressMs).toBe(s.progressMs);
  });

  it('passes the sections and beat offset on in the result map', () => {
    const base = makeMap([makeCircle(0, 1000, 100, 100)], {
      sections: [{ start: 0, end: 2000, intensity: 0.5, focus: 'mixed', role: 'build' } as never],
      beatOffsetMs: 321,
    });
    const s = new GameSession({ map: { ...base, mods: [], rate: 1 }, launch: launchFor() });
    const r = s.finish('quit', INFO);
    expect(r.map.sections).toEqual(base.sections);
    expect(r.map.sections).not.toBe(base.sections);
    expect(r.map.beatOffsetMs).toBe(321);
    const plain = sessionFor([makeCircle(0, 1000, 100, 100)]).s.finish('quit', INFO);
    expect(plain.map.sections).toBeUndefined();
    expect(plain.map.beatOffsetMs).toBeUndefined();
  });
});

describe('Bullseye judging', () => {
  function bullseyeSession(objects: HitObject[], mods: ('bullseye' | 'mirror')[] = ['bullseye']) {
    const map: PlayableMap = { ...makeMap(objects), mods, rate: 1 };
    const s = new GameSession({ map, launch: launchFor() });
    const events: FeedbackEvent[] = [];
    s.on((e) => events.push(e));
    return { s, events };
  }

  // Radius 50: the inner half is 25 units. The press is 30 ms late, which is Crisp.
  it('keeps Crisp when the press is 0.49r from the centre', () => {
    const { s, events } = bullseyeSession([makeCircle(0, 1000, 100, 100, 50)]);
    run(s, 0, 999, 124.5, 100);
    press(s, 1030, 124.5, 100);
    expect(events.find((e) => e.type === 'hit')!.judgment).toBe('crisp');
    expect(s.records[0]!.judgment).toBe('crisp');
  });

  it('turns Crisp into Rough when the press is 0.51r from the centre', () => {
    const { s, events } = bullseyeSession([makeCircle(0, 1000, 100, 100, 50)]);
    run(s, 0, 999, 125.5, 100);
    press(s, 1030, 125.5, 100);
    expect(events.find((e) => e.type === 'hit')!.judgment).toBe('rough');
    expect(s.records[0]!.judgment).toBe('rough');
    expect(s.records[0]!.headJudgment).toBe('rough');
    expect(s.scoring.counts.rough).toBe(1);
  });

  it('turns Solid into Rough, and leaves Rough alone', () => {
    const { s } = bullseyeSession([makeCircle(0, 1000, 100, 100), makeCircle(1, 2000, 100, 100)]);
    run(s, 0, 999, 140, 100);
    press(s, 1070, 140, 100);
    run(s, 1071, 1999, 140, 100);
    press(s, 1890, 140, 100, 'key2');
    expect(s.records.map((r) => r.judgment)).toEqual(['rough', 'rough']);
  });

  it('does not change a miss', () => {
    const { s } = bullseyeSession([makeCircle(0, 1000, 100, 100)]);
    run(s, 0, 1300, 140, 100);
    expect(s.records[0]!.judgment).toBe('miss');
    expect(s.records[0]!.headJudgment).toBe('miss');
  });

  it('does nothing without the mod', () => {
    const { s } = bullseyeSession([makeCircle(0, 1000, 100, 100, 50)], ['mirror']);
    run(s, 0, 999, 125.5, 100);
    press(s, 1030, 125.5, 100);
    expect(s.records[0]!.judgment).toBe('crisp');
  });

  it('caps the head of a slider and carries it into the slider judgment', () => {
    const slider = () => makeSlider(0, 1000, { x: 100, y: 100 }, [{ type: 'line', to: { x: 300, y: 100 } }], { spanMs: 500 });
    const { s } = bullseyeSession([slider()]);
    run(s, 0, 999, 130, 100);
    press(s, 1030, 130, 100);
    expect(s.objs[0]!.headJudgment).toBe('rough');
    // Follow the ball to the end, so the slider closes with its head judgment.
    for (let t = 1031; t <= 1700; t++) run(s, t, t, Math.min(300, 100 + (200 * (t - 1000)) / 500), 100);
    expect(s.records[0]!.headJudgment).toBe('rough');
    expect(s.records[0]!.judgment).toBe('rough');
    const plain = sessionFor([slider()]);
    run(plain.s, 0, 999, 130, 100);
    press(plain.s, 1030, 130, 100);
    for (let t = 1031; t <= 1700; t++) run(plain.s, t, t, Math.min(300, 100 + (200 * (t - 1000)) / 500), 100);
    expect(plain.s.records[0]!.headJudgment).toBe('crisp');
    expect(plain.s.records[0]!.judgment).toBe('crisp');
  });
});
