// Markers on the replay scrubber and in the miss list. Pure: they come from stored records, or from the
// replay's own judgment string when the per-object detail was removed.

import type { HitRecord, MissReason, ObjectKind } from '../../shared/types';

/** A watch link and the miss list start this far before the object, so the approach is on screen. */
export const SEEK_LEAD_MS = 1500;
/** The step for the comma and period keys, about one frame at 60 Hz. */
export const FRAME_STEP_MS = 16;
/** The step for the arrow keys. */
export const SEEK_STEP_MS = 2000;

export interface ReplayMarker {
  index: number;
  /** Where the marker sits on the scrubber, ms into the play. */
  time: number;
  /** A miss, or a slider that was hit but not tracked to the end. */
  kind: 'miss' | 'break';
  objectKind: ObjectKind;
  reason: MissReason | null;
}

export interface MarkerObject {
  kind: ObjectKind;
  time: number;
  endTime?: number;
}

/** Where a watch link or the M key starts for an object at `time`. */
export const seekTarget = (time: number): number => Math.max(0, Math.round(time - SEEK_LEAD_MS));

export const replayLink = (id: string, time: number): string => `/replay/${id}?t=${seekTarget(time)}`;

const byTime = (a: ReplayMarker, b: ReplayMarker): number => a.time - b.time || a.index - b.index;

export function markersFromRecords(records: readonly HitRecord[]): ReplayMarker[] {
  const out: ReplayMarker[] = [];
  for (const r of records) {
    if (r.judgment === 'miss') {
      out.push({ index: r.index, time: r.time, kind: 'miss', objectKind: r.kind, reason: r.missReason });
    } else if (r.slider && r.slider.breaks > 0) {
      // The first loss is a share of the whole slider, so the marker lands where tracking was lost.
      const at = r.time + (r.slider.firstLossAt ?? 0) * Math.max(0, r.endTime - r.time);
      out.push({ index: r.index, time: at, kind: 'break', objectKind: r.kind, reason: null });
    }
  }
  return out.sort(byTime);
}

/** `judgments` has one letter per object: c, s, r, m, or - when it was not judged. */
export function markersFromJudgments(judgments: string, objects: readonly MarkerObject[]): ReplayMarker[] {
  const out: ReplayMarker[] = [];
  for (let i = 0; i < objects.length && i < judgments.length; i++) {
    const o = objects[i]!;
    const j = judgments[i];
    if (j === 'm') out.push({ index: i, time: o.time, kind: 'miss', objectKind: o.kind, reason: null });
    else if (j === 'r' && o.kind === 'slider') out.push({ index: i, time: o.time, kind: 'break', objectKind: o.kind, reason: null });
  }
  return out.sort(byTime);
}

/** From the records when they are there, otherwise from the judgment string. */
export function replayMarkers(
  records: readonly HitRecord[] | null,
  replay: { judgments: string; map: { objects: readonly MarkerObject[] } },
): ReplayMarker[] {
  return records && records.length > 0 ? markersFromRecords(records) : markersFromJudgments(replay.judgments, replay.map.objects);
}

/** Where the M key goes from time `now`: the first miss whose start is ahead by more than `slackMs`. Null at the last miss. */
export function nextMissTarget(markers: readonly ReplayMarker[], now: number, slackMs = 50): number | null {
  for (const m of markers) {
    if (m.kind !== 'miss') continue;
    const target = seekTarget(m.time);
    if (target > now + slackMs) return target;
  }
  return null;
}

/** Keeps a time inside the play. */
export const clampTime = (t: number, durationMs: number): number => Math.min(Math.max(0, durationMs), Math.max(0, t));
