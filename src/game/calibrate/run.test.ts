import { describe, expect, it } from 'vitest';
import { BEAT_MS, calibrationResult, CalibrationRun, DROP_MS, FIRST_BEAT_MS, KEEP_LAST, LEAD_IN_BEATS, nearestBeat, TAPS_NEEDED } from './run';

describe('calibrationResult', () => {
  it('gives the median and the sample standard deviation', () => {
    const r = calibrationResult([10, 20, 30, 40, 50]);
    expect(r.medianMs).toBe(30);
    expect(r.sdMs).toBeCloseTo(Math.sqrt(250), 9);
    expect(r.used).toBe(5);
  });

  it('averages the two middle values for an even count', () => {
    expect(calibrationResult([4, 10, 2, 8]).medianMs).toBe(6);
  });

  it('uses only the last 20', () => {
    const errors = [...Array.from({ length: 10 }, () => 150), ...Array.from({ length: 20 }, () => 20)];
    const r = calibrationResult(errors);
    expect(KEEP_LAST).toBe(20);
    expect(r.used).toBe(20);
    expect(r.medianMs).toBe(20);
    expect(r.sdMs).toBe(0);
  });

  it('keeps negative errors and drops the ones past 200 ms', () => {
    const r = calibrationResult([-30, -20, -10, 250, -250, 201]);
    expect(r.used).toBe(3);
    expect(r.medianMs).toBe(-20);
    expect(calibrationResult([200, -200]).used).toBe(2);
    expect(DROP_MS).toBe(200);
  });

  it('is not moved by one wild tap', () => {
    const steady = Array.from({ length: 19 }, (_, i) => 30 + (i % 3));
    expect(calibrationResult([...steady, 190]).medianMs).toBeCloseTo(calibrationResult(steady).medianMs, 0);
  });

  it('handles an empty or single list', () => {
    expect(calibrationResult([])).toEqual({ medianMs: 0, sdMs: 0, used: 0 });
    expect(calibrationResult([42])).toEqual({ medianMs: 42, sdMs: 0, used: 1 });
  });
});

describe('nearestBeat', () => {
  it('gives the beat index and the signed error', () => {
    expect(nearestBeat(10000, 10000)).toEqual({ index: 0, error: 0 });
    expect(nearestBeat(10000 + 600 * 5 + 35, 10000)).toEqual({ index: 5, error: 35 });
    expect(nearestBeat(10000 + 600 * 5 - 35, 10000).error).toBe(-35);
    // Past the half way point it belongs to the next beat.
    expect(nearestBeat(10000 + 301, 10000)).toEqual({ index: 1, error: 301 - 600 });
  });
});

describe('CalibrationRun', () => {
  /** Press at beat n with an error of e ms. */
  const at = (run: CalibrationRun, n: number, e: number) => run.press(run.firstBeat + n * BEAT_MS + e);

  it('waits for a first press, which starts the run and is not a tap', () => {
    const run = new CalibrationRun('visual');
    expect(run.state).toBe('ready');
    expect(run.press(5000)).toBe('started');
    expect(run.state).toBe('running');
    expect(run.startedAt).toBe(5000);
    expect(run.firstBeat).toBe(5000 + FIRST_BEAT_MS);
    expect(run.taps).toBe(0);
  });

  it('ignores presses during the 4 lead-in beats', () => {
    const run = new CalibrationRun('audio');
    run.press(0);
    for (let n = 0; n < LEAD_IN_BEATS; n++) expect(at(run, n, 5)).toBe('lead-in');
    expect(run.taps).toBe(0);
    expect(at(run, LEAD_IN_BEATS, 5)).toBe('tap');
    expect(run.taps).toBe(1);
  });

  it('counts a tap a little early for the first counted beat', () => {
    const run = new CalibrationRun('audio');
    run.press(0);
    expect(at(run, LEAD_IN_BEATS, -150)).toBe('tap');
  });

  it('drops a tap more than 200 ms from the nearest beat, and does not count it', () => {
    const run = new CalibrationRun('visual');
    run.press(0);
    expect(at(run, 4, 250)).toBe('dropped');
    expect(at(run, 5, -201)).toBe('dropped');
    expect(run.taps).toBe(0);
    expect(run.lastKept).toBe(false);
    expect(at(run, 6, 200)).toBe('tap');
    expect(run.taps).toBe(1);
    expect(run.lastKept).toBe(true);
  });

  it('finishes after 24 kept taps with the median and spread of the last 20', () => {
    const run = new CalibrationRun('visual');
    run.press(0);
    const seen: PressLog = [];
    for (let i = 0; i < TAPS_NEEDED; i++) {
      // The first four taps are far off and fall outside the last 20.
      const e = i < 4 ? 120 : 30 + (i % 2 === 0 ? -4 : 4);
      seen.push(at(run, 4 + i, e));
    }
    expect(seen.slice(0, -1).every((o) => o === 'tap')).toBe(true);
    expect(seen[TAPS_NEEDED - 1]).toBe('finished');
    expect(run.state).toBe('done');
    const r = run.result();
    expect(r.kind).toBe('visual');
    expect(r.offsetMs).toBe(30);
    expect(r.sdMs).toBeGreaterThan(3.5);
    expect(r.sdMs).toBeLessThan(4.5);
    expect(r.taps).toBe(20);
    // Nothing counts once it is done.
    expect(at(run, 40, 0)).toBe('ignored');
  });

  it('reset goes back to the start screen', () => {
    const run = new CalibrationRun('audio');
    run.press(0);
    at(run, 4, 10);
    run.reset();
    expect(run.state).toBe('ready');
    expect(run.taps).toBe(0);
    expect(run.result().taps).toBe(0);
    expect(run.press(100)).toBe('started');
  });

  it('closes the ring on every beat', () => {
    const run = new CalibrationRun('visual');
    expect(run.ringProgress(1000)).toBeNull();
    run.press(1000);
    const b = run.firstBeat;
    // The first ring starts one beat before beat 0.
    expect(run.ringProgress(b - BEAT_MS - 1)).toBeNull();
    expect(run.ringProgress(b - BEAT_MS)).toBeCloseTo(0, 9);
    expect(run.ringProgress(b - BEAT_MS / 2)).toBeCloseTo(0.5, 9);
    expect(run.ringProgress(b - 1)).toBeCloseTo(1 - 1 / BEAT_MS, 9);
    expect(run.ringProgress(b)).toBeCloseTo(0, 9);
    expect(run.ringProgress(b + 7 * BEAT_MS - 60)).toBeCloseTo(0.9, 9);
  });

  it('counts the lead-in beats down', () => {
    const run = new CalibrationRun('audio');
    expect(run.leadInBeat(0)).toBe(0);
    run.press(0);
    const b = run.firstBeat;
    expect(run.leadInBeat(b - 100)).toBe(1);
    expect(run.leadInBeat(b + 100)).toBe(2);
    expect(run.leadInBeat(b + 3 * BEAT_MS - 100)).toBe(4);
    expect(run.leadInBeat(b + 3 * BEAT_MS + 100)).toBe(0);
  });
});

type PressLog = string[];
