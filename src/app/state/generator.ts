// The map generator version of this build. It lives in the game chunk, which the app only loads on demand,
// so screens that need it for a note ask for it here and show the note once the game is in.

import { useEffect, useState } from 'react';
import { msg } from '../i18n';
import { loadGame } from './engine';

export const OLD_GENERATOR_NOTE = msg('This play used an older map generator, so this seed now makes a different map.');

/** The current generator version, or null until the game has loaded. */
export function useGeneratorVersion(): number | null {
  const [version, setVersion] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    loadGame().then(
      (g) => alive && setVersion(g.GENERATOR_VERSION),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  return version;
}

/** True when a play was made with another generator version than this build's. */
export const isOlderGenerator = (playVersion: number, current: number | null): boolean => current !== null && playVersion !== current;
