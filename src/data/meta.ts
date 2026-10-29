// Small key-value rows: device id, tier history, storage status and remembered UI choices.

import { DEFAULT_DIFFICULTY, MILESTONES } from '../shared/catalog';
import { localDateKey } from '../shared/codes';
import type { MilestoneId } from '../shared/types';
import { req, withTx } from './db';
import type { DailyPlan, InsightSnooze, MetaRow, Milestones, Onboarding, PersistStatus, TierHistory, UiPrefs } from './schema';

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return withTx('meta', 'readonly', async (tx) => {
    const row = await req<MetaRow | undefined>(tx.objectStore('meta').get(key));
    return row?.value as T | undefined;
  });
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await withTx('meta', 'readwrite', (tx) => {
    tx.objectStore('meta').put({ key, value } satisfies MetaRow);
  });
}

/** The same device id for the life of this browser's data. */
export async function getDeviceId(): Promise<string> {
  const existing = await getMeta<string>('deviceId');
  if (existing) return existing;
  const id = crypto.randomUUID();
  await setMeta('deviceId', id);
  await setMeta('createdAt', Date.now());
  return id;
}

export const getTierHistory = async (): Promise<TierHistory> => (await getMeta<TierHistory>('tiers')) ?? {};
export const setTierHistory = (h: TierHistory) => setMeta('tiers', h);

/* Milestones: the first time each was reached. */

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keeps the entries that have a known id and a finite `at`. */
export function cleanMilestones(raw: unknown): Milestones {
  const out: Milestones = {};
  if (!isObject(raw)) return out;
  for (const [id, entry] of Object.entries(raw)) {
    if (!(id in MILESTONES) || !isObject(entry) || typeof entry.at !== 'number' || !Number.isFinite(entry.at)) continue;
    out[id as MilestoneId] = { at: entry.at, playId: typeof entry.playId === 'string' ? entry.playId : null };
  }
  return out;
}

/** Union of two milestone sets. When both have one, the earliest `at` wins, like tiers. */
export function mergeMilestones(a: Milestones, b: Milestones): Milestones {
  const out: Milestones = { ...a };
  for (const [id, entry] of Object.entries(b) as [MilestoneId, Milestones[MilestoneId]][]) {
    if (!entry) continue;
    const prev = out[id];
    if (!prev || entry.at < prev.at) out[id] = entry;
  }
  return out;
}

export const getMilestones = async (): Promise<Milestones> => cleanMilestones(await getMeta('milestones'));
export const setMilestones = (m: Milestones) => setMeta('milestones', m);

/* Onboarding state. It survives "delete all data". */

export function cleanOnboarding(raw: unknown): Onboarding | undefined {
  if (!isObject(raw)) return undefined;
  return {
    done: raw.done === true,
    at: typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : null,
    input: raw.input === true,
    calibrated: raw.calibrated === true,
    placed: raw.placed === true,
  };
}

/** undefined when the player has not started onboarding. */
export const getOnboarding = async (): Promise<Onboarding | undefined> => cleanOnboarding(await getMeta('onboarding'));
export const setOnboarding = (o: Onboarding) => setMeta('onboarding', o);

/* Daily plans: one row per local date, under `plan:YYYY-MM-DD`. */

export const PLAN_PREFIX = 'plan:';
export const PLAN_KEEP_DAYS = 14;
/** Every plan key. */
export const planKeyRange = (): IDBKeyRange => IDBKeyRange.bound(PLAN_PREFIX, PLAN_PREFIX + '\uffff');
export const planKey = (date: string): string => PLAN_PREFIX + date;

export const getPlan = (date: string) => getMeta<DailyPlan>(planKey(date));
export const savePlan = (plan: DailyPlan) => setMeta(planKey(plan.date), plan);

/** Removes plans from days before the last 14. Call it at boot. Returns how many were removed. */
export async function prunePlans(now = Date.now()): Promise<number> {
  const oldest = localDateKey(now - PLAN_KEEP_DAYS * 86_400_000);
  return withTx('meta', 'readwrite', async (tx) => {
    const store = tx.objectStore('meta');
    const keys = (await req(store.getAllKeys(planKeyRange()))).map(String);
    const stale = keys.filter((k) => k.slice(PLAN_PREFIX.length) < oldest);
    for (const k of stale) store.delete(k);
    return stale.length;
  });
}

/* Insight snoozes: insight key to "hidden until", in epoch ms. */

export const getInsightSnooze = async (): Promise<InsightSnooze> => {
  const raw = await getMeta<unknown>('insightSnooze');
  const out: InsightSnooze = {};
  if (isObject(raw)) for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
};

/** Hides an insight until `until`. Entries that have already expired are dropped on the way. */
export async function snoozeInsight(key: string, until: number, now = Date.now()): Promise<InsightSnooze> {
  const next: InsightSnooze = {};
  for (const [k, v] of Object.entries(await getInsightSnooze())) if (v > now) next[k] = v;
  next[key] = until;
  await setMeta('insightSnooze', next);
  return next;
}

export const getPersistStatus = () => getMeta<PersistStatus>('persist');
export const getLastExport = () => getMeta<number>('lastExport');
export const setLastExport = (t: number) => setMeta('lastExport', t);

/** Asks the browser to keep the data. Does nothing if it was asked before. */
export async function requestPersistence(now = Date.now()): Promise<PersistStatus> {
  const before = await getPersistStatus();
  if (before?.requested) return before;
  let granted: boolean | null = null;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) granted = await navigator.storage.persist();
  } catch {
    granted = null;
  }
  const status: PersistStatus = { requested: true, granted, at: now };
  await setMeta('persist', status);
  return status;
}

export async function currentPersisted(): Promise<boolean | null> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persisted) return await navigator.storage.persisted();
  } catch {
    // ignore
  }
  return null;
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
    }
  } catch {
    // ignore
  }
  return null;
}

export function defaultUiPrefs(): UiPrefs {
  return {
    fullscreen: false,
    dynamic: { presetLevel: 4, difficulty: { ...DEFAULT_DIFFICULTY }, mods: [], lengthSec: null },
    modules: {},
    daily: { level: null },
    playback: { speed: 1 },
    installDismissed: false,
  };
}

export async function loadUiPrefs(): Promise<UiPrefs> {
  const stored = await getMeta<Partial<UiPrefs>>('ui');
  const base = defaultUiPrefs();
  if (!stored) return base;
  return {
    fullscreen: typeof stored.fullscreen === 'boolean' ? stored.fullscreen : base.fullscreen,
    dynamic: { ...base.dynamic, ...(stored.dynamic ?? {}) },
    modules: stored.modules ?? {},
    daily: {
      level:
        typeof stored.daily?.level === 'number' && Number.isFinite(stored.daily.level) ? stored.daily.level : base.daily.level,
    },
    playback: {
      speed:
        typeof stored.playback?.speed === 'number' && Number.isFinite(stored.playback.speed) && stored.playback.speed > 0
          ? stored.playback.speed
          : base.playback.speed,
    },
    installDismissed: typeof stored.installDismissed === 'boolean' ? stored.installDismissed : base.installDismissed,
  };
}

export const saveUiPrefs = (p: UiPrefs) => setMeta('ui', p);
