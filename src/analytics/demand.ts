// How demanding a set of objects is, per skill. Map demand is the 75th percentile of the
// per-object demand over the objects that skill applies to.

import {
  aimDemand,
  levelForDemand,
  precisionDemand,
  readingDemand,
  speedDemand,
  spinDemand,
  timingDemand,
  trackingDemand,
} from '../shared/catalog';
import type { HitObject, ModId, ObjectFeatures, ObjectKind, PlayableMap, SkillId } from '../shared/types';
import { quantile } from './stats';

/** Fewest objects a play needs before it gets a score for the skill. */
export const MIN_N: Record<SkillId, number> = { aim: 15, speed: 20, tracking: 5, precision: 30, timing: 30, reading: 30, spin: 2 };

export const SKILL_ORDER: SkillId[] = ['aim', 'speed', 'tracking', 'precision', 'timing', 'reading', 'spin'];

/** The fields demand needs. HitRecord and map objects both convert to this. */
export interface DemandItem {
  kind: ObjectKind;
  features: ObjectFeatures;
  radius: number;
  approachMs: number;
  crispMs: number;
  sliderVelocity: number | null;
  followRadius: number | null;
  rotationsRequired: number | null;
  durationMs: number | null;
}

interface RecordLike {
  kind: ObjectKind;
  features: ObjectFeatures;
  radius: number;
  approachMs: number;
  crispMs: number;
  slider: { velocity: number; followRadius: number } | null;
  spinner: { rotationsRequired: number; durationMs: number } | null;
}

export function itemsFromRecords(records: readonly RecordLike[]): DemandItem[] {
  return records.map((r) => ({
    kind: r.kind,
    features: r.features,
    radius: r.radius,
    approachMs: r.approachMs,
    crispMs: r.crispMs,
    sliderVelocity: r.slider?.velocity ?? null,
    followRadius: r.slider?.followRadius ?? null,
    rotationsRequired: r.spinner?.rotationsRequired ?? null,
    durationMs: r.spinner?.durationMs ?? null,
  }));
}

export function itemsFromMap(map: PlayableMap, features: readonly ObjectFeatures[]): DemandItem[] {
  return map.objects.map((o: HitObject, i) => ({
    kind: o.kind,
    features: features[i]!,
    radius: o.radius,
    approachMs: o.approachMs,
    crispMs: o.windows.crisp,
    sliderVelocity: o.kind === 'slider' ? o.velocity : null,
    followRadius: o.kind === 'slider' ? o.followRadius : null,
    rotationsRequired: o.kind === 'spinner' ? o.rotationsRequired : null,
    durationMs: o.kind === 'spinner' ? o.endTime - o.time : null,
  }));
}

const isTapItem = (i: DemandItem) => i.kind !== 'spinner';
function isStreamItem(i: DemandItem): boolean {
  return isTapItem(i) && i.features.runLength >= 3 && i.features.spacing !== null && i.features.spacing < 1.6;
}
function isJumpItem(i: DemandItem): boolean {
  const f = i.features;
  return isTapItem(i) && !isStreamItem(i) && f.distance !== null && f.gapMs !== null && f.gapMs < 700;
}

/** Demand of one object for one skill, or null when the skill doesn't apply to it. */
export function itemDemand(item: DemandItem, skill: SkillId, mods: readonly ModId[]): number | null {
  const f = item.features;
  switch (skill) {
    case 'aim':
      return isJumpItem(item) ? aimDemand(f.distance!, f.gapMs!, item.radius) : null;
    case 'speed':
      return isStreamItem(item) && f.gapMs !== null ? speedDemand(f.gapMs) : null;
    case 'tracking':
      return item.kind === 'slider' && item.sliderVelocity !== null && item.followRadius
        ? trackingDemand(item.sliderVelocity, item.followRadius)
        : null;
    case 'precision':
      return isTapItem(item) ? precisionDemand(item.radius) : null;
    case 'timing':
      return isTapItem(item) && item.crispMs > 0 ? timingDemand(item.crispMs) : null;
    case 'reading':
      return isTapItem(item) && item.approachMs > 0 ? readingDemand(item.approachMs, mods) : null;
    case 'spin':
      return item.kind === 'spinner' && item.rotationsRequired !== null && item.durationMs
        ? spinDemand(item.rotationsRequired, item.durationMs)
        : null;
  }
}

export interface SkillDemand {
  raw: number;
  level: number;
  n: number;
}

/** Map demand per skill. A skill is left out when fewer than `minN` objects apply. */
export function mapDemand(
  items: readonly DemandItem[],
  mods: readonly ModId[],
  minN: Record<SkillId, number> = MIN_N,
): Partial<Record<SkillId, SkillDemand>> {
  const out: Partial<Record<SkillId, SkillDemand>> = {};
  for (const skill of SKILL_ORDER) {
    const values: number[] = [];
    for (const item of items) {
      const d = itemDemand(item, skill, mods);
      if (d !== null && Number.isFinite(d)) values.push(d);
    }
    if (values.length < minN[skill] || values.length === 0) continue;
    const raw = quantile(values, 0.75);
    out[skill] = { raw, level: levelForDemand(skill, raw), n: values.length };
  }
  return out;
}

/** Skills the preview can show for a short map. */
export const PREVIEW_MIN_N: Record<SkillId, number> = { aim: 3, speed: 3, tracking: 1, precision: 3, timing: 3, reading: 3, spin: 1 };
