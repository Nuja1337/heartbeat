// Share codes and the daily seed (PLAN-2 4.8, 4.9 and 4.11). Pure: no browser, game or app imports.
//
// A share code is base64url without padding over a small byte record. The decoder checks the version, the
// checksum and the canonical form, clamps difficulty values, snaps the length and drops mods the mode does not allow.

import {
  DEFAULT_DIFFICULTY,
  DIFFICULTY_KEYS,
  DIFFICULTY_LIMITS,
  LEVEL_PRESETS,
  MODES,
  MODE_ORDER,
  MODS,
  MODULE_IDS,
  SHARE_CODE_VERSION,
  SHARE_MODE_ORDER,
  SHARE_MOD_ORDER,
} from './catalog';
import type { DifficultySettings, LaunchRequest, ModId, ModeId, ModuleId, ModuleOptions } from './types';

export class ShareCodeError extends Error {
  readonly kind: 'invalid' | 'newer';
  constructor(kind: 'invalid' | 'newer') {
    super(kind === 'newer' ? 'This code was made by a newer version of Heartbeat.' : "This code isn't valid.");
    this.name = 'ShareCodeError';
    this.kind = kind;
  }
}

const invalid = (): ShareCodeError => new ShareCodeError('invalid');

/* ---------------------------------------------------------------- base64url */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(bytes: readonly number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2]!;
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]!;
    if (b1 !== undefined) out += B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]!;
    if (b2 !== undefined) out += B64[b2 & 63]!;
  }
  return out;
}

