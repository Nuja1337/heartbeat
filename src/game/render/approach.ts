// The geometry behind the approach indicators, follow points and the reversal pulse (PLAN-2 5.4). Pure.

import type { ApproachStyle, HitObject, Ms } from '../../shared/types';
import { endPosition } from '../map/features';
import { clamp01, FX } from './theme';

/* -------------------------------------------------------- approach styles */

export interface ApproachShape {
  /** ring: the ring radius. fill: the disc radius. brackets: half the side of the square. */
  size: number;
  /** Rotation of the bracket square, radians. 0 for the other styles. */
  rot: number;
  /** Stroke or fill alpha multiplier, 0..1. */
  alpha: number;
}

/** Where the approach starts and ends, as multiples of the target radius. */
export const APPROACH = { ringFrom: 2.4, ringTo: 1, bracketFrom: 2.4, bracketTo: 1.05, bracketArm: 0.55 } as const;

/**
 * The indicator for a target of radius `r` at approach progress `u` (0 when the target appears, 1 at its time).
 * `ring` closes from 2.4r to r, `fill` grows a disc from nothing to r, and `brackets` closes a square from 2.4r
 * to 1.05r while it turns from 45 degrees to 0.
 */
export function approachShape(style: ApproachStyle, u: number, r: number, out: ApproachShape): ApproachShape {
  const c = clamp01(u);
  const fadeIn = Math.min(0.9, (Math.max(0, u) / 0.3) * 0.9);
  if (style === 'fill') {
    out.size = r * c;
    out.rot = 0;
    out.alpha = 1;
  } else if (style === 'brackets') {
    out.size = r * (APPROACH.bracketFrom + (APPROACH.bracketTo - APPROACH.bracketFrom) * c);
    out.rot = (Math.PI / 4) * (1 - c);
    out.alpha = fadeIn;
  } else {
    out.size = r * (APPROACH.ringFrom + (APPROACH.ringTo - APPROACH.ringFrom) * c);
    out.rot = 0;
    out.alpha = fadeIn;
  }
  return out;
}

/* ----------------------------------------------------------- follow points */

export const FOLLOW = { dash: 6, gap: 10, revealFrom: 0.2, revealTo: 0.6, minGapMs: 160 } as const;

/** How much of a follow point is shown, 0..1, from the approach progress of the later object. */
export function followReveal(u: number): number {
  return clamp01((u - FOLLOW.revealFrom) / (FOLLOW.revealTo - FOLLOW.revealFrom));
}

/**
 * Alpha of a follow point. `sinceJudgedMs` is how long ago the earlier object was judged, negative or NaN while it
 * is still open. It fades out over 150 ms.
 */
export function followAlpha(sinceJudgedMs: number): number {
  if (!(sinceJudgedMs > 0)) return 1;
  return clamp01(1 - sinceJudgedMs / FX.followFade);
}

/** False for two notes of a stream that follow each other closer than 160 ms. */
export function followWanted(a: HitObject, b: HitObject): boolean {
  if (a.kind === 'spinner' || b.kind === 'spinner' || b.index !== a.index + 1) return false;
  const aEnd: Ms = a.kind === 'circle' ? a.time : a.endTime;
  return b.time - aEnd >= FOLLOW.minGapMs;
}

export interface FollowSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Length of the whole edge to edge segment. */
  length: number;
}

/**
 * The segment from the edge of `a` (its end, for a slider) to the edge of `b`, shortened to the `reveal` fraction
 * of its length, so it grows from the earlier object toward the later one. Returns false when the two overlap.
 */
export function followSegment(a: HitObject, b: HitObject, reveal: number, out: FollowSegment): boolean {
  const ea = endPosition(a);
  const dx = b.pos.x - ea.x;
  const dy = b.pos.y - ea.y;
  const dist = Math.hypot(dx, dy);
  const length = dist - a.radius - b.radius;
  if (length < 4) return false;
  const ux = dx / dist;
  const uy = dy / dist;
  out.x0 = ea.x + ux * a.radius;
  out.y0 = ea.y + uy * a.radius;
  out.x1 = out.x0 + ux * length * clamp01(reveal);
  out.y1 = out.y0 + uy * length * clamp01(reveal);
  out.length = length;
  return true;
}

/* ------------------------------------------------------------ reversal pulse */

/** Time between pulses of a reversal marker when the map has no beat grid. */
export const PULSE_FALLBACK_MS = 400;

/**
 * Strength 0..1 of the reversal marker's pulse at time t: full on the beat, gone a third of a beat later.
 * Without `offsetMs` it pulses every 400 ms instead.
 */
export function reversePulse(t: number, beatMs: number, offsetMs: number | undefined): number {
  const period = offsetMs === undefined || !(beatMs > 0) ? PULSE_FALLBACK_MS : beatMs;
  const base = offsetMs === undefined ? 0 : offsetMs;
  let phase = ((t - base) % period) / period;
  if (phase < 0) phase += 1;
  const k = 1 - phase * 3;
  return k > 0 ? k * k : 0;
}
