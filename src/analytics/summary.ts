// summarizePlay turns a PlayResult into the PlaySummary that is stored for every play.
// Aim errors are kept in target radii. Records after a pause are left out of every statistic here.

import type { PlaySummary, SkillScore } from '../data/schema';
import { SUMMARY_VERSION } from '../data/schema';
import { JUDGMENTS, SCORING_VERSION } from '../shared/catalog';
import type { HitRecord, ModId, PlayResult, SkillId } from '../shared/types';
import { computeBuckets, isJump, isStreamNote, isTap, tapJudgment, tapMissed } from './buckets';
import { itemsFromRecords, mapDemand, SKILL_ORDER } from './demand';
import { aggOf, mean, median, sd } from './stats';

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const finite = (xs: (number | null)[]): number[] => xs.filter((x): x is number => x !== null && Number.isFinite(x));
const weight = (r: HitRecord): number => JUDGMENTS[r.judgment].weight;

/** Performance 0..1 for one skill, or null when the skill has no objects in these records. */
export function skillPerformance(skill: SkillId, records: readonly HitRecord[]): number | null {
  switch (skill) {
    case 'aim': {
      const jumps = records.filter(isJump);
      if (jumps.length === 0) return null;
      const hitRate = jumps.filter((r) => !tapMissed(r)).length / jumps.length;
      const radial = jumps.map((r) => (r.aimRadial === null || tapMissed(r) ? 1 : Math.min(1, r.aimRadial / r.radius)));
      return hitRate * (1 - 0.5 * mean(radial));
    }
    case 'speed': {
      const notes = records.filter(isStreamNote);
      return notes.length === 0 ? null : mean(notes.map((r) => JUDGMENTS[tapJudgment(r)].weight));
    }
    case 'tracking': {
      const sliders = records.filter((r) => r.slider !== null);
      if (sliders.length === 0) return null;
      return mean(sliders.map((r) => r.slider!.trackedFraction * (r.headJudgment === 'miss' ? 0.5 : 1)));
    }
    case 'precision': {
      const taps = records.filter(isTap);
      if (taps.length === 0) return null;
      return mean(
        taps.map((r) => {
          if (tapMissed(r) || r.aimRadial === null) return 0;
          const rr = r.aimRadial / r.radius;
          return Math.max(0, 1 - rr * rr);
        }),
      );
    }
    case 'timing': {
      const taps = records.filter(isTap);
      return taps.length === 0 ? null : taps.filter((r) => tapJudgment(r) === 'crisp').length / taps.length;
    }
    case 'reading': {
      const taps = records.filter(isTap);
      return taps.length === 0 ? null : taps.filter((r) => !tapMissed(r)).length / taps.length;
    }
    case 'spin': {
      const spinners = records.filter((r) => r.spinner !== null);
      if (spinners.length === 0) return null;
      return mean(spinners.map((r) => Math.min(1, r.spinner!.rotations / Math.max(0.01, r.spinner!.rotationsRequired))));
    }
  }
}

/** Per-skill scores of a play: level (map demand) times performance squared. */
export function scoreSkills(records: readonly HitRecord[], mods: readonly ModId[]): Partial<Record<SkillId, SkillScore>> {
  const usable = records.filter((r) => !r.afterPause);
  const demand = mapDemand(itemsFromRecords(usable), mods);
  const out: Partial<Record<SkillId, SkillScore>> = {};
  for (const skill of SKILL_ORDER) {
    const d = demand[skill];
    if (!d) continue;
    const p = skillPerformance(skill, usable);
    if (p === null) continue;
    out[skill] = {
      raw: round3(d.raw),
      level: round3(d.level),
      performance: round3(p),
      score: round3(d.level * p * p),
      n: d.n,
    };
  }
  return out;
}

