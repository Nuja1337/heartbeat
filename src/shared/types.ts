// Shared contract for Heartbeat. The game (src/game) and the app (src/app, src/data, src/analytics)
// both code against this file and never edit it. Changes go through the main session.
//
// Units: positions and lengths are playfield units (PLAYFIELD in catalog.ts: 1000 x 625, origin top-left,
// y grows downward). Times are milliseconds. Angles are degrees unless a name says otherwise.

import type { LanguageChoice } from './locales';
import type { TextSize, ThemeChoice } from './theme';

export type Ms = number;

export interface Vec2 {
  x: number;
  y: number;
}

/* ---------------------------------------------------------------- ids */
/* These strings are stored in the database and in export files. Add new ones; never rename. */

export type ModeId =
  | 'dynamic'
  | 'jumps'
  | 'angles'
  | 'streams'
  | 'tracking'
  | 'spinning'
  | 'precision'
  | 'reading'
  | 'timing'
  | 'stamina'
  | 'warmup'
  | 'mix'
  | 'placement';

/** Training modules whose level adapts after every set. */
export type ModuleId = 'jumps' | 'angles' | 'streams' | 'tracking' | 'spinning' | 'precision' | 'reading' | 'timing';

export type ModId = 'fade' | 'spotlight' | 'fast' | 'slow' | 'tight' | 'wide' | 'mirror' | 'nofail' | 'onelife' | 'bullseye' | 'norings';

export type SkillId = 'aim' | 'speed' | 'tracking' | 'precision' | 'timing' | 'reading' | 'spin';

export type Judgment = 'crisp' | 'solid' | 'rough' | 'miss';

export type ObjectKind = 'circle' | 'slider' | 'spinner';

export type PatternTag =
  | 'single'
  | 'jump'
  | 'backforth'
  | 'triangle'
  | 'square'
  | 'star'
  | 'flow'
  | 'stream'
  | 'burst'
  | 'doubles'
  | 'slider'
  | 'spinner'
  | 'stack'
  | 'cutstream'
  | 'spacedstream'
  | 'polygon';

export type GradeId = 'pinpoint' | 'sharp' | 'clean' | 'steady' | 'loose' | 'scattered';

export type MilestoneId =
  | 'first-play'
  | 'plays-50'
  | 'plays-250'
  | 'hours-5'
  | 'hours-25'
  | 'streak-7'
  | 'streak-30'
  | 'combo-100'
  | 'combo-500'
  | 'no-miss'
  | 'daily-7'
  | 'drill-better'
  | 'placement'
  | 'clear-1'
  | 'clear-2'
  | 'clear-3'
  | 'clear-4'
  | 'clear-5'
  | 'clear-6'
  | 'clear-7'
  | 'clear-8';

export type InputSlot = 'key1' | 'key2' | 'mouse1' | 'mouse2';

export type PointerKind = 'mouse' | 'pen' | 'touch';

/**
 * Why an object ended as a miss.
 * none: never pressed. aim: pressed in time but outside the target (the nearest such press is recorded).
 * early: pressed on the target before its rough window. skipped: a later object was hit first.
 * tracking: slider tracked too little. spin: spinner under half its rotations.
 */
export type MissReason = 'none' | 'aim' | 'early' | 'skipped' | 'tracking' | 'spin';

/* --------------------------------------------------------- difficulty */

/** Dynamic mode controls. Ranges and labels are in DIFFICULTY_LIMITS (catalog.ts). */
export interface DifficultySettings {
  /** Target radius, playfield units. 30..70. */
  radius: number;
  /** Time a target shows before its hit time. 300..1800. */
  approachMs: Ms;
  /** Beat grid tempo. 90..260. Streams use quarter beats. */
  bpm: number;
  /** 1..10. Share of jumps on half beats instead of full beats. */
  density: number;
  /** 1..10. Jump distance for a given gap. */
  spacing: number;
  /** 1..10. Sharper angles, shapes and mixed rhythms as it rises. */
  complexity: number;
  /** 0..10. How often streams and bursts appear. 0 = never. */
  streams: number;
  /** 3..32. Most notes in one stream. */
  streamMaxLength: number;
  /** 0..10. How often sliders appear. 0 = never. */
  sliders: number;
  /** 0..10. How often spinners appear at section boundaries. 0 = never. */
  spinners: number;
  /** 0..10. Hit window strictness, see windowsForTiming. */
  timing: number;
}

