// The game is only ever imported dynamically, so it stays out of the entry chunk (PLAN-2 §8.1).

import { useEffect, useState } from 'react';

export type GameModule = typeof import('../../game/index');

let loading: Promise<GameModule> | null = null;

/** Starts loading the game once. A failed load can be tried again. */
export function loadGame(): Promise<GameModule> {
  loading ??= import('../../game/index').catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** The game module once it has loaded. `failed` is true when the load did not work. */
export function useGame(): { game: GameModule | null; failed: boolean } {
  const [state, setState] = useState<{ game: GameModule | null; failed: boolean }>({ game: null, failed: false });
  useEffect(() => {
    let alive = true;
    loadGame().then(
      (game) => alive && setState({ game, failed: false }),
      () => alive && setState({ game: null, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
