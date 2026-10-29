import { describe, expect, it } from 'vitest';
import { makeSpinner } from '../testing/fixtures';
import { SpinnerRun, spinnerJudgment } from './spinner';

/** Feed a circle at `rpm` around the center, one sample per ms. */
function spin(run: SpinnerRun, from: number, to: number, rpm: number, radius = 100, held = true) {
  const w = (rpm / 60) * Math.PI * 2;
  for (let t = from; t <= to; t++) {
    const a = (w * (t - from)) / 1000;
    run.update(t, 500 + radius * Math.cos(a), 312.5 + radius * Math.sin(a), held);
  }
}

describe('spinner', () => {
  it('counts 10 turns for 300 rpm over 2 s', () => {
    const o = makeSpinner(0, 1000, 2000, 8);
    const run = new SpinnerRun(o);
    spin(run, 1000, 3000, 300);
    expect(run.rotations).toBeGreaterThan(9.95);
    expect(run.rotations).toBeLessThan(10.05);
  });

  it('counts the same for the other direction', () => {
    const o = makeSpinner(0, 1000, 2000, 8);
    const run = new SpinnerRun(o);
    spin(run, 1000, 3000, -300);
    expect(run.rotations).toBeGreaterThan(9.95);
  });

  it('earns nothing from a wiggle', () => {
    const o = makeSpinner(0, 0, 2000, 4);
    const run = new SpinnerRun(o);
    for (let t = 0; t <= 2000; t++) {
      const a = 0.6 * Math.sin(t / 30);
      run.update(t, 500 + 100 * Math.cos(a), 312.5 + 100 * Math.sin(a), true);
    }
    expect(run.rotations).toBeLessThan(0.15);
  });

  it('ignores the dead zone around the center', () => {
    const o = makeSpinner(0, 0, 2000, 4);
    const run = new SpinnerRun(o);
    spin(run, 0, 2000, 300, 8);
    expect(run.rotations).toBe(0);
  });

  it('caps the speed at 600 rpm', () => {
    const o = makeSpinner(0, 0, 1000, 4);
    const run = new SpinnerRun(o);
    spin(run, 0, 1000, 900);
    expect(run.rotations).toBeGreaterThan(9.8);
    expect(run.rotations).toBeLessThan(10.2);
  });

  it('only turns while held', () => {
    const o = makeSpinner(0, 0, 2000, 4);
    const run = new SpinnerRun(o);
    spin(run, 0, 2000, 300, 100, false);
    expect(run.rotations).toBe(0);
  });

  it('judges by the share of the goal', () => {
    expect(spinnerJudgment(1)).toBe('crisp');
    expect(spinnerJudgment(0.75)).toBe('solid');
    expect(spinnerJudgment(0.5)).toBe('rough');
    expect(spinnerJudgment(0.49)).toBe('miss');
  });

  it('reports rpm and bonus turns', () => {
    const o = makeSpinner(0, 0, 3000, 5);
    const run = new SpinnerRun(o);
    spin(run, 0, 3000, 300);
    const s = run.stats();
    expect(s.meanRpm).toBeGreaterThan(290);
    expect(s.meanRpm).toBeLessThan(310);
    expect(s.peakRpm).toBeGreaterThan(290);
    expect(s.rpmSd).toBeLessThan(15);
    expect(run.bonus).toBeGreaterThanOrEqual(9);
    expect(run.completed).toBe(true);
    expect(run.rpmAt(2900)).toBeGreaterThan(280);
    expect(run.judgment().judgment).toBe('crisp');
  });
});
