// Builds LaunchRequests and starts plays.

import type { NavigateFunction } from 'react-router';
import { currentLevels } from '../../data/progress';
import { DEFAULT_DIFFICULTY, LEVEL_PRESETS, MODES, MODS } from '../../shared/catalog';
import type { DifficultySettings, LaunchRequest, ModId, ModeId, ModuleId, ModuleOptions } from '../../shared/types';

export function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]!;
}

/** Keeps mods the mode allows and drops one of each conflicting pair. */
export function cleanMods(mods: readonly ModId[], modeId: ModeId): ModId[] {
  const allowed = MODES[modeId].allowedMods;
  const out: ModId[] = [];
  for (const m of mods) {
    if (!allowed.includes(m) || out.includes(m)) continue;
    if (MODS[m].conflicts.some((c) => out.includes(c))) continue;
    out.push(m);
  }
  return out;
}

/** The length option closest to a preset's length. A tie goes to the longer option. */
export function snapLength(sec: number, options: readonly number[]): number {
  return options.reduce(
    (best, o) => (Math.abs(o - sec) < Math.abs(best - sec) || (Math.abs(o - sec) === Math.abs(best - sec) && o > best) ? o : best),
    options[0]!,
  );
}

export function presetDifficulty(level: number): DifficultySettings {
  return { ...(LEVEL_PRESETS[level - 1]?.difficulty ?? DEFAULT_DIFFICULTY) };
}

export function dynamicLaunch(input: {
  presetLevel: number | null;
  difficulty: DifficultySettings;
  mods: readonly ModId[];
  lengthSec: number;
  seed: number;
  levels: Partial<Record<ModuleId, number>>;
}): LaunchRequest {
  return {
    modeId: 'dynamic',
    difficulty: { ...input.difficulty },
    presetLevel: input.presetLevel,
    options: {},
    mods: cleanMods(input.mods, 'dynamic'),
    seed: input.seed,
    lengthSec: input.lengthSec,
    levels: input.levels,
    drillId: null,
  };
}

export function moduleLaunch(input: {
  modeId: ModeId;
  options: ModuleOptions;
  mods: readonly ModId[];
  lengthSec: number;
  seed: number;
  levels: Partial<Record<ModuleId, number>>;
  drillId: string | null;
}): LaunchRequest {
  return {
    modeId: input.modeId,
    difficulty: { ...DEFAULT_DIFFICULTY },
    presetLevel: null,
    options: { ...input.options },
    mods: cleanMods(input.mods, input.modeId),
    seed: input.seed,
    lengthSec: input.lengthSec,
    levels: input.levels,
    drillId: input.drillId,
  };
}

/** The setup screen a launch came from. */
export function setupPath(launch: LaunchRequest): string {
  return launch.modeId === 'dynamic' ? '/play' : `/train/${launch.modeId}`;
}

export interface SessionState {
  launch: LaunchRequest;
  /** Where Back and a discarded quit go. */
  from: string;
}

function enterFullscreen(fullscreen: boolean): void {
  if (fullscreen && document.fullscreenElement === null) {
    // Must run inside the click handler. A refusal is fine.
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  }
}

export function startPlay(navigate: NavigateFunction, launch: LaunchRequest, from: string, fullscreen: boolean): void {
  enterFullscreen(fullscreen);
  navigate('/session', { state: { launch, from } satisfies SessionState });
}

/**
 * Starts a play from an earlier launch with the module levels as they are now. The seed stays unless
 * `newSeed` is set. Rejects when the progress store can't be read, so the caller can say so.
 */
export async function startWithCurrentLevels(
  navigate: NavigateFunction,
  launch: LaunchRequest,
  from: string,
  fullscreen: boolean,
  newSeed: boolean,
): Promise<void> {
  enterFullscreen(fullscreen);
  const levels = await currentLevels();
  navigate('/session', { state: { launch: { ...launch, levels, seed: newSeed ? randomSeed() : launch.seed }, from } satisfies SessionState });
}
