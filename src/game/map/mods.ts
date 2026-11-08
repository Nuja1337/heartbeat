// Mods that change the map itself (PLAN section 9). Tight and Wide act earlier, in difficulty.ts.

import { MOD_RATE, MODES, PLAYFIELD } from '../../shared/catalog';
import type { GeneratedMap, HitObject, ModId, ModeId, PathSegment, PlayableMap, Vec2 } from '../../shared/types';

export function rateFor(mods: readonly ModId[]): number {
  if (mods.includes('fast')) return MOD_RATE.fast;
  if (mods.includes('slow')) return MOD_RATE.slow;
  return 1;
}

/** Keep only the mods a mode allows, in a stable order. */
export function modsForMode(modeId: ModeId, mods: readonly ModId[]): ModId[] {
  const allowed = MODES[modeId].allowedMods;
  return allowed.filter((m) => mods.includes(m));
}

const flipX = (v: Vec2): Vec2 => ({ x: PLAYFIELD.width - v.x, y: v.y });

function mirrorSegment(s: PathSegment): PathSegment {
  if (s.type === 'line') return { type: 'line', to: flipX(s.to) };
  if (s.type === 'arc') return { type: 'arc', through: flipX(s.through), to: flipX(s.to) };
  return { type: 'cubic', c1: flipX(s.c1), c2: flipX(s.c2), to: flipX(s.to) };
}

function cloneObject(o: HitObject, mirror: boolean, rate: number): HitObject {
  const base = { ...o, pos: mirror ? flipX(o.pos) : { x: o.pos.x, y: o.pos.y }, windows: { ...o.windows } };
  if (rate !== 1) {
    base.time = o.time / rate;
    base.approachMs = o.approachMs / rate;
  }
  if (base.kind === 'slider' && o.kind === 'slider') {
    if (mirror) base.path = o.path.map(mirrorSegment);
    else base.path = o.path.map((s) => ({ ...s }));
    if (rate !== 1) {
      base.velocity = o.velocity * rate;
      base.spanMs = o.spanMs / rate;
      base.endTime = base.time + base.spanMs * (o.repeats + 1);
    }
  } else if (base.kind === 'spinner' && o.kind === 'spinner' && rate !== 1) {
    base.endTime = o.endTime / rate;
  }
  return base as HitObject;
}

/** Copy objects with Mirror applied. Used for adaptive sets, which always play at rate 1. */
export function applyModsToObjects(objects: readonly HitObject[], mods: readonly ModId[]): HitObject[] {
  const mirror = mods.includes('mirror');
  return objects.map((o) => cloneObject(o, mirror, 1));
}

export function applyMods(map: GeneratedMap, mods: readonly ModId[]): PlayableMap {
  const rate = rateFor(mods);
  const mirror = mods.includes('mirror');
  const objects = map.objects.map((o) => cloneObject(o, mirror, rate));
  return {
    ...map,
    beatMs: map.beatMs / rate,
    ...(map.beatOffsetMs !== undefined ? { beatOffsetMs: map.beatOffsetMs / rate } : {}),
    durationMs: (map.durationMs - 1000) / rate + 1000,
    health: map.health ? { ...map.health, canFail: !mods.includes('nofail'), failOnFirstMiss: mods.includes('onelife') } : null,
    objects,
    sections: map.sections.map((s) => ({ ...s, start: s.start / rate, end: s.end / rate })),
    mods: [...mods],
    rate,
  };
}
