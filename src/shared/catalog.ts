// Shared constants, player-facing copy and small formulas. Both builders import from here and never edit it.
// Text here is shown to players and follows reference/writing.md.

import type {
  DifficultySettings,
  HitWindows,
  Judgment,
  LevelPreset,
  ModId,
  ModInfo,
  ModeId,
  ModeInfo,
  ModuleId,
  Settings,
  SkillId,
} from './types';

export const PLAYFIELD = { width: 1000, height: 625 } as const;
export const PLAYFIELD_CENTER = { x: 500, y: 312.5 } as const;
/** Visual radius of a spinner, playfield units. */
export const SPINNER_RADIUS = 240;

/** Shape of GeneratedMap. */
export const MAP_FORMAT = 1;
/** Shape of HitRecord and PlayResult. Bump with a migration when either changes. */
export const RECORD_VERSION = 1;

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

const ALL_MODS: ModId[] = ['fade', 'spotlight', 'fast', 'slow', 'tight', 'wide', 'mirror', 'nofail', 'onelife'];
const MODULE_MODS: ModId[] = ['fade', 'spotlight', 'mirror'];

export const MODS: Record<ModId, ModInfo> = {
  fade: {
    id: 'fade',
    label: 'Fade',
    description: "Targets fade out before you hit them, and there's no approach ring.",
    multiplier: 1.05,
    conflicts: [],
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
};

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
};

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

export const DEFAULT_SETTINGS: Settings = {
  v: 1,
  input: { rawInput: false, sensitivity: 1, keys: ['KeyZ', 'KeyX'], mouseButtons: true, cursor: 'system', cursorScale: 1, cursorTrail: false },
  audio: { master: 0.6, muted: false, hits: 0.8, effects: 0.8, ambient: 0.5 },
  display: { errorBar: true, pathHints: true, crispPopups: false, earlyLate: true, reduceMotion: false, lowLatency: true, showFps: false },
  data: { detailRetentionDays: 365 },
  updatedAt: 0,
};

/* ------------------------------------------------------------ demand */
/* Raw demand per object, and anchors that map raw demand to the level scale (Level N preset = N). */

/** Raw demand at Dynamic levels 1..8. aim is an estimate until calibrated (plan step 3); the rest follow from the presets. */
export const DEMAND_ANCHORS: Record<SkillId, readonly number[]> = {
  aim: [2.9, 3.8, 4.6, 5.5, 6.6, 7.9, 9.5, 11.5], // bits per second
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
  return (1000 / approachMs) * (1 + (mods.includes('fade') ? 0.5 : 0) + (mods.includes('spotlight') ? 0.3 : 0));
}
export function spinDemand(rotationsRequired: number, durationMs: number): number {
  return rotationsRequired / (durationMs / 60000);
}
