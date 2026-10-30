// Chooses the real game or the fake one. The fake game exists in dev builds only.

import type { CreateGame } from '../../shared/types';
import { loadGame } from '../state/engine';

// Keeps the old app name on purpose, like the other fw- keys.
const KEY = 'fw-fake';

/** ?fake=1 turns fake mode on for this tab. It stays on until the tab closes. */
export function isFakeMode(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    if (new URLSearchParams(window.location.search).get('fake') === '1') sessionStorage.setItem(KEY, '1');
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export async function pickCreateGame(): Promise<CreateGame> {
  // The DEV check sits here, not only in isFakeMode, so the build drops the fake game entirely.
  if (import.meta.env.DEV && isFakeMode()) {
    const { createFakeGame } = await import('./fakeGame');
    return createFakeGame;
  }
  return (await loadGame()).createGame;
}
