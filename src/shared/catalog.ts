// Shared constants, player-facing copy and small formulas. Both builders import from here and never edit it.
// Text here is shown to players and follows reference/writing.md.

import type {
  DifficultySettings,
  GradeId,
  HitWindows,
  InputSlot,
  Judgment,
  LevelPreset,
  MilestoneId,
  ModId,
  ModInfo,
  ModeId,
  ModeInfo,
  ModuleId,
  PaletteId,
  PlayStatus,
  Settings,
  SkillId,
  SoundSetId,
} from './types';

export const PLAYFIELD = { width: 1000, height: 625 } as const;
export const PLAYFIELD_CENTER = { x: 500, y: 312.5 } as const;
/** Visual radius of a spinner, playfield units. */
export const SPINNER_RADIUS = 240;

/** Shape of GeneratedMap. */
export const MAP_FORMAT = 1;
/** Shape of HitRecord and PlayResult. Bump with a migration when either changes. */
export const RECORD_VERSION = 2;
/** Container version of an encoded replay (src/shared/replay.ts). */
export const REPLAY_FORMAT = 1;
/** Bests compare plays within one scoring version. */
export const SCORING_VERSION = 1;
export const SHARE_CODE_VERSION = 1;

/** Replay grid: times in 1/timeSteps ms, positions in 1/posSteps units. */
export const TRACE = { timeSteps: 64, posSteps: 16, maxSampleHz: 2000, chunkEvents: 65536 } as const;
/** Op codes in InputTrace.ops. pressAt + slot, press + slot and release + slot use INPUT_SLOT_ORDER. */
export const TRACE_OP = { move: 0, pressAt: 1, press: 5, release: 9, advance: 13, pause: 14, resume: 15 } as const;
export const INPUT_SLOT_ORDER: readonly InputSlot[] = ['key1', 'key2', 'mouse1', 'mouse2'];

/* Append only. Share codes store indexes into these. */
export const SHARE_MODE_ORDER: readonly ModeId[] = [
  'dynamic', 'jumps', 'angles', 'streams', 'tracking', 'spinning', 'precision', 'reading', 'timing', 'stamina', 'warmup', 'mix', 'placement',
];
export const SHARE_MOD_ORDER: readonly ModId[] = [
  'fade', 'spotlight', 'fast', 'slow', 'tight', 'wide', 'mirror', 'nofail', 'onelife', 'bullseye', 'norings',
];
export const DIFFICULTY_KEYS: readonly (keyof DifficultySettings)[] = [
  'radius', 'approachMs', 'bpm', 'density', 'spacing', 'complexity', 'streams', 'streamMaxLength', 'sliders', 'spinners', 'timing',
];

export const JUDGMENTS: Record<Judgment, { label: string; weight: number; color: string }> = {
  crisp: { label: 'Crisp', weight: 1, color: '#a78bfa' },
  solid: { label: 'Solid', weight: 0.65, color: '#2dd4bf' },
  rough: { label: 'Rough', weight: 0.3, color: '#f59e0b' },
  miss: { label: 'Miss', weight: 0, color: '#f43f5e' },
};

/** Hit windows for timing strictness 0..10. Timing 5 gives 40, 80 and 120 ms. */
export function windowsForTiming(timing: number): HitWindows {
  const crisp = 57.5 - 3.5 * timing;
  return { crisp, solid: 2 * crisp, rough: 3 * crisp, early: 3 * crisp + 60 };
}

export const MOD_RATE = { fast: 1.25, slow: 0.8 } as const;
export const MOD_SCALE = {
  tight: { radius: 0.8, windows: 0.75 },
  wide: { radius: 1.25, windows: 1.3 },
} as const;

// 'bullseye' joins ALL_MODS when the engine judges it.
const ALL_MODS: ModId[] = ['fade', 'spotlight', 'fast', 'slow', 'tight', 'wide', 'mirror', 'nofail', 'onelife', 'norings'];
const MODULE_MODS: ModId[] = ['fade', 'spotlight', 'mirror', 'norings'];

