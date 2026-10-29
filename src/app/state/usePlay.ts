import { useEffect, useState } from 'react';
import { getRecords, getSummary } from '../../data/plays';
import type { PlaySummary } from '../../data/schema';
import type { HitRecord } from '../../shared/types';

export interface LoadedPlay {
  summary: PlaySummary;
  /** null when the per-object detail has been removed. */
  records: HitRecord[] | null;
}

/** Loads one play. `missing` is true when no play has this id. */
export function usePlay(id: string | undefined): { play: LoadedPlay | null; missing: boolean; error: string | null } {
  const [state, setState] = useState<{ id: string | undefined; play: LoadedPlay | null; missing: boolean; error: string | null }>({
    id,
    play: null,
    missing: false,
    error: null,
  });

  useEffect(() => {
    let alive = true;
    if (!id) return;
    (async () => {
      try {
        const summary = await getSummary(id);
        if (!alive) return;
        if (!summary) {
          setState({ id, play: null, missing: true, error: null });
          return;
        }
        const records = summary.hasDetail ? await getRecords(id) : null;
        if (alive) setState({ id, play: { summary, records }, missing: false, error: null });
      } catch (e) {
        if (alive) setState({ id, play: null, missing: false, error: e instanceof Error ? e.message : 'Could not read this play.' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  return state.id === id ? { play: state.play, missing: state.missing, error: state.error } : { play: null, missing: false, error: null };
}