export interface LevelPreset {
  /** 1..8 */
  level: number;
  label: string;
  description: string;
  difficulty: DifficultySettings;
  lengthSec: number;
}

/** Options for training modules. Each mode lists the keys it uses in MODES[id].options. */
export interface ModuleOptions {
  /** jumps */
  distanceFocus?: 'mixed' | 'short' | 'long';
  /** jumps: bias movement toward one direction. Octant 0..7: 0 = moving right, then clockwise on screen (2 = down). */
  directionFocus?: number | null;
  /** angles */
  angleFocus?: 'mixed' | 'sharp' | 'wide';
  /** streams */
  streamLength?: 'short' | 'medium' | 'long';
  /** tracking */
  sliderFocus?: 'mixed' | 'straight' | 'curves' | 'repeats';
  /** mix: two to four modules, played in this order, one set each. */
  mixModules?: ModuleId[];
}

/* --------------------------------------------------------- mods, modes */

export interface ModInfo {
  id: ModId;
  label: string;
  description: string;
  /** Score multiplier. Multipliers of chosen mods multiply together. */
  multiplier: number;
  /** Mods that can't be on together with this one. */
  conflicts: ModId[];
  /** 'all' = Dynamic and training modules. 'dynamic' = Dynamic only. */
  scope: 'all' | 'dynamic';
}

export interface ModeInfo {
  id: ModeId;
  label: string;
  description: string;
  /** Skills the mode trains, for menus. */
  skills: SkillId[];
  /** Level adapts after every set. */
  adaptive: boolean;
  lengthOptions: number[];
  defaultLengthSec: number;
  options: (keyof ModuleOptions)[];
  defaultOptions: ModuleOptions;
  /** Objects per set (taps, sliders or spinners). 0 when the mode has no sets of its own. */
  setSize: number;
  allowedMods: ModId[];
}

/* -------------------------------------------------------- hit objects */

export interface HitWindows {
  /** Half-widths. |error| <= crisp is Crisp, <= solid is Solid, <= rough is Rough. */
  crisp: Ms;
  solid: Ms;
  rough: Ms;
  /** A press on the target between -early and -rough is an early miss. Earlier presses are ignored. */
  early: Ms;
}

interface HitObjectBase {
  /** 0-based play order. Equal to the object's position in GeneratedMap.objects. */
  index: number;
  /** Hit time (circle, slider head) or start time (spinner). */
  time: Ms;
  /** Center. Spinners always use PLAYFIELD_CENTER. */
  pos: Vec2;
  radius: number;
  approachMs: Ms;
  windows: HitWindows;
  /** Colour group. Increases by one at each new pattern. */
  group: number;
  /** Number drawn on the target, 1-based within its group. */
  number: number;
  pattern: PatternTag;
  /** Section intensity 0..1 where the object sits. */
  intensity: number;
  /** Adaptive set index, or -1 outside sets. */
  set: number;
}

export interface CircleObject extends HitObjectBase {
  kind: 'circle';
}

/**
 * Slider path pieces. Each starts where the previous one ended; the first starts at the slider's pos.
 * line: straight to `to`. arc: circular arc through `through` to `to`. cubic: Bezier with controls c1, c2.
 */
export type PathSegment =
  { type: 'line'; to: Vec2 } | { type: 'arc'; through: Vec2; to: Vec2 } | { type: 'cubic'; c1: Vec2; c2: Vec2; to: Vec2 };

export interface SliderObject extends HitObjectBase {
  kind: 'slider';
  path: PathSegment[];
  /** Arc length, measured with the flattening in src/game/map/path.ts. */
  length: number;
  /** Ball speed, units per ms. */
  velocity: number;
  /** Reversals. 0 = one pass. */
  repeats: number;
  /** One pass: length / velocity. */
  spanMs: Ms;
  /** time + spanMs * (repeats + 1). */
  endTime: Ms;
  /** Distance between ticks along the path. 0 = no ticks. */
  tickDistance: number;
  /** Once tracking, the cursor must stay within this distance of the ball while holding. */
  followRadius: number;
  /** straight = one line, arc = one arc, curve = anything else. */
  shape: 'straight' | 'arc' | 'curve';
}

export interface SpinnerObject extends HitObjectBase {
  kind: 'spinner';
  endTime: Ms;
  /** Full turns needed for Crisp. A multiple of 0.5. */
  rotationsRequired: number;
}

