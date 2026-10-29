// Settings storage. Stored values are merged over the defaults and clamped, so a missing or
// out-of-range field never reaches the game.

import { DEFAULT_SETTINGS, PALETTES, REPLAY_LIMIT_CHOICES, SETTING_RANGES, SOUND_SETS } from '../shared/catalog';
import type { ApproachStyle, CursorStyle, MetronomeMode, PaletteId, Settings, SoundSetId } from '../shared/types';
import { req, withTx } from './db';

const clamp = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** One of the listed values, or the fallback. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/**
 * Clamps to the range and rounds to the step as a whole count of steps, so 0.15 stays exactly 0.15
 * instead of 0.15000000000000002.
 */
export function stepped(v: unknown, range: { min: number; max: number; step: number }, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const clamped = Math.min(range.max, Math.max(range.min, v));
  const count = Math.round(clamped / range.step);
  return Math.min(range.max, Math.max(range.min, Number((count * range.step).toFixed(2))));
}

const CURSOR_STYLES: readonly CursorStyle[] = ['ring', 'cross', 'dot'];
const APPROACH_STYLES: readonly ApproachStyle[] = ['ring', 'fill', 'brackets'];
const METRONOME_MODES: readonly MetronomeMode[] = ['off', 'beat', 'bar'];
const PALETTE_IDS = Object.keys(PALETTES) as PaletteId[];
const SOUND_SET_IDS = Object.keys(SOUND_SETS) as SoundSetId[];

export const RETENTION_CHOICES: (number | null)[] = [30, 90, 365, null];

export function cloneSettings(s: Settings): Settings {
  return {
    ...s,
    input: { ...s.input, keys: [...s.input.keys] as [string, string] },
    audio: { ...s.audio },
    display: { ...s.display },
    skin: { ...s.skin },
    goals: { ...s.goals },
    data: { ...s.data },
  };
}

export function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const r = (raw ?? {}) as Partial<Record<keyof Settings, Record<string, unknown>>>;
  const i = r.input ?? {};
  const a = r.audio ?? {};
  const p = r.display ?? {};
  const sk = r.skin ?? {};
  const g = r.goals ?? {};
  const dt = r.data ?? {};
  const keys = Array.isArray(i.keys) && i.keys.length === 2 && i.keys.every((k) => typeof k === 'string' && k.length > 0)
    ? ([i.keys[0], i.keys[1]] as [string, string])
    : ([...d.input.keys] as [string, string]);
  const retention = dt.detailRetentionDays;
  // A missing retry key takes the default. A stored one that is empty, Escape or a hit key turns the key off.
  const retryRaw = i.retryKey === undefined ? d.input.retryKey : i.retryKey;
  const retryKey =
    typeof retryRaw === 'string' && retryRaw !== '' && retryRaw !== 'Escape' && retryRaw !== keys[0] && retryRaw !== keys[1] ? retryRaw : '';
  const replayLimit = (REPLAY_LIMIT_CHOICES as readonly unknown[]).includes(dt.replayLimit) ? (dt.replayLimit as number | null) : 100;
  return {
    v: 1,
    input: {
      rawInput: bool(i.rawInput, d.input.rawInput),
      sensitivity: clamp(i.sensitivity, 0.1, 5, d.input.sensitivity),
      keys,
      mouseButtons: bool(i.mouseButtons, d.input.mouseButtons),
      cursor: i.cursor === 'drawn' || i.cursor === 'system' ? i.cursor : d.input.cursor,
      cursorScale: clamp(i.cursorScale, 0.5, 2, d.input.cursorScale),
      cursorTrail: bool(i.cursorTrail, d.input.cursorTrail),
      retryKey,
    },
    audio: {
      master: clamp(a.master, 0, 1, d.audio.master),
      muted: bool(a.muted, d.audio.muted),
      hits: clamp(a.hits, 0, 1, d.audio.hits),
      effects: clamp(a.effects, 0, 1, d.audio.effects),
      ambient: clamp(a.ambient, 0, 1, d.audio.ambient),
      soundSet: oneOf(a.soundSet, SOUND_SET_IDS, d.audio.soundSet),
      metronome: oneOf(a.metronome, METRONOME_MODES, d.audio.metronome),
      metronomeVolume: stepped(a.metronomeVolume, SETTING_RANGES.metronomeVolume, d.audio.metronomeVolume),
      offsetMs: stepped(a.offsetMs, SETTING_RANGES.audioOffsetMs, d.audio.offsetMs),
    },
    display: {
      errorBar: bool(p.errorBar, d.display.errorBar),
      pathHints: bool(p.pathHints, d.display.pathHints),
      crispPopups: bool(p.crispPopups, d.display.crispPopups),
      earlyLate: bool(p.earlyLate, d.display.earlyLate),
      reduceMotion: bool(p.reduceMotion, d.display.reduceMotion),
      lowLatency: bool(p.lowLatency, d.display.lowLatency),
      showFps: bool(p.showFps, d.display.showFps),
      visualOffsetMs: stepped(p.visualOffsetMs, SETTING_RANGES.visualOffsetMs, d.display.visualOffsetMs),
      frameGraph: bool(p.frameGraph, d.display.frameGraph),
    },
    skin: {
      palette: oneOf(sk.palette, PALETTE_IDS, d.skin.palette),
      cursorStyle: oneOf(sk.cursorStyle, CURSOR_STYLES, d.skin.cursorStyle),
      approach: oneOf(sk.approach, APPROACH_STYLES, d.skin.approach),
      fieldGrid: bool(sk.fieldGrid, d.skin.fieldGrid),
      clickRipple: bool(sk.clickRipple, d.skin.clickRipple),
    },
    goals: { weeklyMinutes: stepped(g.weeklyMinutes, SETTING_RANGES.weeklyMinutes, d.goals.weeklyMinutes) },
    data: {
      detailRetentionDays:
        retention === null ? null : typeof retention === 'number' && retention >= 1 ? Math.floor(retention) : d.data.detailRetentionDays,
      replayLimit,
    },
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
  };
}

export async function loadSettings(): Promise<Settings> {
  const row = await withTx('settings', 'readonly', (tx) =>
    req<{ key: string; value: unknown } | undefined>(tx.objectStore('settings').get('settings')),
  );
  return sanitizeSettings(row?.value);
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  const next = { ...settings, updatedAt: Date.now() };
  await withTx('settings', 'readwrite', (tx) => {
    tx.objectStore('settings').put({ key: 'settings', value: next });
  });
  return next;
}
