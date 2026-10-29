// Module levels. They change only after plays with no mods, or with Mirror alone, so a Fade or
// Spotlight set doesn't pull the player's level around.

import { countsForProgress } from '../analytics/bests';
import { DEFAULT_MODULE_LEVEL, LEVEL_LIMITS, MODULE_IDS } from '../shared/catalog';
import type { ModuleId, PlayResult } from '../shared/types';
import { getAll, req, withTx } from './db';
import type { ProgressRow } from './schema';

/** The progress rows after a play. Returns only the rows that changed. */
export function applyPlayToProgress(
  existing: Partial<Record<ModuleId, ProgressRow>>,
  result: Pick<PlayResult, 'launch' | 'finalLevels' | 'endedAt'>,
): ProgressRow[] {
  if (!countsForProgress(result.launch.mods)) return [];
  const out: ProgressRow[] = [];
  for (const id of MODULE_IDS) {
    const level = result.finalLevels[id];
    if (level === undefined || !Number.isFinite(level)) continue;
    const clamped = Math.min(LEVEL_LIMITS.max, Math.max(LEVEL_LIMITS.min, level));
    const prev = existing[id];
    out.push({
      moduleId: id,
      level: clamped,
      bestLevel: Math.max(prev?.bestLevel ?? 0, clamped),
      sessions: (prev?.sessions ?? 0) + 1,
      updatedAt: result.endedAt,
    });
  }
  return out;
}

export async function loadProgress(): Promise<Partial<Record<ModuleId, ProgressRow>>> {
  const rows = await withTx('progress', 'readonly', (tx) => getAll<ProgressRow>(tx, 'progress'));
  const out: Partial<Record<ModuleId, ProgressRow>> = {};
  for (const r of rows) out[r.moduleId] = r;
  return out;
}

export async function getProgressRow(id: ModuleId): Promise<ProgressRow | undefined> {
  return withTx('progress', 'readonly', (tx) => req<ProgressRow | undefined>(tx.objectStore('progress').get(id)));
}

/** Levels to pass in a LaunchRequest. Modules without a row are left out. */
export function levelsFromProgress(progress: Partial<Record<ModuleId, ProgressRow>>): Partial<Record<ModuleId, number>> {
  const out: Partial<Record<ModuleId, number>> = {};
  for (const id of MODULE_IDS) {
    const row = progress[id];
    if (row) out[id] = row.level;
  }
  return out;
}

export function levelOf(progress: Partial<Record<ModuleId, ProgressRow>>, id: ModuleId): number {
  return progress[id]?.level ?? DEFAULT_MODULE_LEVEL;
}

/** Module levels read straight from the store, for building a launch. Rejects if the store can't be read. */
export async function currentLevels(): Promise<Partial<Record<ModuleId, number>>> {
  return levelsFromProgress(await loadProgress());
}