export type HitObject = CircleObject | SliderObject | SpinnerObject;

export interface HealthRules {
  /** Health lost per second of active play, on a 0..1 scale. */
  drainPerSec: number;
  /** Health lost per missed object. */
  missPenalty: number;
  /** Health lost per missed slider tick, repeat or end. */
  partPenalty: number;
  /** false with No Fail: health shows but can't end the play. */
  canFail: boolean;
  /** One Life: any combo break ends the play. */
  failOnFirstMiss: boolean;
}

export type SectionFocus = 'jumps' | 'flow' | 'streams' | 'sliders' | 'mixed' | 'break' | 'set';

export type SectionRole = 'intro' | 'build' | 'peak' | 'rest' | 'outro';

export interface MapSection {
  start: Ms;
  end: Ms;
  intensity: number;
  focus: SectionFocus;
  /** Dynamic maps from generator 2. Absent on adaptive sets and older maps. */
  role?: SectionRole;
  /** The second half of the section mirrors the first. */
  mirrored?: boolean;
}

export interface GeneratedMap {
  /** MAP_FORMAT from catalog.ts. */
  format: number;
  /** GENERATOR_VERSION from src/game. Same seed + version + launch = same map on the same browser. */
  generatorVersion: number;
  seed: number;
  modeId: ModeId;
  /** 60000 / bpm of the beat grid. */
  beatMs: Ms;
  /** Last object's end time + 1000. Grows as adaptive sets are added. */
  durationMs: Ms;
  /** null = no health bar and no fail (training modules). */
  health: HealthRules | null;
  objects: HitObject[];
  sections: MapSection[];
  /** Play time of beat 0 of the beat grid, after rate. Absent when the map has no steady beat. */
  beatOffsetMs?: Ms;
}

/** A map after mods: positions mirrored, times scaled by rate, health flags set. */
export interface PlayableMap extends GeneratedMap {
  mods: ModId[];
  /** Fast 1.25, Slow 0.8, otherwise 1. Times, approach and spans are already divided by it. */
  rate: number;
}

/* ------------------------------------------------------------- launch */

/** Where a play was started. Absent on 1.0 plays, which count as manual. */
export type LaunchSource =
  | { kind: 'manual' }
  | { kind: 'daily'; date: string } // local date YYYY-MM-DD
  | { kind: 'plan'; date: string; step: number } // step is 0-based
  | { kind: 'share'; code: string };

export interface LaunchRequest {
  modeId: ModeId;
  /** Used by Dynamic. Modules ignore it (pass DEFAULT_DIFFICULTY). */
  difficulty: DifficultySettings;
  /** Dynamic preset the difficulty came from, or null for custom and for modules. */
  presetLevel: number | null;
  options: ModuleOptions;
  mods: ModId[];
  /** uint32 */
  seed: number;
  lengthSec: number;
  /** The player's current module levels from progress. Missing modules use DEFAULT_MODULE_LEVEL. */
  levels: Partial<Record<ModuleId, number>>;
  /** Set when the play was started from an insight's drill. */
  drillId: string | null;
  /** Where the play was started. Absent on 1.0 plays, which count as manual. */
  source?: LaunchSource;
}

/* ------------------------------------------------------------ records */

export interface ObjectFeatures {
  /** From the previous object's end position (slider tail) to this object. null for the first object and after a spinner. */
  distance: number | null;
  /** From the previous object's end time to this object's time. null for the first object. */
  gapMs: Ms | null;
  /** distance / gapMs, units per ms. */
  velocity: number | null;
  /** distance / (2 * radius), in target widths. */
  spacing: number | null;
  /** Turn between the previous movement and this one, 0..180. 0 = straight on, 180 = full reversal.
   *  null unless both movements exist and are at least 0.5 radius long. */
  turnAngle: number | null;
  /** Direction of this movement, 0..360: 0 = right, 90 = down. null when distance is null or under 0.5 radius. */
  direction: number | null;
  /** 1-based position in a run of 3+ objects with equal gaps under 160 ms. 0 when not in such a run. */
  runIndex: number;
  /** Length of that run, 0 when not in one. */
  runLength: number;
  /** Objects visible at this object's time (approach started, not yet ended), including itself. */
  visibleCount: number;
  /** time / map duration, 0..1. */
  progress: number;
}