export const MODS: Record<ModId, ModInfo> = {
  fade: {
    id: 'fade',
    label: 'Fade',
    description: "Targets fade out before you hit them, and there's no approach ring.",
    multiplier: 1.05,
    conflicts: ['norings'],
    scope: 'all',
  },
  spotlight: {
    id: 'spotlight',
    label: 'Spotlight',
    description: 'You can only see the area around your cursor.',
    multiplier: 1.1,
    conflicts: [],
    scope: 'all',
  },
  fast: {
    id: 'fast',
    label: 'Fast',
    description: 'The map plays 25% faster. Hit windows keep their length.',
    multiplier: 1.15,
    conflicts: ['slow'],
    scope: 'dynamic',
  },
  slow: {
    id: 'slow',
    label: 'Slow',
    description: 'The map plays 20% slower. Hit windows keep their length.',
    multiplier: 0.7,
    conflicts: ['fast'],
    scope: 'dynamic',
  },
  tight: {
    id: 'tight',
    label: 'Tight',
    description: 'Targets are 20% smaller and hit windows are 25% shorter.',
    multiplier: 1.1,
    conflicts: ['wide'],
    scope: 'dynamic',
  },
  wide: {
    id: 'wide',
    label: 'Wide',
    description: 'Targets are 25% larger and hit windows are 30% longer.',
    multiplier: 0.6,
    conflicts: ['tight'],
    scope: 'dynamic',
  },
  mirror: {
    id: 'mirror',
    label: 'Mirror',
    description: 'The map is flipped left to right.',
    multiplier: 1,
    conflicts: [],
    scope: 'all',
  },
  nofail: {
    id: 'nofail',
    label: 'No Fail',
    description: "Running out of health doesn't end the play.",
    multiplier: 0.8,
    conflicts: ['onelife'],
    scope: 'dynamic',
  },
  onelife: {
    id: 'onelife',
    label: 'One Life',
    description: 'Your first miss ends the play.',
    multiplier: 1,
    conflicts: ['nofail'],
    scope: 'dynamic',
  },
  bullseye: {
    id: 'bullseye',
    label: 'Bullseye',
    description: 'A hit outside the inner half of a target counts as Rough at best.',
    multiplier: 1.1,
    conflicts: [],
    scope: 'dynamic',
  },
  norings: {
    id: 'norings',
    label: 'No Rings',
    description: 'Targets show no approach ring, so you read the timing from the spacing and the beat.',
    multiplier: 1.05,
    conflicts: ['fade'],
    scope: 'all',
  },
};

export const BULLSEYE = { innerRadii: 0.5 } as const;

export function modMultiplier(mods: readonly ModId[]): number {
  return mods.reduce((m, id) => m * MODS[id].multiplier, 1);
}

/** Pairs of chosen mods that can't be combined. Empty when the set is valid. */
export function modConflicts(mods: readonly ModId[]): [ModId, ModId][] {
  const out: [ModId, ModId][] = [];
  for (const a of mods) for (const b of MODS[a].conflicts) if (a < b && mods.includes(b)) out.push([a, b]);
  return out;
}

export const SKILLS: Record<SkillId, { label: string; description: string }> = {
  aim: { label: 'Aim', description: 'Jumps between targets' },
  speed: { label: 'Speed', description: 'Fast taps in streams' },
  tracking: { label: 'Tracking', description: 'Staying on sliders' },
  precision: { label: 'Precision', description: 'Landing near the center' },
  timing: { label: 'Timing', description: 'Hitting on time' },
  reading: { label: 'Reading', description: 'Short approach times and busy screens' },
  spin: { label: 'Spinning', description: 'Spinner speed' },
};

export const MODULE_IDS: ModuleId[] = ['jumps', 'angles', 'streams', 'tracking', 'spinning', 'precision', 'reading', 'timing'];
export const MODE_ORDER: ModeId[] = ['dynamic', 'warmup', 'mix', ...MODULE_IDS, 'stamina'];

/** Module levels are open-ended in principle; the engine clamps to this range. */
export const LEVEL_LIMITS = { min: 1, max: 15 } as const;
export const DEFAULT_MODULE_LEVEL = 3;
/** Adaptive modules aim for a success share inside this band. */
export const SUCCESS_BAND = { low: 0.7, high: 0.86 } as const;

const moduleMode = (
  id: ModeId,
  label: string,
  description: string,
  skills: SkillId[],
  extra: Partial<ModeInfo> = {},
): ModeInfo => ({
  id,
  label,
  description,
  skills,
  adaptive: true,
  lengthOptions: [60, 90, 120, 180],
  defaultLengthSec: 90,
  options: [],
  defaultOptions: {},
  setSize: 16,
  allowedMods: MODULE_MODS,
  ...extra,
});

