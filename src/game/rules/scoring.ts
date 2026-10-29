// Points, combo, accuracy and health (PLAN section 5).

import { JUDGMENTS, modMultiplier } from '../../shared/catalog';
import type { HealthRules, Judgment, JudgmentCounts, ModId } from '../../shared/types';

export const COMBO_CAP = 50;
/** The combo-break effect plays only for combos at least this long. */
export const BREAK_EFFECT_MIN = 10;

export function comboFactor(combo: number): number {
  return 1 + Math.min(combo, COMBO_CAP) / 100;
}

export function aimFactor(radial: number, radius: number): number {
  const q = radial / radius;
  return Math.max(0, 1 - q * q);
}

/** Points for a circle or a slider head. */
export function headPoints(j: Judgment, radial: number, radius: number, comboBefore: number): number {
  return Math.round(100 * JUDGMENTS[j].weight * (0.8 + 0.2 * aimFactor(radial, radius)) * comboFactor(comboBefore));
}

export const HEALTH_GAIN: Record<Judgment, number> = { crisp: 0.025, solid: 0.015, rough: 0.005, miss: 0 };
export const HEALTH_PART_GAIN = 0.01;
export const HEALTH_SPIN_GAIN = 0.01;

/** Health rules for a Dynamic map. */
export function healthRulesFor(density: number, mods: readonly ModId[]): HealthRules {
  const scale = 0.6 + 0.08 * density;
  return {
    drainPerSec: 0.02 * scale,
    missPenalty: 0.08 * scale,
    partPenalty: 0.03 * scale,
    canFail: !mods.includes('nofail'),
    failOnFirstMiss: mods.includes('onelife'),
  };
}

export interface ScoreChange {
  points: number;
  /** Combo length lost when this change broke the combo. 0 when it did not. */
  broke: number;
}

export class Scoring {
  raw = 0;
  combo = 0;
  maxCombo = 0;
  health = 1;
  failed = false;
  counts: JudgmentCounts = { crisp: 0, solid: 0, rough: 0, miss: 0 };
  judged = 0;
  weightSum = 0;
  partsHit = 0;
  partsTotal = 0;

  constructor(readonly rules: HealthRules | null) {}

  get accuracy(): number {
    return this.judged > 0 ? this.weightSum / this.judged : 1;
  }

  total(mods: readonly ModId[]): number {
    return Math.round(this.raw * modMultiplier(mods));
  }

  private gain(amount: number): void {
    if (this.rules) this.health = Math.min(1, this.health + amount);
  }

  private lose(amount: number, isMiss: boolean): void {
    const r = this.rules;
    if (!r) return;
    this.health = Math.max(0, this.health - amount);
    if (r.failOnFirstMiss && isMiss) this.failed = true;
    if (r.canFail && this.health <= 0) this.failed = true;
  }

  private bump(): void {
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
  }

  private breakCombo(): number {
    const lost = this.combo;
    this.combo = 0;
    return lost;
  }

  /** A circle, or a slider head. radial is the distance from the press to the center. */
  head(j: Judgment, radial: number, radius: number): ScoreChange {
    if (j === 'miss') {
      this.lose(this.rules?.missPenalty ?? 0, true);
      return { points: 0, broke: this.breakCombo() };
    }
    const points = headPoints(j, radial, radius, this.combo);
    this.raw += points;
    this.gain(HEALTH_GAIN[j]);
    this.bump();
    return { points, broke: 0 };
  }

  /** A slider tick, repeat or end that was checked. */
  part(kind: 'tick' | 'repeat' | 'end', hit: boolean): ScoreChange {
    this.partsTotal++;
    if (!hit) {
      this.lose(this.rules?.partPenalty ?? 0, true);
      return { points: 0, broke: this.breakCombo() };
    }
    this.partsHit++;
    const points = Math.round((kind === 'end' ? 30 : 10) * comboFactor(this.combo));
    this.raw += points;
    this.gain(HEALTH_PART_GAIN);
    this.bump();
    return { points, broke: 0 };
  }

  /** Bonus for a slider that ends Crisp. */
  sliderBonus(): number {
    const points = Math.round(50 * comboFactor(this.combo));
    this.raw += points;
    return points;
  }

  /** A spinner ended. bonus is the whole rotations beyond the goal. */
  spinner(j: Judgment, bonus: number): ScoreChange {
    if (j === 'miss') {
      this.lose(this.rules?.missPenalty ?? 0, true);
      return { points: 0, broke: this.breakCombo() };
    }
    const points = Math.round(100 * JUDGMENTS[j].weight * comboFactor(this.combo)) + 25 * bonus;
    this.raw += points;
    this.bump();
    return { points, broke: 0 };
  }

  spinRotationGain(): void {
    this.gain(HEALTH_SPIN_GAIN);
  }

  /** Count a final judgment toward accuracy and the counts. */
  finalize(j: Judgment): void {
    this.counts[j]++;
    this.judged++;
    this.weightSum += JUDGMENTS[j].weight;
  }

  drain(seconds: number): void {
    const r = this.rules;
    if (!r || seconds <= 0) return;
    this.lose(r.drainPerSec * seconds, false);
  }
}