export interface MovementMetrics {
  /** First time the cursor entered the target after the previous object, relative to this object's time.
   *  Negative = arrived early. null when it never entered before the press, or there was no press. */
  arriveMs: Ms | null;
  /** Straight distance / cursor path length from the previous object's end to the press, 0..1. */
  efficiency: number | null;
  /** Extra speed peaks after the main one (corrective submovements). */
  corrections: number | null;
  /** Highest cursor speed in that interval, units per ms. */
  peakSpeed: number | null;
  /** From the start of the movement window to the start of the move toward this target. */
  leaveMs?: Ms | null;
  /** End of the first (main) motion relative to the center, with the same axes and signs as aimAlong and aimLateral. */
  primaryAlong?: number | null;
  primaryLateral?: number | null;
  /** When the first motion ended, relative to this object's time. Negative = before it. */
  primaryEndMs?: Ms | null;
  /** Cursor path length from the end of the first motion to the press. */
  correctionPath?: number | null;
}

export interface SliderStats {
  /** Ticks and repeats, excluding head and end. */
  ticksHit: number;
  ticksTotal: number;
  endHit: boolean;
  /** Share of the slider's duration spent tracking, 0..1. */
  trackedFraction: number;
  /** Mean distance cursor-to-ball while the slider runs. */
  meanDistance: number;
  /** Mean signed error along the path direction. Negative = behind the ball. */
  meanLag: number;
  /** RMS error across the path. */
  lateralRms: number;
  /** Times tracking was lost after it started. */
  breaks: number;
  /** Progress 0..1 over the whole slider (all passes) where tracking was first lost, or null. */
  firstLossAt: number | null;
  shape: 'straight' | 'arc' | 'curve';
  length: number;
  velocity: number;
  repeats: number;
  followRadius: number;
}

export interface SpinnerStats {
  rotations: number;
  rotationsRequired: number;
  meanRpm: number;
  peakRpm: number;
  rpmSd: number;
  heldMs: Ms;
  durationMs: Ms;
}

export interface HitRecord {
  index: number;
  kind: ObjectKind;
  pattern: PatternTag;
  set: number;
  time: Ms;
  /** Same as time for circles. */
  endTime: Ms;
  pos: Vec2;
  radius: number;
  approachMs: Ms;
  crispMs: Ms;
  /** Final judgment. Sliders: worse of head and tracking. */
  judgment: Judgment;
  /** Head press judgment. Same as judgment for circles, null for spinners. */
  headJudgment: Judgment | null;
  /** null unless judgment is 'miss' (or a slider head missed). */
  missReason: MissReason | null;
  /** Press time minus object time. Negative = early. null when there was no press. */
  timingError: Ms | null;
  /** Cursor at the press. null when there was no press. */
  hit: Vec2 | null;
  /** Aim error along the incoming movement direction. Positive = overshoot. null without press or direction. */
  aimAlong: number | null;
  /** Aim error across the movement. Positive = to the right of the movement direction. */
  aimLateral: number | null;
  /** Distance from the press to the center. */
  aimRadial: number | null;
  input: InputSlot | null;
  comboBefore: number;
  /** A pause overlapped this object's approach. Analytics skips these. */
  afterPause: boolean;
  features: ObjectFeatures;
  movement: MovementMetrics;
  slider: SliderStats | null;
  spinner: SpinnerStats | null;
}

/* ------------------------------------------------------------- result */

export type PlayStatus = 'completed' | 'failed' | 'quit';

export interface JudgmentCounts {
  crisp: number;
  solid: number;
  rough: number;
  miss: number;
}

export interface LevelStep {
  set: number;
  module: ModuleId;
  level: number;
  /** Success share in this set, 0..1, as the module defines success. */
  success: number;
  objects: number;
}

export interface InputInfo {
  pointer: PointerKind | 'mixed' | null;
  rawInput: boolean;
  /** Pointer lock with unadjustedMovement was granted. */
  unadjusted: boolean;
  sensitivity: number;
  /** Median pointer sample rate seen, Hz. */
  pointerHz: number | null;
  /** Median frame rate seen, Hz. */
  displayHz: number | null;
  visualOffsetMs?: number;
  audioOffsetMs?: number;
  /** 99th percentile frame time during play, ms. */
  frameP99Ms?: number | null;
}

