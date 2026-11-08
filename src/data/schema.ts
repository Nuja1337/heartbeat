// Types of everything Heartbeat stores in IndexedDB and writes to export files.
// Ids and enum orders are permanent. Add new ones, never rename.

import type {
  HitRecord,
  InputInfo,
  JudgmentCounts,
  LaunchRequest,
  LevelStep,
  MilestoneId,
  ModId,
  ModeId,
  ModuleId,
  ModuleOptions,
  PlayStatus,
  SectionFocus,
  SectionRole,
  SkillId,
} from '../shared/types';

export interface Agg {
  n: number;
  mean: number;
  sd: number;
}

export interface TimingStat {
  n: number;
  mean: number;
  sd: number;
  median: number;
}

/** Aim errors are in target radii. */
export interface AimStat {
  n: number;
  alongMean: number;
  alongSd: number;
  lateralMean: number;
  lateralSd: number;
  radialMean: number;
}

/** Per-bucket sums for the Patterns tab and long-term trends. Errors are in radii, timing in ms. */
export interface BucketStat {
  n: number;
  miss: number;
  t: Agg;
  along: Agg;
  lat: Agg;
  rad: Agg;
}

export interface SkillScore {
  /** Map demand in the skill's own unit. */
  raw: number;
  /** Raw demand on the level scale. */
  level: number;
  /** 0..1 */
  performance: number;
  /** level x performance squared. */
  score: number;
  n: number;
}

export interface KindStats {
  circle: {
    n: number;
    accuracy: number;
    misses: number;
    timingMean: number;
    timingSd: number;
    radial: number;
  } | null;
  slider: {
    n: number;
    accuracy: number;
    headTimingSd: number;
    trackedMean: number;
    lagMean: number;
    breaksPer: number;
    endHitRate: number;
  } | null;
  spinner: {
    n: number;
    accuracy: number;
    meanRpm: number;
    peakRpm: number;
    rpmSd: number;
  } | null;
}

export interface PbFlags {
  score?: boolean;
  accuracy?: boolean;
  combo?: boolean;
  level?: boolean;
}

export interface TierEvent {
  skill: SkillId;
  tier: number;
}

/** Per-section results of a play from generator 2. Filled by the analytics builder. */
export interface SectionStat {
  start: number;
  end: number;
  role: SectionRole | null;
  focus: SectionFocus;
  n: number;
  accuracy: number | null;
  misses: number;
}

/** Means over jumps from 2.0 records. Distances in target radii. */
export interface MoveStat {
  n: number;
  /** Mean leaveMs / gapMs. */
  leaveFrac: number | null;
  /** Mean, radii. */
  primaryAlong: number | null;
  /** Mean, radii. */
  correctionPath: number | null;
  /** Share of jumps with corrections >= 1. */
  correctionShare: number | null;
  efficiency: number | null;
}

export interface PlaySummary {
  id: string;
  v: 2;
  deviceId: string;
  createdAt: number;
  modeId: ModeId;
  launch: LaunchRequest;
  status: PlayStatus;
  startedAt: number;
  endedAt: number;
  playedMs: number;
  engineVersion: number;
  generatorVersion: number;
  seed: number;
  mods: ModId[];
  presetLevel: number | null;
  score: number;
  accuracy: number;
  maxCombo: number;
  counts: JudgmentCounts;
  objectCount: number;
  sliderParts: { hit: number; total: number };
  strayPresses: number;
  pauses: number;
  timing: TimingStat;
  aim: AimStat;
  kinds: KindStats;
  halves: { first: number | null; second: number | null };
  quarters: (number | null)[];
  buckets: Record<string, BucketStat>;
  skills: Partial<Record<SkillId, SkillScore>>;
  levels: LevelStep[];
  finalLevels: Partial<Record<ModuleId, number>>;
  input: InputInfo;
  drillId: string | null;
  pb: PbFlags;
  tiers: TierEvent[];
  /** false once retention has removed the per-object detail. */
  hasDetail: boolean;
  /** A hint for lists. getReplay is the truth, and readers accept a true flag with no row. */
  hasReplay: boolean;
  sections: SectionStat[] | null;
  movement: MoveStat | null;
  throughput: { n: number; bitsPerSec: number } | null;
  /** Bests compare plays within one scoring version. 1.0 plays are version 1. */
  scoringVersion: number;
  /** Milestones first reached with this play. */
  milestones: MilestoneId[];
}

/** Replay metadata. The gzip bytes live in the replayBytes store, so lists never load them. */
export interface ReplayRow {
  playId: string;
  v: 1;
  /** The play's, for retention order. */
  startedAt: number;
  /** 0 or 1, because booleans can't be index keys. */
  keep: 0 | 1;
  /** Gzip byte length. */
  size: number;
  rawBytes: number;
  events: number;
  engineVersion: number;
}