function kindStats(records: HitRecord[]): PlaySummary['kinds'] {
  const circles = records.filter((r) => r.kind === 'circle');
  const sliders = records.filter((r) => r.kind === 'slider');
  const spinners = records.filter((r) => r.kind === 'spinner');
  const timing = (rs: HitRecord[]) => finite(rs.map((r) => r.timingError));
  return {
    circle: circles.length
      ? {
          n: circles.length,
          accuracy: round3(mean(circles.map(weight))),
          misses: circles.filter((r) => r.judgment === 'miss').length,
          timingMean: round3(mean(timing(circles))),
          timingSd: round3(sd(timing(circles))),
          radial: round3(mean(finite(circles.map((r) => (r.aimRadial === null ? null : r.aimRadial / r.radius))))),
        }
      : null,
    slider: sliders.length
      ? {
          n: sliders.length,
          accuracy: round3(mean(sliders.map(weight))),
          headTimingSd: round3(sd(timing(sliders))),
          trackedMean: round3(mean(sliders.map((r) => r.slider!.trackedFraction))),
          lagMean: round3(mean(sliders.map((r) => r.slider!.meanLag / r.radius))),
          breaksPer: round3(mean(sliders.map((r) => r.slider!.breaks))),
          endHitRate: round3(mean(sliders.map((r) => (r.slider!.endHit ? 1 : 0)))),
        }
      : null,
    spinner: spinners.length
      ? {
          n: spinners.length,
          accuracy: round3(mean(spinners.map(weight))),
          meanRpm: round3(mean(spinners.map((r) => r.spinner!.meanRpm))),
          peakRpm: round3(Math.max(...spinners.map((r) => r.spinner!.peakRpm))),
          rpmSd: round3(mean(spinners.map((r) => r.spinner!.rpmSd))),
        }
      : null,
  };
}

/** Accuracy over consecutive slices of the records, by play order. */
function slices(records: HitRecord[], parts: number): (number | null)[] {
  const out: (number | null)[] = [];
  if (records.length < parts * 2) return new Array<number | null>(parts).fill(null);
  for (let p = 0; p < parts; p++) {
    const from = Math.floor((records.length * p) / parts);
    const to = Math.floor((records.length * (p + 1)) / parts);
    out.push(round3(mean(records.slice(from, to).map(weight))));
  }
  return out;
}

export interface SummaryContext {
  id?: string;
  deviceId?: string;
  now?: number;
}

export function summarizePlay(result: PlayResult, ctx: SummaryContext = {}): PlaySummary {
  const all = result.records;
  const usable = all.filter((r) => !r.afterPause);
  const pressed = finite(usable.map((r) => r.timingError));
  const along = finite(usable.map((r) => (r.aimAlong === null ? null : r.aimAlong / r.radius)));
  const lateral = finite(usable.map((r) => (r.aimLateral === null ? null : r.aimLateral / r.radius)));
  const radial = finite(usable.map((r) => (r.aimRadial === null ? null : r.aimRadial / r.radius)));
  // Halves and quarters follow the taps that count: no spinners, nothing after a pause.
  const tapsOnly = usable.filter(isTap);
  const halves = slices(tapsOnly, 2);
  const counts = result.counts;
  return {
    id: ctx.id ?? crypto.randomUUID(),
    v: SUMMARY_VERSION,
    deviceId: ctx.deviceId ?? '',
    createdAt: ctx.now ?? Date.now(),
    modeId: result.launch.modeId,
    launch: result.launch,
    status: result.status,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    playedMs: result.playedMs,
    engineVersion: result.engineVersion,
    generatorVersion: result.map.generatorVersion,
    seed: result.map.seed,
    mods: result.map.mods,
    presetLevel: result.launch.presetLevel,
    score: result.score,
    accuracy: result.accuracy,
    maxCombo: result.maxCombo,
    counts,
    objectCount: counts.crisp + counts.solid + counts.rough + counts.miss,
    sliderParts: result.sliderParts,
    strayPresses: result.strayPresses,
    pauses: result.pauses,
    timing: { n: pressed.length, mean: round3(mean(pressed)), sd: round3(sd(pressed)), median: round3(median(pressed)) },
    aim: {
      n: along.length,
      alongMean: round3(mean(along)),
      alongSd: round3(sd(along)),
      lateralMean: round3(mean(lateral)),
      lateralSd: round3(sd(lateral)),
      radialMean: round3(mean(radial)),
    },
    kinds: kindStats(usable),
    halves: { first: halves[0] ?? null, second: halves[1] ?? null },
    quarters: slices(tapsOnly, 4),
    buckets: computeBuckets(usable),
    skills: scoreSkills(usable, result.map.mods),
    levels: result.levels,
    finalLevels: result.finalLevels,
    input: result.input,
    drillId: result.launch.drillId,
    pb: {},
    tiers: [],
    hasDetail: all.length > 0,
    // Placeholders. The analytics builder fills the real values.
    hasReplay: false,
    sections: null,
    movement: null,
    throughput: null,
    scoringVersion: SCORING_VERSION,
    milestones: [],
  };
}

/** Timing aggregate of a set of records, presses only. */
export function timingAgg(records: readonly HitRecord[]) {
  return aggOf(finite(records.map((r) => r.timingError)));
}