export interface PlayMapInfo {
  format: number;
  generatorVersion: number;
  seed: number;
  beatMs: Ms;
  durationMs: Ms;
  rate: number;
  mods: ModId[];
  health: HealthRules | null;
  counts: Record<ObjectKind, number>;
  sections?: MapSection[];
  beatOffsetMs?: Ms;
}

export interface PlayResult {
  /** RECORD_VERSION from catalog.ts. */
  recordVersion: number;
  engineVersion: number;
  launch: LaunchRequest;
  map: PlayMapInfo;
  /** Epoch ms (Date.now) at the first input that started the play, and at the end. */
  startedAt: number;
  endedAt: number;
  /** Play time, pauses excluded. */
  playedMs: Ms;
  status: PlayStatus;
  score: number;
  /** 0..1 */
  accuracy: number;
  maxCombo: number;
  counts: JudgmentCounts;
  sliderParts: { hit: number; total: number };
  /** Presses that hit no object. */
  strayPresses: number;
  pauses: number;
  /** Empty outside adaptive modes. */
  levels: LevelStep[];
  /** Measured level per adaptive module played. */
  finalLevels: Partial<Record<ModuleId, number>>;
  healthAtEnd: number | null;
  input: InputInfo;
  /** Judged objects only, sorted by index. */
  records: HitRecord[];
  /** Absent if recording failed. */
  replay?: ReplayData;
}

/* ------------------------------------------------------------ replay */

/** Every call the engine made to GameSession, in order. Times on a 1/64 ms grid, positions on a 1/16 unit grid. */
export interface InputTrace {
  count: number;
  /** TRACE_OP codes. */
  ops: Uint8Array;
  t: Float64Array;
  /** Set for ops that carry a position (move, pressAt). 0 elsewhere. */
  x: Float32Array;
  y: Float32Array;
}

export interface ReplayData {
  /** REPLAY_FORMAT. */
  format: number;
  engineVersion: number;
  launch: LaunchRequest;
  /** The map as played: mods applied and every adaptive set included. */
  map: PlayableMap;
  progressMs: Ms;
  status: PlayStatus;
  /** Session time at the end. Equals PlayResult.playedMs. */
  endT: Ms;
  /** Final judgment per object index: c, s, r, m, or '-' when not judged. */
  judgments: string;
  levels: LevelStep[];
  trace: InputTrace;
}

/* ----------------------------------------------------------- settings */

export type SoundSetId = 'glass' | 'wood' | 'pulse';
export type PaletteId = 'heartbeat' | 'classic' | 'clearview' | 'contrast';
export type CursorStyle = 'ring' | 'cross' | 'dot';
export type ApproachStyle = 'ring' | 'fill' | 'brackets';
export type MetronomeMode = 'off' | 'beat' | 'bar';

export interface Settings {
  v: 1;
  /** The language of every piece of text. 'auto' follows the browser. */
  language: LanguageChoice;
  input: {
    /** Pointer lock with unadjusted movement where the browser allows it. */
    rawInput: boolean;
    /** Raw mode only. 1 = one mouse count moves the cursor one CSS pixel. 0.1..5. */
    sensitivity: number;
    /** KeyboardEvent.code for the two hit keys. */
    keys: [string, string];
    /** Left and right mouse buttons (and pen tip and barrel) count as presses. */
    mouseButtons: boolean;
    /** Absolute mode cursor. 'system' uses a CSS crosshair (lowest latency). Raw mode always draws. */
    cursor: 'system' | 'drawn';
    /** 0.5..2 */
    cursorScale: number;
    cursorTrail: boolean;
    /** KeyboardEvent.code held 0.3 s to restart. '' = off. Never Escape or a hit key. */
    retryKey: string;
  };
  audio: {
    /** 0..1 */
    master: number;
    muted: boolean;
    hits: number;
    effects: number;
    ambient: number;
    soundSet: SoundSetId;
    metronome: MetronomeMode;
    /** 0..1 */
    metronomeVolume: number;
    /** -100..300. The metronome plays this many ms earlier. */
    offsetMs: number;
  };
  display: {
    errorBar: boolean;
    pathHints: boolean;
    crispPopups: boolean;
    earlyLate: boolean;
    reduceMotion: boolean;
    /** Canvas with desynchronized: true. Takes effect at the next play. */
    lowLatency: boolean;
    showFps: boolean;
    /** -50..150. Objects are drawn this many ms ahead of play time. */
    visualOffsetMs: number;
    frameGraph: boolean;
    /** Dark, light, or whatever the operating system uses. */
    theme: ThemeChoice;
    /** Scales every piece of text on the pages. The playfield is not affected. */
    textSize: TextSize;
    /** Stronger text and lines. */
    highContrast: boolean;
  };
  skin: {
    palette: PaletteId;
    cursorStyle: CursorStyle;
    approach: ApproachStyle;
    fieldGrid: boolean;
    clickRipple: boolean;
  };
  goals: {
    /** 0 = no goal. 0..600, step 15. */
    weeklyMinutes: number;
  };
  data: {
    /** Days to keep per-object detail. null = forever. Play summaries are always kept. */
    detailRetentionDays: number | null;
    /** Newest replays kept, besides kept ones. null = all. */
    replayLimit: number | null;
  };
  updatedAt: number;
}