export const MODES: Record<ModeId, ModeInfo> = {
  dynamic: moduleMode(
    'dynamic',
    'Dynamic',
    'Generated maps that mix every skill. Pick a level, or set each part of the difficulty yourself.',
    ['aim', 'speed', 'tracking', 'precision', 'timing', 'reading', 'spin'],
    { adaptive: false, lengthOptions: [60, 90, 120, 180, 240, 300], setSize: 0, allowedMods: ALL_MODS },
  ),
  jumps: moduleMode('jumps', 'Jumps', 'Single targets spread across the field. Trains how far you move and where you stop.', ['aim'], {
    options: ['distanceFocus', 'directionFocus'],
    defaultOptions: { distanceFocus: 'mixed', directionFocus: null },
  }),
  angles: moduleMode('angles', 'Angles', 'Jumps of one length with sharp or wide turns between them.', ['aim'], {
    options: ['angleFocus'],
    defaultOptions: { angleFocus: 'mixed' },
  }),
  streams: moduleMode('streams', 'Streams', 'Quick runs of taps close together. Trains tapping speed and even timing.', ['speed', 'timing'], {
    options: ['streamLength'],
    defaultOptions: { streamLength: 'medium' },
    setSize: 40,
  }),
  tracking: moduleMode('tracking', 'Tracking', 'Every target is a slider. Keep the cursor on the moving ball until it ends.', ['tracking'], {
    options: ['sliderFocus'],
    defaultOptions: { sliderFocus: 'mixed' },
    setSize: 6,
  }),
  spinning: moduleMode('spinning', 'Spinning', 'Spinners with a speed goal that rises as you improve.', ['spin'], {
    lengthOptions: [60, 90, 120],
    defaultLengthSec: 60,
    setSize: 2,
  }),
  precision: moduleMode('precision', 'Precision', 'Small targets at a calm pace. A hit only counts as a success near the center.', ['precision'], {
    setSize: 12,
  }),
  reading: moduleMode('reading', 'Reading', 'Short approach times with many targets on screen at once.', ['reading'], { setSize: 24 }),
  timing: moduleMode('timing', 'Timing', 'Large targets close together. The hit windows narrow as you improve.', ['timing'], { setSize: 20 }),
  stamina: moduleMode('stamina', 'Stamina', 'Long streams and jump runs at a steady level. Shows when your accuracy starts to drop.', ['speed', 'aim'], {
    adaptive: false,
    lengthOptions: [120, 180, 300],
    defaultLengthSec: 180,
    setSize: 0,
  }),
  warmup: moduleMode('warmup', 'Warm-up', 'Mixed patterns a little below your usual level, to start a session.', [], {
    adaptive: false,
    lengthOptions: [60, 120, 180],
    defaultLengthSec: 120,
    setSize: 0,
  }),
  mix: moduleMode('mix', 'Mix', 'Sets from two to four modules in turn. Each module keeps its own level.', [], {
    lengthOptions: [90, 120, 180, 300],
    defaultLengthSec: 180,
    options: ['mixModules'],
    defaultOptions: { mixModules: ['jumps', 'streams', 'tracking'] },
    setSize: 0,
  }),
  placement: moduleMode(
    'placement',
    'Placement',
    'Two short sets of each of five modules. It sets your starting level in each.',
    ['aim', 'speed', 'tracking', 'precision', 'timing'],
    { lengthOptions: [240], defaultLengthSec: 240, setSize: 0, allowedMods: [] },
  ),
};

export const PLACEMENT = {
  modules: ['jumps', 'streams', 'tracking', 'precision', 'timing'] as readonly ModuleId[],
  setsPerModule: 2,
  startLevel: 3,
  firstStep: 1,
  setSize: { jumps: 12, streams: 24, tracking: 4, precision: 8, timing: 12 } as Partial<Record<ModuleId, number>>,
} as const;

export const RETRY_HOLD_MS = 300;
export const DAILY_LENGTH_SEC = 90;

const d = (
  radius: number, approachMs: number, bpm: number, density: number, spacing: number, complexity: number,
  streams: number, streamMaxLength: number, sliders: number, spinners: number, timing: number,
): DifficultySettings => ({ radius, approachMs, bpm, density, spacing, complexity, streams, streamMaxLength, sliders, spinners, timing });