/** null for anything that is not base64url without padding. Spare bits at the end are ignored here; the caller re-encodes. */
function fromBase64Url(text: string): number[] | null {
  if (text.length === 0 || text.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i++) {
    acc = (acc << 6) | B64.indexOf(text[i]!);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
      acc &= (1 << bits) - 1;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ tables */

const ENUMS = {
  distanceFocus: ['mixed', 'short', 'long'],
  angleFocus: ['mixed', 'sharp', 'wide'],
  streamLength: ['short', 'medium', 'long'],
  sliderFocus: ['mixed', 'straight', 'curves', 'repeats'],
} as const;
type EnumKey = keyof typeof ENUMS;

const FLAG_PRESET = 1;
const FLAG_OPTIONS = 2;
const HEADER_BYTES = 12;
const NO_DIRECTION = 255;
const MIX_COUNT = { min: 2, max: 4 } as const;

/* ------------------------------------------------------------- shared logic */

/** Keeps mods the mode allows and drops one of each conflicting pair. A pure copy of cleanMods in src/app/state/launch.ts. */
export function cleanMods(mods: readonly ModId[], modeId: ModeId): ModId[] {
  const allowed = MODES[modeId].allowedMods;
  const out: ModId[] = [];
  for (const m of mods) {
    if (!allowed.includes(m) || out.includes(m)) continue;
    if (MODS[m].conflicts.some((c) => out.includes(c))) continue;
    out.push(m);
  }
  return out;
}

/** The option closest to `sec`. A tie goes to the longer option. */
function snapTo(sec: number, options: readonly number[]): number {
  return options.reduce(
    (best, o) => (Math.abs(o - sec) < Math.abs(best - sec) || (Math.abs(o - sec) === Math.abs(best - sec) && o > best) ? o : best),
    options[0]!,
  );
}

function clampDifficulty(raw: DifficultySettings): DifficultySettings {
  const out = {} as DifficultySettings;
  for (const key of DIFFICULTY_KEYS) {
    const { min, max, step } = DIFFICULTY_LIMITS[key];
    const v = Number.isFinite(raw[key]) ? raw[key] : min;
    out[key] = Math.min(max, Math.max(min, min + Math.round((v - min) / step) * step));
  }
  return out;
}

const customOffsets = { radius: 30, approachMs: 300, bpm: 90 } as const;
const customScale = { approachMs: 10 } as const;

const u8 = (n: number): number => Math.min(255, Math.max(0, Math.round(n)));

function checksum(bytes: readonly number[]): number {
  let sum = 0;
  for (const b of bytes) sum = (sum + b) & 255;
  return sum ^ 0xa5;
}

/* ------------------------------------------------------------------ encode */

/**
 * The share code of a launch. Dynamic with an integer `presetLevel` of 1 to 8 stores the preset, otherwise the
 * difficulty (clamped to DIFFICULTY_LIMITS and snapped to its step). Levels, the drill and the source are not stored.
 * Throws RangeError for a generator version outside 0..255, an unknown mode, or a Mix with fewer than 2 or more than 4 modules.
 */
export function encodeShare(launch: LaunchRequest, generatorVersion: number): string {
  const modeIndex = SHARE_MODE_ORDER.indexOf(launch.modeId);
  if (modeIndex < 0) throw new RangeError(`Unknown mode ${launch.modeId}`);
  if (!Number.isInteger(generatorVersion) || generatorVersion < 0 || generatorVersion > 255) {
    throw new RangeError('generatorVersion must be an integer from 0 to 255');
  }
  const mode = MODES[launch.modeId];
  const dynamic = launch.modeId === 'dynamic';
  const preset =
    dynamic && launch.presetLevel !== null && Number.isInteger(launch.presetLevel) && launch.presetLevel >= 1 && launch.presetLevel <= LEVEL_PRESETS.length;
  const hasOptions = mode.options.length > 0;

  const seed = launch.seed >>> 0;
  const length = Math.min(65535, Math.max(0, Math.round(launch.lengthSec)));
  let mask = 0;
  for (const m of launch.mods) {
    const i = SHARE_MOD_ORDER.indexOf(m);
    if (i >= 0) mask |= 1 << i;
  }

  const bytes: number[] = [
    SHARE_CODE_VERSION,
    modeIndex,
    (preset ? FLAG_PRESET : 0) | (hasOptions ? FLAG_OPTIONS : 0),
    seed & 255,
    (seed >>> 8) & 255,
    (seed >>> 16) & 255,
    (seed >>> 24) & 255,
    length & 255,
    length >> 8,
    mask & 255,
    mask >> 8,
    generatorVersion,
  ];

  if (dynamic) {
    if (preset) {
      bytes.push(launch.presetLevel!);
    } else {
      const d = clampDifficulty(launch.difficulty);
      for (const key of DIFFICULTY_KEYS) {
        const offset = key in customOffsets ? customOffsets[key as keyof typeof customOffsets] : 0;
        const scale = key in customScale ? customScale[key as keyof typeof customScale] : 1;
        bytes.push(u8((d[key] - offset) / scale));
      }
    }
  }

  if (hasOptions) {
    const options: ModuleOptions = { ...mode.defaultOptions, ...launch.options };
    for (const key of mode.options) {
      if (key === 'directionFocus') {
        const v = options.directionFocus;
        bytes.push(v === null || v === undefined ? NO_DIRECTION : Math.min(7, Math.max(0, Math.round(v))));
      } else if (key === 'mixModules') {
        const list = options.mixModules ?? [];
        if (list.length < MIX_COUNT.min || list.length > MIX_COUNT.max) throw new RangeError('A Mix needs 2 to 4 modules');
        bytes.push(list.length);
        for (const id of list) {
          const i = MODULE_IDS.indexOf(id);
          if (i < 0) throw new RangeError(`Unknown module ${id}`);
          bytes.push(i);
        }
      } else {
        const table: readonly string[] = ENUMS[key as EnumKey];
        const i = table.indexOf(String(options[key]));
        bytes.push(i < 0 ? 0 : i);
      }
    }
  }

  bytes.push(checksum(bytes));
  return toBase64Url(bytes);
}

/* ------------------------------------------------------------------ decode */

/**
 * Reads a share code. Throws ShareCodeError ('invalid' for a damaged or non-canonical code, an unknown mode,
 * Placement or a bad field; 'newer' for a newer code version).
 * The launch has no `levels`, `drillId` or `source`: the receiver adds them. Module codes carry no levels.
 */
export function decodeShare(code: string): { launch: Partial<LaunchRequest>; generatorVersion: number } {
  const bytes = fromBase64Url(code);
  if (!bytes || bytes.length < HEADER_BYTES + 1) throw invalid();
  // A code is only called newer when it is well formed: canonical text and a checksum byte that matches. Garbage and
  // damaged codes have an arbitrary first byte, so they are invalid whatever that byte says.
  if (toBase64Url(bytes) !== code) throw invalid();
  if (checksum(bytes.slice(0, -1)) !== bytes[bytes.length - 1]) throw invalid();
  const version = bytes[0]!;
  if (version > SHARE_CODE_VERSION) throw new ShareCodeError('newer');
  if (version !== SHARE_CODE_VERSION) throw invalid();

  const end = bytes.length - 1;
  let at = HEADER_BYTES;
  const take = (): number => {
    if (at >= end) throw invalid();
    return bytes[at++]!;
  };

  const modeId = SHARE_MODE_ORDER[bytes[1]!];
  if (modeId === undefined || !MODE_ORDER.includes(modeId)) throw invalid();
  const mode = MODES[modeId];
  const flags = bytes[2]!;
  const dynamic = modeId === 'dynamic';
  const hasOptions = mode.options.length > 0;
  if ((flags & ~(FLAG_PRESET | FLAG_OPTIONS)) !== 0) throw invalid();
  if ((flags & FLAG_PRESET) !== 0 && !dynamic) throw invalid();
  if (((flags & FLAG_OPTIONS) !== 0) !== hasOptions) throw invalid();

  const seed = (bytes[3]! | (bytes[4]! << 8) | (bytes[5]! << 16) | (bytes[6]! << 24)) >>> 0;
  const lengthSec = snapTo(bytes[7]! | (bytes[8]! << 8), mode.lengthOptions);
  const mask = bytes[9]! | (bytes[10]! << 8);
  const generatorVersion = bytes[11]!;
  const mods = cleanMods(SHARE_MOD_ORDER.filter((_, i) => (mask & (1 << i)) !== 0), modeId);

  let difficulty: DifficultySettings = { ...DEFAULT_DIFFICULTY };
  let presetLevel: number | null = null;
  if (dynamic) {
    if ((flags & FLAG_PRESET) !== 0) {
      presetLevel = take();
      const preset = LEVEL_PRESETS[presetLevel - 1];
      if (!preset) throw invalid();
      difficulty = { ...preset.difficulty };
    } else {
      const raw = {} as DifficultySettings;
      for (const key of DIFFICULTY_KEYS) {
        const offset = key in customOffsets ? customOffsets[key as keyof typeof customOffsets] : 0;
        const scale = key in customScale ? customScale[key as keyof typeof customScale] : 1;
        raw[key] = take() * scale + offset;
      }
      difficulty = clampDifficulty(raw);
    }
  }

  const options: ModuleOptions = {};
  if (hasOptions) {
    for (const key of mode.options) {
      if (key === 'directionFocus') {
        const v = take();
        if (v !== NO_DIRECTION && v > 7) throw invalid();
        options.directionFocus = v === NO_DIRECTION ? null : v;
      } else if (key === 'mixModules') {
        const n = take();
        if (n < MIX_COUNT.min || n > MIX_COUNT.max) throw invalid();
        const list: ModuleId[] = [];
        for (let i = 0; i < n; i++) {
          const id = MODULE_IDS[take()];
          if (id === undefined) throw invalid();
          list.push(id);
        }
        options.mixModules = list;
      } else {
        const value = ENUMS[key as EnumKey][take()];
        if (value === undefined) throw invalid();
        (options as Record<string, unknown>)[key] = value;
      }
    }
  }
  if (at !== end) throw invalid();

  return { launch: { modeId, difficulty, presetLevel, options, mods, seed, lengthSec }, generatorVersion };
}

/* -------------------------------------------------------------- daily seed */

/** FNV-1a 32 over UTF-16 code units. */
function fnv1a32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The seed of the daily map. `date` is a localDateKey. */
export function dailySeed(date: string): number {
  // The salt keeps the old app name on purpose: changing it would change every daily map.
  return fnv1a32('flickwise-daily:' + date);
}

/** YYYY-MM-DD from the local date parts of an epoch time. */
export function localDateKey(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number, w: number): string => String(n).padStart(w, '0');
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
}
