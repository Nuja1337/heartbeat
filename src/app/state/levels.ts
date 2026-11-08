import { useEffect, useState } from 'react';
import { currentLevels } from '../../data/progress';
import type { ModuleId } from '../../shared/types';
import { t } from '../i18n';

export type Levels = Partial<Record<ModuleId, number>>;

/**
 * Module levels read from the progress store when the screen opens. `levels` stays null until the read
 * has finished, so a launch is never built from a guess. `error` is set if the store can't be read.
 */
export function useCurrentLevels(): { levels: Levels | null; error: string | null } {
  const [state, setState] = useState<{ levels: Levels | null; error: string | null }>({ levels: null, error: null });
  useEffect(() => {
    let alive = true;
    currentLevels().then(
      (levels) => alive && setState({ levels, error: null }),
      (e: unknown) => alive && setState({ levels: null, error: e instanceof Error ? e.message : t('Could not read your module levels.') }),
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