export interface ReplayBytesRow {
  playId: string;
  /** gzip(container). A tight array: byteOffset 0 and the whole buffer. */
  bytes: Uint8Array;
}

/** A column table. Every column has `count` entries. */
export type ColumnArray = Float32Array | Uint8Array | Uint16Array | Int16Array;
export interface ColumnTable {
  count: number;
  columns: Record<string, ColumnArray>;
}

export interface PlayDetail {
  playId: string;
  v: 1;
  startedAt: number;
  objects: ColumnTable;
  sliders: ColumnTable;
  spinners: ColumnTable;
}

export interface ProgressRow {
  moduleId: ModuleId;
  level: number;
  bestLevel: number;
  sessions: number;
  updatedAt: number;
}

export type RuleId =
  | 'long-undershoot'
  | 'long-overshoot'
  | 'short-overshoot'
  | 'direction-drift'
  | 'stream-offset'
  | 'stream-fade'
  | 'second-half'
  | 'sharp-wide'
  | 'slider-lag'
  | 'slider-curves'
  | 'early-release'
  | 'timing-bias'
  | 'busy-screen'
  | 'off-center'
  | 'spinners'
  | 'same-module'
  | 'long-session'
  | 'late-leave'
  | 'first-motion'
  | 'corrections';

export type DrillBaseline =
  { kind: 'mean'; mean: number; sd: number; n: number } | { kind: 'rate'; rate: number; n: number } | { kind: 'sd'; sd: number; n: number };

export type DrillOutcome = 'collecting' | 'better' | 'unclear' | 'worse';

export interface DrillEval {
  outcome: DrillOutcome;
  sessions: number;
  sessionsNeeded: number;
  /** Estimated plays outside the drill still needed while collecting. */
  morePlays: number;
  /** The measured value before and after, in the metric's own unit. null while collecting. */
  before: number | null;
  after: number | null;
  nBefore: number;
  nAfter: number;
  nNeeded: number;
  /** Test statistic behind the outcome. */
  stat: number | null;
  evaluatedAt: number;
}

export interface Drill {
  id: string;
  ruleId: RuleId;
  /** Rule detail such as the octant for direction-drift or the group for sharp-wide. */
  variant: string | null;
  modeId: ModeId;
  options: ModuleOptions;
  /** What the drill works on, shown as a title. */
  title: string;
  createdAt: number;
  baseline: DrillBaseline;
  status: 'active' | 'archived';
  /** Set when the drill is locked (30 days after the start, or archived). */
  final: DrillEval | null;
}

export interface Tombstone {
  id: string;
  deletedAt: number;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface TierHistoryEntry {
  tier: number;
  at: number;
}
export type TierHistory = Partial<Record<SkillId, TierHistoryEntry[]>>;

export interface PersistStatus {
  requested: boolean;
  granted: boolean | null;
  at: number;
}

/** UI choices remembered between visits. */
export interface UiPrefs {
  fullscreen: boolean;
  dynamic: {
    presetLevel: number | null;
    difficulty: LaunchRequest['difficulty'] | null;
    mods: ModId[];
    lengthSec: number | null;
  };
  modules: Partial<
    Record<
      string,
      {
        options: ModuleOptions;
        mods: ModId[];
        lengthSec: number;
      }
    >
  >;
  /** The Daily page: the level the player chose, null for the default. */
  daily: { level: number | null };
  playback: { speed: number };
  installDismissed: boolean;
}

/** Milestones reached so far. The earliest `at` wins when sources merge. */
export type MilestoneRecord = { at: number; playId: string | null };
export type Milestones = Partial<Record<MilestoneId, MilestoneRecord>>;

export interface Onboarding {
  done: boolean;
  at: number | null;
  input: boolean;
  calibrated: boolean;
  placed: boolean;
}

export interface PlanStep {
  step: number;
  kind: 'warmup' | 'drill' | 'dynamic';
  title: string;
  launch: LaunchRequest;
  insightKey: string | null;
}

/** One day's training plan, stored under the meta key `plan:YYYY-MM-DD`. */
export interface DailyPlan {
  date: string;
  createdAt: number;
  steps: PlanStep[];
}

/** Insight key to "hidden until", in epoch ms. */
export type InsightSnooze = Record<string, number>;

/** A play with its per-object records, for analysis. */
export interface PlayData {
  summary: PlaySummary;
  records: HitRecord[];
}

export const SUMMARY_VERSION = 2;
export const DETAIL_VERSION = 1;