/* ----------------------------------------------------------- game API */

export interface GameCallbacks {
  /** Fires once, when the first click or key press starts the play. */
  onStart?(): void;
  onPause(paused: boolean): void;
  /** Fires once, when the play completes, fails or is quit. Never after destroy(). */
  onFinish(result: PlayResult): void;
  /** The engine could not start. The message is shown to the player as is. */
  onError(message: string): void;
  /** The player held the retry key. The play ended with status 'quit'. When absent, the key does nothing. */
  onRetry?(result: PlayResult): void;
}

export interface GameHandle {
  /** Resume from pause. Call from a click or key handler: raw input needs a user gesture to lock again. */
  resume(): void;
  pause(): void;
  /** End early. onFinish fires with status 'quit'. */
  quit(): void;
  /** Apply volume and display changes live. Input mode changes apply at the next play. */
  setSettings(settings: Settings): void;
  /** Stop, release pointer lock, close audio voices, remove listeners. Safe to call twice. */
  destroy(): void;
}

export interface MapPreview {
  /** Whole map for Dynamic, stamina and warmup; the first set for adaptive modes. */
  map: PlayableMap;
  features: ObjectFeatures[];
}

export type CreateGame = (canvas: HTMLCanvasElement, launch: LaunchRequest, settings: Settings, callbacks: GameCallbacks) => GameHandle;

export type PreviewLaunch = (launch: LaunchRequest) => MapPreview;

export type TestSound = 'hit' | 'miss' | 'combo' | 'tick' | 'metronome' | 'countdown';
/** Plays one feedback sound. Call from a click handler (audio needs a user gesture). */
export type PlayTestSound = (settings: Settings, sound: TestSound) => void;

export type PlaybackSource = { kind: 'replay'; replay: ReplayData } | { kind: 'autoplay'; launch: LaunchRequest; loop: boolean };
export interface PlaybackInfo {
  durationMs: Ms;
  /** Objects whose judgment in this run differs from ReplayData.judgments. 0 for autoplay. */
  mismatches: number;
}
export interface PlaybackCallbacks {
  onReady(info: PlaybackInfo): void;
  /** At most 10 times a second while playing, and after every seek. */
  onTime(t: Ms): void;
  onEnd(): void;
  onError(message: string): void;
}
export interface PlaybackHandle {
  play(): void;
  pause(): void;
  seek(t: Ms): void;
  /** 0.25..2 */
  setSpeed(speed: number): void;
  setSettings(settings: Settings): void;
  destroy(): void;
}
export type CreatePlayback = (
  canvas: HTMLCanvasElement,
  source: PlaybackSource,
  settings: Settings,
  callbacks: PlaybackCallbacks,
) => PlaybackHandle;

export type CalibrationKind = 'visual' | 'audio';
export interface CalibrationResult {
  kind: CalibrationKind;
  /** Median of press time minus beat time, ms. Positive = late. */
  offsetMs: number;
  sdMs: number;
  taps: number;
}
export interface CalibrationCallbacks {
  onTap(taps: number, needed: number): void;
  onDone(result: CalibrationResult): void;
  onError(message: string): void;
}
export interface CalibrationHandle {
  restart(): void;
  destroy(): void;
}
export type CreateCalibration = (
  canvas: HTMLCanvasElement,
  kind: CalibrationKind,
  settings: Settings,
  callbacks: CalibrationCallbacks,
) => CalibrationHandle;