export const LEVEL_PRESETS: readonly LevelPreset[] = [
  { level: 1, label: 'Level 1', description: 'Large, slow targets with plenty of time to read them.', difficulty: d(64, 1500, 110, 2, 2, 1, 0, 3, 5, 3, 1), lengthSec: 60 },
  { level: 2, label: 'Level 2', description: 'Short jumps and the first short bursts.', difficulty: d(60, 1300, 125, 3, 3, 2, 1, 5, 5, 3, 2), lengthSec: 75 },
  { level: 3, label: 'Level 3', description: 'Medium jumps, sliders and bursts of up to seven taps.', difficulty: d(57, 1150, 140, 4, 4, 3, 2, 7, 5, 2, 3), lengthSec: 90 },
  { level: 4, label: 'Level 4', description: 'Faster jumps and streams of up to nine taps.', difficulty: d(54, 1000, 155, 5, 5, 4, 3, 9, 4, 2, 4), lengthSec: 90 },
  { level: 5, label: 'Level 5', description: 'Jumps on half beats and streams of up to twelve taps.', difficulty: d(50, 850, 170, 6, 6, 5, 4, 12, 4, 2, 5), lengthSec: 90 },
  { level: 6, label: 'Level 6', description: 'Smaller targets, sharper angles and streams of up to sixteen taps.', difficulty: d(46, 720, 185, 7, 7, 6, 5, 16, 4, 2, 6), lengthSec: 120 },
  { level: 7, label: 'Level 7', description: 'Short approach times, long streams and wide jumps.', difficulty: d(42, 600, 200, 8, 8, 7, 5, 20, 3, 1, 7), lengthSec: 120 },
  { level: 8, label: 'Level 8', description: 'Small, fast targets with the shortest approach time.', difficulty: d(38, 480, 220, 9, 9, 8, 6, 24, 3, 1, 8), lengthSec: 120 },
];

export const DEFAULT_DIFFICULTY: DifficultySettings = { ...LEVEL_PRESETS[3]!.difficulty };

export const DIFFICULTY_LIMITS: Record<keyof DifficultySettings, { min: number; max: number; step: number; label: string; help: string }> = {
  radius: { min: 30, max: 70, step: 1, label: 'Target size', help: 'Target radius in playfield units. The playfield is 1000 units wide.' },
  approachMs: { min: 300, max: 1800, step: 10, label: 'Approach time', help: 'How long each target shows before you hit it, in milliseconds.' },
  bpm: { min: 90, max: 260, step: 1, label: 'Tempo', help: 'Beats per minute. Jumps fall on full or half beats and streams on quarter beats.' },
  density: { min: 1, max: 10, step: 1, label: 'Density', help: 'How often jumps come on half beats instead of full beats.' },
  spacing: { min: 1, max: 10, step: 1, label: 'Jump distance', help: 'How far apart targets are for the time between them.' },
  complexity: { min: 1, max: 10, step: 1, label: 'Pattern complexity', help: 'Higher values add sharper angles, shapes and mixed rhythms.' },
  streams: { min: 0, max: 10, step: 1, label: 'Streams', help: 'How often streams and bursts appear. 0 turns them off.' },
  streamMaxLength: { min: 3, max: 32, step: 1, label: 'Longest stream', help: 'The most taps in one stream.' },
  sliders: { min: 0, max: 10, step: 1, label: 'Sliders', help: 'How often sliders appear. 0 turns them off.' },
  spinners: { min: 0, max: 10, step: 1, label: 'Spinners', help: 'How often spinners appear between sections. 0 turns them off.' },
  timing: { min: 0, max: 10, step: 1, label: 'Timing strictness', help: 'Higher values shorten every hit window. 5 gives 40, 80 and 120 ms.' },
};

export const GRADES: readonly { id: GradeId; label: string; minAccuracy: number; noMisses: boolean }[] = [
  { id: 'pinpoint', label: 'Pinpoint', minAccuracy: 0.97, noMisses: true },
  { id: 'sharp', label: 'Sharp', minAccuracy: 0.95, noMisses: false },
  { id: 'clean', label: 'Clean', minAccuracy: 0.9, noMisses: false },
  { id: 'steady', label: 'Steady', minAccuracy: 0.82, noMisses: false },
  { id: 'loose', label: 'Loose', minAccuracy: 0.7, noMisses: false },
  { id: 'scattered', label: 'Scattered', minAccuracy: 0, noMisses: false },
];
/** The first grade whose conditions hold. null for failed and quit plays. Grades are never stored. */
export function gradeFor(accuracy: number, misses: number, status: PlayStatus): GradeId | null {
  if (status !== 'completed') return null;
  return GRADES.find((g) => accuracy >= g.minAccuracy && (!g.noMisses || misses === 0))!.id;
}

