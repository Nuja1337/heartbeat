// Small key-value rows: device id, tier history, storage status and remembered UI choices.

import { DEFAULT_DIFFICULTY } from '../shared/catalog';
import { req, withTx } from './db';
import type { MetaRow, PersistStatus, TierHistory, UiPrefs } from './schema';

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
  };
}

export const saveUiPrefs = (p: UiPrefs) => setMeta('ui', p);
