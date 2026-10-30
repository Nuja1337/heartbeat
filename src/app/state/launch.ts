// Builds LaunchRequests and starts plays.

import type { NavigateFunction } from 'react-router';
import { currentLevels } from '../../data/progress';
import { DEFAULT_DIFFICULTY, LEVEL_PRESETS, MODES, MODS } from '../../shared/catalog';
import { ShareCodeError, decodeShare } from '../../shared/codes';
import type { DifficultySettings, LaunchRequest, ModId, ModeId, ModuleId, ModuleOptions, ObjectFeatures, PlayableMap } from '../../shared/types';

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

/** The setup screen a launch came from. Placement has no setup of its own, so it goes back to Train. */
export function setupPath(launch: LaunchRequest): string {
  if (launch.modeId === 'dynamic') return '/play';
  return launch.modeId === 'placement' ? '/train' : `/train/${launch.modeId}`;
}

/** The map behind the skin preview in Settings. It is fixed, so the preview looks the same every time. */
export const SKIN_PREVIEW = { presetLevel: 3, seed: 1, lengthSec: 30 } as const;

export function skinPreviewLaunch(): LaunchRequest {
  return dynamicLaunch({
    presetLevel: SKIN_PREVIEW.presetLevel,
    difficulty: presetDifficulty(SKIN_PREVIEW.presetLevel),
    mods: [],
    lengthSec: SKIN_PREVIEW.lengthSec,
    seed: SKIN_PREVIEW.seed,
    levels: {},
  });
}

export const PLACEMENT_LENGTH_SEC = 240;

/** The placement test. It is not one of the Train modes, so it is built here and not from a setup screen. */
export function placementLaunch(levels: Partial<Record<ModuleId, number>>, seed: number = randomSeed()): LaunchRequest {
  return {
    modeId: 'placement',
    difficulty: { ...DEFAULT_DIFFICULTY },
    presetLevel: null,
    options: {},
    mods: [],
    seed,
    lengthSec: PLACEMENT_LENGTH_SEC,
    levels,
    drillId: null,
  };
}

/* ------------------------------------------------------------ share links */

/** What the setup screens read from the router state when a share link opened them. */
export interface SharedState {
  prefill: LaunchRequest;
  /** The generator version the link was made with. */
  shared: { generatorVersion: number };
}

export type ShareLink =
  | { ok: true; launch: LaunchRequest; generatorVersion: number; path: string }
  | { ok: false; kind: 'invalid' | 'newer'; message: string };

/**
 * Reads the code of a /s/:code link. The launch has no levels and no drill, because a code never carries them.
 * The setup screen at `path` fills the levels from the receiver's own progress when the play starts.
 */
export function readShareLink(code: string | undefined): ShareLink {
  try {
    const { launch, generatorVersion } = decodeShare((code ?? '').trim());
    const modeId = launch.modeId!;
    const full: LaunchRequest = {
      modeId,
      difficulty: launch.difficulty ?? { ...DEFAULT_DIFFICULTY },
      presetLevel: launch.presetLevel ?? null,
      options: launch.options ?? {},
      mods: launch.mods ?? [],
      seed: launch.seed ?? 0,
      lengthSec: launch.lengthSec ?? MODES[modeId].defaultLengthSec,
      levels: {},
      drillId: null,
    };
    return { ok: true, launch: full, generatorVersion, path: setupPath(full) };
  } catch (e) {
    const kind = e instanceof ShareCodeError ? e.kind : 'invalid';
    return { ok: false, kind, message: new ShareCodeError(kind).message };
  }
}

/** The shared launch in the router state, when a share link opened the screen for this mode. */
export function sharedFrom(state: unknown, modeId: ModeId): SharedState | null {
  const s = state as Partial<SharedState> | null | undefined;
  if (!s || !s.prefill || s.prefill.modeId !== modeId || !s.shared || typeof s.shared.generatorVersion !== 'number') return null;
  return { prefill: s.prefill, shared: s.shared };
}

/* -------------------------------------------------------------- map stats */

export interface MapStats {
  objects: number;
  /** Objects per minute of the map. */
  perMinute: number;
  /** Taps in the longest run of three or more objects with equal gaps under 160 ms. 0 when there is none. */
  longestStream: number;
  sliders: number;
  spinners: number;
}

export function mapStats(map: Pick<PlayableMap, 'objects' | 'durationMs'>, features: readonly ObjectFeatures[]): MapStats {
  let sliders = 0;
  let spinners = 0;
  for (const o of map.objects) {
    if (o.kind === 'slider') sliders += 1;
    else if (o.kind === 'spinner') spinners += 1;
  }
  let longestStream = 0;
  for (const f of features) longestStream = Math.max(longestStream, f.runLength);
  const minutes = map.durationMs / 60_000;
  return {
    objects: map.objects.length,
    perMinute: minutes > 0 ? Math.round(map.objects.length / minutes) : 0,
    longestStream,
    sliders,
    spinners,
  };
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
