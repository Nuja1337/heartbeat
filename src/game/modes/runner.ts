// Builds the map and set controller for a launch (PLAN section 8).

import { DEFAULT_MODULE_LEVEL, MAP_FORMAT, MODES, MODULE_IDS } from '../../shared/catalog';
import type {
  GeneratedMap,
  HitObject,
  HitRecord,
  LaunchRequest,
  LevelStep,
  MapSection,
  ModId,
  ModuleId,
  Ms,
  PlayableMap,
} from '../../shared/types';
import type { SetController, SetEndInfo } from '../engine/session';
import { generateDynamic } from '../map/generator';
import { applyMods, applyModsToObjects, modsForMode, rateFor } from '../map/mods';
import { hash32 } from '../map/rng';
import { GENERATOR_VERSION } from '../version';
import { buildSet, clampLevel, paramsAtLevel, successShare } from './modules';
import type { BuiltSet } from './modules';
import { Staircase } from './staircase';

export interface PlaySetup {
  map: PlayableMap;
  controller: SetController | null;
  /** Length that feature progress is measured against. */
  progressMs: number;
}

/** Quiet time between sets, ms. */
export const SET_REST_MS = 1200;

function shell(launch: LaunchRequest, objects: HitObject[], sections: MapSection[], mods: ModId[]): PlayableMap {
  const last = objects[objects.length - 1];
  const end = last ? (last.kind === 'circle' ? last.time : last.endTime) : 0;
  const gen: GeneratedMap = {
    format: MAP_FORMAT,
    generatorVersion: GENERATOR_VERSION,
    seed: launch.seed >>> 0,
    modeId: launch.modeId,
    beatMs: 500,
    durationMs: end + 1000,
    health: null,
    objects,
    sections,
  };
  return { ...gen, mods, rate: 1 };
}

const leadIn = (approachMs: number) => Math.max(2000, approachMs + 1200);

/** Stamina and Warm-up: a fixed map made of chunks from other modules. */
function buildFixed(launch: LaunchRequest, mods: ModId[]): PlayableMap {
  const levels = launch.levels;
  const lvl = (m: ModuleId, drop: number) => clampLevel((levels[m] ?? DEFAULT_MODULE_LEVEL) - drop);
  type Chunk = { module: ModuleId; level: number; size: number };
  const chunks: Chunk[] =
    launch.modeId === 'stamina'
      ? [
          { module: 'streams', level: lvl('streams', 1), size: 20 },
          { module: 'jumps', level: lvl('jumps', 1), size: 8 },
        ]
      : [
          { module: 'jumps', level: lvl('jumps', 1.5), size: 10 },
          { module: 'streams', level: lvl('streams', 1.5), size: 24 },
          { module: 'tracking', level: lvl('tracking', 1.5), size: 4 },
          { module: 'precision', level: lvl('precision', 1.5), size: 8 },
        ];
  const objects: HitObject[] = [];
  const sections: MapSection[] = [];
  let groupBase = 0;
  const lengthMs = launch.lengthSec * 1000;
  let t = 0;
  for (let k = 0; k < 400; k++) {
    const c = chunks[k % chunks.length] as Chunk;
    const approach = paramsAtLevel(c.module, c.level).approachMs;
    const start = k === 0 ? leadIn(approach) : t + 500 + approach;
    if (k > 0 && start >= lengthMs - 3000) break;
    const built = buildSet({
      module: c.module,
      level: c.level,
      options: MODES[c.module].defaultOptions,
      set: -1,
      seed: hash32(launch.seed, 'chunk', k),
      startTime: start,
      indexBase: objects.length,
      groupBase,
      size: c.size,
    });
    if (built.objects.length === 0) break;
    objects.push(...built.objects);
    sections.push(built.section);
    groupBase += built.groupsUsed + 1;
    t = built.endTime;
  }
  return shell(launch, applyModsToObjects(objects, mods), sections, mods);
}