export interface Palette {
  label: string;
  description: string;
  groups: readonly [string, string, string, string];
  judgments: Record<Judgment, string>;
}
export const PALETTES: Record<PaletteId, Palette> = {
  flickwise: {
    label: 'Flickwise',
    description: 'The default colours.',
    groups: ['#5ee7f2', '#ff7ab8', '#c9f25c', '#eef1f6'],
    judgments: { crisp: '#b49bff', solid: '#36d6b0', rough: '#ffb340', miss: '#ff4f6a' },
  },
  classic: {
    label: 'Classic',
    description: 'The colours from Flickwise 1.0.',
    groups: ['#7dd3fc', '#f9a8d4', '#fde68a', '#e5e7eb'],
    judgments: { crisp: '#a78bfa', solid: '#2dd4bf', rough: '#f59e0b', miss: '#f43f5e' },
  },
  clearview: {
    label: 'Clear view',
    description: 'Easier to tell apart with red-green colour blindness.',
    groups: ['#56b4e9', '#e69f00', '#f0e442', '#ffffff'],
    judgments: { crisp: '#56b4e9', solid: '#ffffff', rough: '#e69f00', miss: '#cc79a7' },
  },
  contrast: {
    label: 'High contrast',
    description: 'Bright colours on a dark field.',
    groups: ['#ffffff', '#ffe600', '#00e5ff', '#ff5cf0'],
    judgments: { crisp: '#00e5ff', solid: '#ffffff', rough: '#ffe600', miss: '#ff3b3b' },
  },
};

export const SOUND_SETS: Record<SoundSetId, { label: string; description: string }> = {
  glass: { label: 'Glass', description: 'Bright, short tones, as in Flickwise 1.0.' },
  wood: { label: 'Wood', description: 'Soft clicks with little pitch.' },
  pulse: { label: 'Pulse', description: 'Square-wave blips.' },
};

export const MILESTONES: Record<MilestoneId, { label: string; description: string }> = {
  'first-play': { label: 'First play', description: 'You finished your first play.' },
  'plays-50': { label: 'Fifty plays', description: 'You finished 50 plays.' },
  'plays-250': { label: '250 plays', description: 'You finished 250 plays.' },
  'hours-5': { label: 'Five hours of practice', description: 'Your plays add up to five hours.' },
  'hours-25': { label: '25 hours of practice', description: 'Your plays add up to 25 hours.' },
  'streak-7': { label: 'A week in a row', description: 'You played on seven days in a row.' },
  'streak-30': { label: 'A month in a row', description: 'You played on 30 days in a row.' },
  'combo-100': { label: 'Combo of 100', description: 'You reached a combo of 100.' },
  'combo-500': { label: 'Combo of 500', description: 'You reached a combo of 500.' },
  'no-miss': { label: 'No misses', description: 'You finished a Dynamic play of a minute or more without a miss.' },
  'daily-7': { label: 'Seven daily maps', description: 'You finished seven daily maps.' },
  'drill-better': { label: 'A drill that worked', description: 'One of your drills measured better than before.' },
  placement: { label: 'Starting levels set', description: 'You finished the placement test.' },
  'clear-1': { label: 'Level 1 cleared', description: 'You finished Level 1 with 90% accuracy or more.' },
  'clear-2': { label: 'Level 2 cleared', description: 'You finished Level 2 with 90% accuracy or more.' },
  'clear-3': { label: 'Level 3 cleared', description: 'You finished Level 3 with 90% accuracy or more.' },
  'clear-4': { label: 'Level 4 cleared', description: 'You finished Level 4 with 90% accuracy or more.' },
  'clear-5': { label: 'Level 5 cleared', description: 'You finished Level 5 with 90% accuracy or more.' },
  'clear-6': { label: 'Level 6 cleared', description: 'You finished Level 6 with 90% accuracy or more.' },
  'clear-7': { label: 'Level 7 cleared', description: 'You finished Level 7 with 90% accuracy or more.' },
  'clear-8': { label: 'Level 8 cleared', description: 'You finished Level 8 with 90% accuracy or more.' },
};

export const SETTING_RANGES = {
  metronomeVolume: { min: 0, max: 1, step: 0.05 },
  audioOffsetMs: { min: -100, max: 300, step: 1 },
  visualOffsetMs: { min: -50, max: 150, step: 1 },
  weeklyMinutes: { min: 0, max: 600, step: 15 },
} as const;
export const REPLAY_LIMIT_CHOICES: readonly (number | null)[] = [25, 100, 300, null];

