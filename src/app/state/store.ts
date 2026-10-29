// App-wide state outside React: settings, remembered UI choices and storage problems.
// Components read it with useSyncExternalStore so the game never waits on a render.

import { useSyncExternalStore } from 'react';
import { onDbOutdated } from '../../data/db';
import { defaultUiPrefs, loadUiPrefs, saveUiPrefs } from '../../data/meta';
import type { UiPrefs } from '../../data/schema';
import { cloneSettings, loadSettings, saveSettings } from '../../data/settings';
import { DEFAULT_SETTINGS } from '../../shared/catalog';
import type { Settings } from '../../shared/types';

interface AppState {
  settings: Settings;
  prefs: UiPrefs;
  /** Set when the database could not be opened. The app still runs, without saving. */
  storageError: string | null;
  /** Another tab opened a newer version of the database. */
  outdated: boolean;
  ready: boolean;
}

let state: AppState = {
  settings: cloneSettings(DEFAULT_SETTINGS),
  prefs: defaultUiPrefs(),
  storageError: null,
  outdated: false,
  ready: false,
};
const listeners = new Set<() => void>();

function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const getAppState = (): AppState => state;
export const useAppState = (): AppState => useSyncExternalStore(subscribe, getAppState, getAppState);
export const getSettings = (): Settings => state.settings;

export function useSettings(): [Settings, (change: (s: Settings) => Settings) => void] {
  const s = useSyncExternalStore(subscribe, () => state.settings, () => state.settings);
  return [s, updateSettings];
}

export function updateSettings(change: (s: Settings) => Settings): void {
  const next = change(cloneSettings(state.settings));
  set({ settings: next });
  saveSettings(next).catch((e: unknown) => set({ storageError: e instanceof Error ? e.message : 'Could not save settings.' }));
}

export function usePrefs(): [UiPrefs, (change: (p: UiPrefs) => UiPrefs) => void] {
  const p = useSyncExternalStore(subscribe, () => state.prefs, () => state.prefs);
  return [p, updatePrefs];
}

export function updatePrefs(change: (p: UiPrefs) => UiPrefs): void {
  const next = change(structuredClone(state.prefs));
  set({ prefs: next });
  saveUiPrefs(next).catch(() => undefined);
}

let booting: Promise<void> | null = null;

/** Loads settings and remembered choices once. Never rejects. */
export function boot(): Promise<void> {
  if (booting) return booting;
  onDbOutdated(() => set({ outdated: true }));
  booting = (async () => {
    try {
      const [settings, prefs] = await Promise.all([loadSettings(), loadUiPrefs()]);
      set({ settings, prefs, ready: true });
    } catch (e) {
      set({ storageError: e instanceof Error ? e.message : 'Could not open the database.', ready: true });
    }
  })();
  return booting;
}