/** Adaptive modules and Mix. A set closes, the staircase moves, and the next set is built. */
export class ModeRunner implements SetController {
  readonly map: PlayableMap;
  private stairs = new Map<ModuleId, Staircase>();
  private steps: LevelStep[] = [];
  private playedLevel = new Map<number, number>();
  private modules: ModuleId[];
  private indexCount = 0;
  private groupCount = 0;
  private lastSet = 0;

  constructor(
    private launch: LaunchRequest,
    private mods: ModId[],
  ) {
    const mix = launch.modeId === 'mix';
    const chosen = launch.options.mixModules ?? (MODES.mix.defaultOptions.mixModules as ModuleId[]);
    const valid = chosen.filter((m, i) => MODULE_IDS.includes(m) && chosen.indexOf(m) === i).slice(0, 4);
    this.modules = mix ? (valid.length >= 2 ? valid : (MODES.mix.defaultOptions.mixModules as ModuleId[])) : [launch.modeId as ModuleId];
    for (const m of this.modules) this.stairs.set(m, Staircase.startFor(launch.levels[m], DEFAULT_MODULE_LEVEL));
    const first = this.build(0, 0);
    this.map = shell(launch, first.objects, [first.section], mods);
  }

  private moduleFor(set: number): ModuleId {
    return this.modules[set % this.modules.length] as ModuleId;
  }

  private build(set: number, startTime: Ms): BuiltSet {
    const module = this.moduleFor(set);
    const level = (this.stairs.get(module) as Staircase).level;
    this.playedLevel.set(set, level);
    this.lastSet = set;
    const approach = paramsAtLevel(module, level).approachMs;
    const spec = {
      module,
      level,
      options: { ...MODES[module].defaultOptions, ...this.launch.options },
      set,
      seed: hash32(this.launch.seed, set, Math.round(level * 20)),
      startTime: set === 0 ? leadIn(approach) : startTime + SET_REST_MS + approach,
      indexBase: this.indexCount,
      groupBase: this.groupCount,
    };
    const built = buildSet(spec);
    built.objects = applyModsToObjects(built.objects, this.mods);
    this.indexCount += built.objects.length;
    this.groupCount += built.groupsUsed + 1;
    return built;
  }

  closeSet(set: number, records: readonly HitRecord[], tClose: Ms): { objects: HitObject[] | null; info: SetEndInfo } {
    const module = this.moduleFor(set);
    const stair = this.stairs.get(module) as Staircase;
    const success = successShare(module, records);
    const played = this.playedLevel.get(set) ?? stair.level;
    const st = stair.update(success);
    this.steps.push({ set, module, level: played, success, objects: records.length });
    const info: SetEndInfo = { set, module, from: played, to: st.next, success, direction: st.direction };
    if (tClose >= this.launch.lengthSec * 1000) return { objects: null, info };
    const next = this.build(set + 1, tClose);
    if (next.objects.length === 0) return { objects: null, info };
    this.map.sections.push(next.section);
    return { objects: next.objects, info };
  }

  private statusObj = { level: 0, set: 0 };

  status(): { level: number; set: number } {
    const set = this.lastSet;
    this.statusObj.level = this.playedLevel.get(set) ?? 0;
    this.statusObj.set = set;
    return this.statusObj;
  }

  levelSteps(): LevelStep[] {
    return this.steps.slice();
  }

  finalLevels(): Partial<Record<ModuleId, number>> {
    const out: Partial<Record<ModuleId, number>> = {};
    for (const [m, s] of this.stairs) if (s.history.length > 0) out[m] = Math.round(s.finalLevel() * 100) / 100;
    return out;
  }
}

export function setupPlay(launch: LaunchRequest): PlaySetup {
  const mods = modsForMode(launch.modeId, launch.mods);
  const id = launch.modeId;
  if (id === 'dynamic') {
    const gen = generateDynamic(launch, rateFor(mods));
    const map = applyMods(gen, mods);
    return { map, controller: null, progressMs: map.durationMs };
  }
  if (id === 'stamina' || id === 'warmup') {
    const map = buildFixed(launch, mods);
    return { map, controller: null, progressMs: map.durationMs };
  }
  const runner = new ModeRunner(launch, mods);
  return { map: runner.map, controller: runner, progressMs: launch.lengthSec * 1000 };
}