export const DEFAULT_SETTINGS: Settings = {
  v: 1,
  input: {
    rawInput: false, sensitivity: 1, keys: ['KeyZ', 'KeyX'], mouseButtons: true, cursor: 'system', cursorScale: 1, cursorTrail: false,
    retryKey: 'Backquote',
  },
  audio: {
    master: 0.6, muted: false, hits: 0.8, effects: 0.8, ambient: 0.5, soundSet: 'glass', metronome: 'off', metronomeVolume: 0.5, offsetMs: 0,
  },
  display: {
    errorBar: true, pathHints: true, crispPopups: false, earlyLate: true, reduceMotion: false, lowLatency: true, showFps: false,
    visualOffsetMs: 0, frameGraph: false,
  },
  skin: { palette: 'flickwise', cursorStyle: 'ring', approach: 'ring', fieldGrid: true, clickRipple: true },
  goals: { weeklyMinutes: 60 },
  data: { detailRetentionDays: 365, replayLimit: 100 },
  updatedAt: 0,
};

/* ------------------------------------------------------------ demand */
/* Raw demand per object, and anchors that map raw demand to the level scale (Level N preset = N). */

/** Raw demand at Dynamic levels 1..8. aim is the median measured on generated preset maps (20 seeds each); the rest follow from the presets. */
export const DEMAND_ANCHORS: Record<SkillId, readonly number[]> = {
  aim: [3.28, 5.91, 7.34, 8.56, 9.87, 11.27, 12.73, 14.57], // bits per second
  speed: [7.3, 8.3, 9.3, 10.3, 11.3, 12.3, 13.3, 14.7], // taps per second
  tracking: [1.68, 2.31, 3.01, 3.82, 4.85, 6.1, 7.63, 9.54], // ball speed / follow radius, per second
  precision: [15.6, 16.7, 17.5, 18.5, 20.0, 21.7, 23.8, 26.3], // 1000 / radius
  timing: [18.5, 19.8, 21.3, 23.0, 25.0, 27.4, 30.3, 33.9], // 1000 / crisp window
  reading: [0.67, 0.77, 0.87, 1.0, 1.18, 1.39, 1.67, 2.08], // 1000 / approach, mod-weighted
  spin: [121, 138, 154, 171, 187, 204, 220, 242], // rpm
};

/** Raw demand at a level. Linear between anchors, extended past 8 with the last step, scaled toward 0 below 1. */
export function rawDemandAt(skill: SkillId, level: number): number {
  const a = DEMAND_ANCHORS[skill];
  if (level <= 1) return a[0]! * Math.max(0, level);
  const i = Math.min(Math.floor(level) - 1, a.length - 2);
  const lo = a[i]!;
  const hi = a[i + 1]!;
  return lo + (hi - lo) * (level - (i + 1));
}

/** Inverse of rawDemandAt. */
export function levelForDemand(skill: SkillId, raw: number): number {
  const a = DEMAND_ANCHORS[skill];
  if (raw <= a[0]!) return Math.max(0, raw / a[0]!);
  for (let i = 0; i < a.length - 1; i++) {
    const lo = a[i]!;
    const hi = a[i + 1]!;
    if (raw <= hi || i === a.length - 2) return i + 1 + (raw - lo) / (hi - lo);
  }
  return a.length;
}

/** Fitts index of difficulty per second of gap. */
export function aimDemand(distance: number, gapMs: number, radius: number): number {
  return Math.log2(distance / (2 * radius) + 1) / (Math.max(gapMs, 1) / 1000);
}
export function speedDemand(gapMs: number): number {
  return 1000 / Math.max(gapMs, 1);
}
export function trackingDemand(velocity: number, followRadius: number): number {
  return (1000 * velocity) / followRadius;
}
export function precisionDemand(radius: number): number {
  return 1000 / radius;
}
export function timingDemand(crispMs: number): number {
  return 1000 / crispMs;
}
export function readingDemand(approachMs: number, mods: readonly ModId[]): number {
  return (
    (1000 / approachMs) *
    (1 + (mods.includes('fade') ? 0.5 : 0) + (mods.includes('spotlight') ? 0.3 : 0) + (mods.includes('norings') ? 0.25 : 0))
  );
}
export function spinDemand(rotationsRequired: number, durationMs: number): number {
  return rotationsRequired / (durationMs / 60000);
}
