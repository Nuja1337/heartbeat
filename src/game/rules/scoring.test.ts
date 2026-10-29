import { describe, expect, it } from 'vitest';
import { modConflicts, modMultiplier } from '../../shared/catalog';
import { aimFactor, comboFactor, headPoints, healthRulesFor, Scoring } from './scoring';

describe('points', () => {
  it('gives 100 for a Crisp at the center with no combo', () => {
    expect(headPoints('crisp', 0, 50, 0)).toBe(100);
  });

  it('lowers points for a hit away from the center', () => {
    expect(aimFactor(25, 50)).toBeCloseTo(0.75, 9);
    expect(headPoints('crisp', 25, 50, 0)).toBe(95);
    expect(headPoints('crisp', 50, 50, 0)).toBe(80);
  });

  it('scales with judgment weight and combo', () => {
    expect(headPoints('solid', 0, 50, 0)).toBe(65);
    expect(headPoints('rough', 0, 50, 0)).toBe(30);
    expect(comboFactor(50)).toBeCloseTo(1.5, 9);
    expect(comboFactor(500)).toBeCloseTo(1.5, 9);
    expect(headPoints('crisp', 0, 50, 50)).toBe(150);
  });
});

describe('Scoring', () => {
  it('builds and breaks the combo', () => {
    const s = new Scoring(null);
    for (let i = 0; i < 12; i++) s.head('crisp', 0, 50);
    expect(s.combo).toBe(12);
    const r = s.head('miss', 0, 50);
    expect(r.broke).toBe(12);
    expect(s.combo).toBe(0);
    expect(s.maxCombo).toBe(12);
  });

  it('scores slider parts and breaks on a missed part', () => {
    const s = new Scoring(null);
    s.head('crisp', 0, 50);
    expect(s.part('tick', true).points).toBe(Math.round(10 * 1.01));
    expect(s.part('end', true).points).toBe(Math.round(30 * 1.02));
    expect(s.part('tick', false).broke).toBe(3);
    expect(s.combo).toBe(0);
    expect(s.partsHit).toBe(2);
    expect(s.partsTotal).toBe(3);
  });

  it('computes accuracy from final judgments', () => {
    const s = new Scoring(null);
    s.finalize('crisp');
    s.finalize('solid');
    s.finalize('rough');
    s.finalize('miss');
    expect(s.accuracy).toBeCloseTo((1 + 0.65 + 0.3) / 4, 9);
    expect(s.counts).toEqual({ crisp: 1, solid: 1, rough: 1, miss: 1 });
  });

  it('applies the mod multiplier to the total', () => {
    const s = new Scoring(null);
    s.head('crisp', 0, 50);
    expect(s.total(['fade', 'spotlight'])).toBe(Math.round(100 * 1.05 * 1.1));
    expect(s.total([])).toBe(100);
  });

  it('adds spinner points and bonus turns', () => {
    const s = new Scoring(null);
    const r = s.spinner('crisp', 3);
    expect(r.points).toBe(100 + 75);
  });

  it('adds the Crisp slider bonus', () => {
    const s = new Scoring(null);
    expect(s.sliderBonus()).toBe(50);
  });
});

describe('health', () => {
  it('scales penalties with density', () => {
    const r = healthRulesFor(5, []);
    const scale = 0.6 + 0.08 * 5;
    expect(r.missPenalty).toBeCloseTo(0.08 * scale, 9);
    expect(r.partPenalty).toBeCloseTo(0.03 * scale, 9);
    expect(r.drainPerSec).toBeCloseTo(0.02 * scale, 9);
    expect(r.canFail).toBe(true);
  });

  it('gains on hits and caps at 1', () => {
    const s = new Scoring(healthRulesFor(5, []));
    s.health = 0.5;
    s.head('crisp', 0, 50);
    expect(s.health).toBeCloseTo(0.525, 9);
    s.health = 0.99;
    s.head('crisp', 0, 50);
    expect(s.health).toBe(1);
  });

  it('drains and fails at zero', () => {
    const s = new Scoring(healthRulesFor(5, []));
    s.drain(10);
    expect(s.health).toBeLessThan(1);
    expect(s.failed).toBe(false);
    for (let i = 0; i < 20; i++) s.head('miss', 0, 50);
    expect(s.health).toBe(0);
    expect(s.failed).toBe(true);
  });

  it('does not fail with No Fail', () => {
    const s = new Scoring(healthRulesFor(5, ['nofail']));
    for (let i = 0; i < 20; i++) s.head('miss', 0, 50);
    expect(s.health).toBe(0);
    expect(s.failed).toBe(false);
  });

  it('fails on the first miss with One Life', () => {
    const s = new Scoring(healthRulesFor(5, ['onelife']));
    s.head('crisp', 0, 50);
    expect(s.failed).toBe(false);
    s.head('miss', 0, 50);
    expect(s.failed).toBe(true);
  });

  it('has no health without rules', () => {
    const s = new Scoring(null);
    s.head('miss', 0, 50);
    s.drain(100);
    expect(s.failed).toBe(false);
  });
});

describe('mods catalog', () => {
  it('multiplies and finds conflicts', () => {
    expect(modMultiplier(['fast', 'tight'])).toBeCloseTo(1.15 * 1.1, 9);
    expect(modConflicts(['fast', 'slow'])).toEqual([['fast', 'slow']]);
    expect(modConflicts(['fast', 'tight'])).toEqual([]);
  });
});
