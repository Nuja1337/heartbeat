// Settings storage. Stored values are merged over the defaults and clamped, so a missing or
// out-of-range field never reaches the game.

import { DEFAULT_SETTINGS } from '../shared/catalog';
import type { Settings } from '../shared/types';
import { req, withTx } from './db';

const clamp = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

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
  const dt = r.data ?? {};
  const keys = Array.isArray(i.keys) && i.keys.length === 2 && i.keys.every((k) => typeof k === 'string' && k.length > 0)
    ? ([i.keys[0], i.keys[1]] as [string, string])
    : ([...d.input.keys] as [string, string]);
  const retention = dt.detailRetentionDays;
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
      retryKey: d.input.retryKey, // TODO next builder: sanitize per PLAN-2 4.6
    },
    audio: {
      master: clamp(a.master, 0, 1, d.audio.master),
      muted: bool(a.muted, d.audio.muted),
      hits: clamp(a.hits, 0, 1, d.audio.hits),
      effects: clamp(a.effects, 0, 1, d.audio.effects),
      ambient: clamp(a.ambient, 0, 1, d.audio.ambient),
      soundSet: d.audio.soundSet,
      metronome: d.audio.metronome,
      metronomeVolume: d.audio.metronomeVolume,
      offsetMs: d.audio.offsetMs,
    },
    display: {
      errorBar: bool(p.errorBar, d.display.errorBar),
      pathHints: bool(p.pathHints, d.display.pathHints),
      crispPopups: bool(p.crispPopups, d.display.crispPopups),
      earlyLate: bool(p.earlyLate, d.display.earlyLate),
      reduceMotion: bool(p.reduceMotion, d.display.reduceMotion),
      lowLatency: bool(p.lowLatency, d.display.lowLatency),
      showFps: bool(p.showFps, d.display.showFps),
      visualOffsetMs: d.display.visualOffsetMs,
      frameGraph: d.display.frameGraph,
    },
    skin: { ...d.skin },
    goals: { ...d.goals },
    data: {
      detailRetentionDays:
        retention === null ? null : typeof retention === 'number' && retention >= 1 ? Math.floor(retention) : d.data.detailRetentionDays,
      replayLimit: d.data.replayLimit,
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
