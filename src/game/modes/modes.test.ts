import { describe, expect, it } from 'vitest';
import {
  aimDemand,
  DEFAULT_MODULE_LEVEL,
  MODES,
  MODULE_IDS,
  PLACEMENT,
  rawDemandAt,
  readingDemand,
  speedDemand,
  spinDemand,
  timingDemand,
  trackingDemand,
  precisionDemand,
} from '../../shared/catalog';
import type { HitObject, ModeId, ModuleId, SliderObject, SpinnerObject } from '../../shared/types';
import { computeFeatures } from '../map/features';
import { createRng } from '../map/rng';
import { PERFECT_PLAYER, WEAK_PLAYER } from '../sim/autoplay';
import { runHeadless } from '../sim/headless';
import { launchFor } from '../testing/fixtures';
import { buildSet, isSuccess, maxLevelFor, paramsAtLevel, successShare } from './modules';
import { PLACEMENT_SETS, ringSetsFor, setupPlay } from './runner';
import { Staircase } from './staircase';

describe('Staircase', () => {
  it('starts half a level below the saved level', () => {
    expect(Staircase.startFor(5, 3).level).toBe(4.5);
    expect(Staircase.startFor(undefined, 3).level).toBe(2.5);
    expect(Staircase.startFor(1, 3).level).toBe(1);
  });

  it('moves by the step on each band', () => {
    const s = new Staircase(5);
    expect(s.update(0.9).next).toBe(5.5);
    expect(s.update(0.8).next).toBe(5.5);
    expect(s.update(0.6).next).toBe(5.25);
    expect(s.update(0.3).next).toBe(4.75);
  });

  it('halves the step when the direction reverses and stops at 0.25', () => {
    const s = new Staircase(6);
    s.update(0.95);
    expect(s.step).toBe(0.5);
    s.update(0.6);
    expect(s.step).toBe(0.25);
    s.update(0.95);
    expect(s.step).toBe(0.25);
  });

  it('keeps levels inside the limits', () => {
    const s = new Staircase(1);
    s.update(0.1);
    expect(s.level).toBe(1);
    const top = new Staircase(15);
    top.update(1);
    expect(top.level).toBe(15);
  });

  it('reports the last level for short plays and a late mean otherwise', () => {
    const s = new Staircase(4);
    s.update(0.95);
    s.update(0.95);
    expect(s.finalLevel()).toBe(4.5);
    const long = new Staircase(3);
    for (let i = 0; i < 8; i++) long.update(0.95);
    const h = long.history;
    const late = h.slice(4).reduce((a, b) => a + b, 0) / 4;
    expect(long.finalLevel()).toBeCloseTo(late, 9);
  });

  it('settles where a logistic player succeeds 70 to 86 percent of the time', () => {
    const T = 6;
    const slope = 1;
    for (let seed = 1; seed <= 5; seed++) {
      const rng = createRng(seed);
      const s = new Staircase(3);
      for (let i = 0; i < 80; i++) {
        const p = 1 / (1 + Math.exp((s.level - T) / slope));
        let ok = 0;
        for (let k = 0; k < 16; k++) if (rng.next() < p) ok++;
        s.update(ok / 16);
      }
      const final = s.finalLevel();
      const lo = T - slope * Math.log(0.86 / 0.14) - 0.5;
      const hi = T - slope * Math.log(0.7 / 0.3) + 0.5;
      expect(final).toBeGreaterThan(lo);
      expect(final).toBeLessThan(hi);
    }
  });
});

const SKILL: Record<ModuleId, Parameters<typeof rawDemandAt>[0]> = {
  jumps: 'aim',
  angles: 'aim',
  streams: 'speed',
  tracking: 'tracking',
  spinning: 'spin',
  precision: 'precision',
  reading: 'reading',
  timing: 'timing',
};

function measured(module: ModuleId, objects: HitObject[]): number {
  const f = computeFeatures({ objects, durationMs: 100000 });
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  switch (module) {
    case 'jumps':
    case 'angles':
      return mean(
        objects.flatMap((o, i) =>
          f[i]!.distance !== null && f[i]!.gapMs !== null ? [aimDemand(f[i]!.distance!, f[i]!.gapMs!, o.radius)] : [],
        ),
      );
    case 'streams':
      return mean(objects.flatMap((_, i) => (f[i]!.runIndex >= 2 ? [speedDemand(f[i]!.gapMs!)] : [])));
    case 'tracking':
      return mean(objects.map((o) => trackingDemand((o as SliderObject).velocity, (o as SliderObject).followRadius)));
    case 'spinning':
      return mean(objects.map((o) => spinDemand((o as SpinnerObject).rotationsRequired, (o as SpinnerObject).endTime - o.time)));
    case 'precision':
      return mean(objects.map((o) => precisionDemand(o.radius)));
    case 'reading':
      return mean(objects.map((o) => readingDemand(o.approachMs, [])));
    case 'timing':
      return mean(objects.map((o) => timingDemand(o.windows.crisp)));
  }
}

describe('level caps', () => {
  it('stop where the map stops changing', () => {
    const streams = maxLevelFor('streams');
    expect(streams).toBeGreaterThan(11);
    expect(streams).toBeLessThan(12.5);
    const reading = maxLevelFor('reading');
    expect(reading).toBeGreaterThan(12);
    expect(reading).toBeLessThan(13.5);
    for (const m of ['jumps', 'angles', 'tracking', 'spinning', 'precision', 'timing'] as const) expect(maxLevelFor(m)).toBe(15);
    // Past the cap the settings are the same.
    expect(
      Math.abs(paramsAtLevel('reading', 15).approachMs - paramsAtLevel('reading', maxLevelFor('reading')).approachMs),
    ).toBeLessThanOrEqual(2);
    const a = buildSet({ module: 'streams', level: streams, options: {}, set: 0, seed: 3, startTime: 2000, indexBase: 0, groupBase: 0 });
    const b = buildSet({ module: 'streams', level: 15, options: {}, set: 0, seed: 3, startTime: 2000, indexBase: 0, groupBase: 0 });
    const gap = (o: typeof a.objects) => o[2]!.time - o[1]!.time;
    expect(Math.abs(gap(a.objects) - gap(b.objects))).toBeLessThan(0.5);
  });

  it('hold the staircase at the cap', () => {
    const s = new Staircase(11, maxLevelFor('streams'));
    for (let i = 0; i < 30; i++) s.update(1);
    expect(s.level).toBe(maxLevelFor('streams'));
    expect(s.finalLevel()).toBeLessThanOrEqual(maxLevelFor('streams'));
    expect(Staircase.startFor(14, 3, 11.8).level).toBeLessThanOrEqual(11.8);
  });
});

describe('module sets', () => {
  it('measure within 10 percent of the demand they are built for', () => {
    for (const module of MODULE_IDS) {
      for (const level of [2, 5, 8]) {
        for (const seed of [1, 2, 3]) {
          const set = buildSet({
            module,
            level,
            options: MODES[module].defaultOptions,
            set: 0,
            seed,
            startTime: 2000,
            indexBase: 0,
            groupBase: 0,
          });
          const want = rawDemandAt(SKILL[module], level);
          const got = measured(module, set.objects);
          if (Math.abs(got - want) / want > 0.1)
            throw new Error(`${module} L${level} seed ${seed}: wanted ${want.toFixed(2)}, got ${got.toFixed(2)}`);
        }
      }
    }
  });

  it('build the set size the mode lists', () => {
    for (const module of MODULE_IDS) {
      const set = buildSet({
        module,
        level: 4,
        options: MODES[module].defaultOptions,
        set: 0,
        seed: 9,
        startTime: 2000,
        indexBase: 0,
        groupBase: 0,
      });
      const want = MODES[module].setSize;
      expect(set.objects.length).toBeGreaterThanOrEqual(Math.floor(want * 0.85));
      expect(set.objects.length).toBeLessThanOrEqual(want);
      set.objects.forEach((o, i) => {
        expect(o.index).toBe(i);
        expect(o.set).toBe(0);
      });
      for (let i = 1; i < set.objects.length; i++) {
        const prev = set.objects[i - 1]!;
        const end = prev.kind === 'circle' ? prev.time : prev.endTime;
        expect(set.objects[i]!.time).toBeGreaterThan(end);
      }
    }
  });

  it('repeat for the same seed', () => {
    const spec = { module: 'jumps' as const, level: 4, options: {}, set: 0, seed: 5, startTime: 2000, indexBase: 0, groupBase: 0 };
    expect(buildSet(spec).objects).toEqual(buildSet(spec).objects);
    expect(buildSet({ ...spec, seed: 6 }).objects).not.toEqual(buildSet(spec).objects);
  });

  it('keep most jump moves in the chosen direction', () => {
    let near = 0;
    let moves = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const set = buildSet({
        module: 'jumps',
        level: 3,
        options: { distanceFocus: 'mixed', directionFocus: 2 },
        set: 0,
        seed,
        startTime: 2000,
        indexBase: 0,
        groupBase: 0,
      });
      const f = computeFeatures({ objects: set.objects, durationMs: 1e5 });
      for (const x of f) {
        if (x.direction === null) continue;
        moves++;
        const d = Math.abs(((x.direction - 90 + 540) % 360) - 180);
        if (d <= 30) near++;
      }
    }
    expect(near / moves).toBeGreaterThan(0.5);
  });

  it('keep the chosen direction when Mirror flips the map', () => {
    for (const octant of [0, 1, 2]) {
      for (const mods of [[], ['mirror']] as const) {
        let near = 0;
        let moves = 0;
        for (let seed = 1; seed <= 8; seed++) {
          const launch = {
            ...launchFor(undefined, seed, 60, [...mods], 'jumps'),
            options: { distanceFocus: 'mixed' as const, directionFocus: octant },
          };
          const map = setupPlay(launch).map;
          const first = map.objects.filter((o) => o.set === 0);
          const f = computeFeatures({ objects: first, durationMs: 1e5 });
          for (const x of f) {
            if (x.direction === null) continue;
            moves++;
            const d = Math.abs(((x.direction - octant * 45 + 540) % 360) - 180);
            if (d <= 30) near++;
          }
        }
        expect(near / moves, `octant ${octant} ${mods.join()}`).toBeGreaterThan(0.5);
      }
    }
  });

  it('use only the shapes asked for', () => {
    const set = buildSet({
      module: 'tracking',
      level: 4,
      options: { sliderFocus: 'straight' },
      set: 0,
      seed: 3,
      startTime: 2000,
      indexBase: 0,
      groupBase: 0,
    });
    expect(set.objects.length).toBeGreaterThan(3);
    for (const o of set.objects) expect((o as SliderObject).shape).toBe('straight');
  });

  it('grade success by each module rule', () => {
    const rec = (over: Record<string, unknown>) =>
      ({ judgment: 'crisp', headJudgment: 'crisp', slider: null, spinner: null, aimRadial: 0, radius: 50, ...over }) as never;
    expect(isSuccess('jumps', rec({ judgment: 'rough' }))).toBe(true);
    expect(isSuccess('jumps', rec({ judgment: 'miss' }))).toBe(false);
    expect(isSuccess('streams', rec({ judgment: 'rough' }))).toBe(false);
    expect(isSuccess('streams', rec({ judgment: 'solid' }))).toBe(true);
    expect(isSuccess('precision', rec({ aimRadial: 30 }))).toBe(false);
    expect(isSuccess('precision', rec({ aimRadial: 20 }))).toBe(true);
    expect(isSuccess('timing', rec({ judgment: 'solid' }))).toBe(false);
    expect(isSuccess('tracking', rec({ slider: { trackedFraction: 0.95 } }))).toBe(true);
    expect(isSuccess('tracking', rec({ slider: { trackedFraction: 0.85 } }))).toBe(false);
    expect(isSuccess('tracking', rec({ headJudgment: 'miss', slider: { trackedFraction: 0.95 } }))).toBe(false);
    expect(isSuccess('spinning', rec({ spinner: { rotations: 5, rotationsRequired: 5 } }))).toBe(true);
    expect(successShare('jumps', [rec({}), rec({ judgment: 'miss' })])).toBe(0.5);
  });
});

describe('setupPlay', () => {
  const modes: ModeId[] = [
    'dynamic',
    'jumps',
    'angles',
    'streams',
    'tracking',
    'spinning',
    'precision',
    'reading',
    'timing',
    'stamina',
    'warmup',
    'mix',
  ];

  it('builds every mode with a first object after the lead-in', () => {
    for (const modeId of modes) {
      const launch = {
        ...launchFor(undefined, 4, MODES[modeId].defaultLengthSec, [], modeId),
        options: MODES[modeId].defaultOptions,
        levels: { jumps: 4, streams: 5 },
      };
      const setup = setupPlay(launch);
      expect(setup.map.objects.length, modeId).toBeGreaterThanOrEqual(2);
      expect(setup.map.objects[0]!.time, modeId).toBeGreaterThanOrEqual(2000);
      expect(setup.map.health === null, modeId).toBe(modeId !== 'dynamic');
      expect(setup.controller === null, modeId).toBe(!MODES[modeId].adaptive);
    }
  });

  it('gives fixed modes sets of -1 and covers the length', () => {
    for (const modeId of ['stamina', 'warmup'] as const) {
      const setup = setupPlay({ ...launchFor(undefined, 8, 120, [], modeId), levels: {} });
      for (const o of setup.map.objects) expect(o.set).toBe(-1);
      expect(setup.map.durationMs).toBeGreaterThan(90000);
      expect(setup.map.durationMs).toBeLessThan(125000);
    }
  });

  it('keeps the first target of each Stamina and Warm-up chunk clear of the last one', () => {
    for (const modeId of ['stamina', 'warmup'] as const) {
      for (let seed = 1; seed <= 6; seed++) {
        const setup = setupPlay({
          ...launchFor(undefined, seed, 180, [], modeId),
          levels: { jumps: 5, streams: 6, tracking: 4, precision: 5 },
        });
        const objs = setup.map.objects;
        let boundaries = 0;
        for (let i = 1; i < objs.length; i++) {
          const a = objs[i - 1]!;
          const b = objs[i]!;
          const end = a.kind === 'circle' ? a.time : a.endTime;
          if (b.time - end < 1000 || a.kind === 'slider') continue;
          boundaries++;
          const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
          expect(d, `${modeId} ${seed} at ${i}`).toBeGreaterThanOrEqual(2.2 * Math.max(a.radius, b.radius));
        }
        expect(boundaries).toBeGreaterThan(3);
      }
    }
  });

  it('plays long streams in Stamina', () => {
    let longest = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const setup = setupPlay({ ...launchFor(undefined, seed, 180, [], 'stamina'), levels: { streams: 5 } });
      const f = computeFeatures(setup.map);
      for (const x of f) longest = Math.max(longest, x.runLength);
    }
    expect(longest).toBeGreaterThanOrEqual(13);
  });

  it('ignores mods a mode does not allow, and applies Mirror to sets', () => {
    const a = setupPlay({ ...launchFor(undefined, 2, 60, [], 'jumps'), options: {} });
    const b = setupPlay({ ...launchFor(undefined, 2, 60, ['mirror', 'fast'], 'jumps'), options: {} });
    expect(b.map.mods).toEqual(['mirror']);
    expect(b.map.rate).toBe(1);
    expect(b.map.objects[0]!.pos.x).toBeCloseTo(1000 - a.map.objects[0]!.pos.x, 6);
  });

  it('uses the player levels', () => {
    const lo = setupPlay({ ...launchFor(undefined, 2, 60, [], 'precision'), levels: { precision: 2 } });
    const hi = setupPlay({ ...launchFor(undefined, 2, 60, [], 'precision'), levels: { precision: 9 } });
    expect(hi.map.objects[0]!.radius).toBeLessThan(lo.map.objects[0]!.radius);
    expect(DEFAULT_MODULE_LEVEL).toBe(3);
  });
});

describe('placement', () => {
  const placement = (seed = 5, levels: Partial<Record<ModuleId, number>> = {}) => ({
    ...launchFor(undefined, seed, 240, [], 'placement'),
    levels,
  });

  it('starts every module at level 3, or its saved level, with a full step', () => {
    const setup = setupPlay(placement(5, { streams: 6.5 }));
    expect(setup.controller).not.toBeNull();
    expect(setup.map.health).toBeNull();
    expect(setup.map.mods).toEqual([]);
    expect(setup.controller!.status()).toEqual({ level: 3, set: 0 });
    const run = runHeadless({ launch: placement(5, { streams: 6.5 }), model: PERFECT_PLAYER });
    const steps = run.result.levels;
    expect(steps[0]!.level).toBe(3);
    // The second set (streams) starts at the saved level, not half a level under it.
    expect(steps[1]!.module).toBe('streams');
    expect(steps[1]!.level).toBe(6.5);
  });

  it('plays the five modules in order and then again, 10 sets, and ends after set 10', () => {
    const run = runHeadless({ launch: placement(), model: PERFECT_PLAYER });
    const steps = run.result.levels;
    expect(steps.map((s) => s.set)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(steps.map((s) => s.module)).toEqual([...PLACEMENT.modules, ...PLACEMENT.modules]);
    expect(run.session.over).toBe(true);
    expect(run.result.status).toBe('completed');
    expect(run.result.healthAtEnd).toBeNull();
  });

  it('measures progress against ten sets, not the 240 s cap, and counts the HUD ring in sets', () => {
    const launch = placement();
    expect(launch.lengthSec).toBe(240);
    expect(ringSetsFor(launch)).toBe(10);
    expect(PLACEMENT_SETS).toBe(10);
    expect(ringSetsFor({ ...launch, modeId: 'mix' })).toBeNull();
    const run = runHeadless({ launch, model: PERFECT_PLAYER });
    expect(run.session.progressMs).toBeLessThan(120000);
    const last = run.session.features[run.session.features.length - 1]!;
    // The play ends at 49 to 72 s, so the last object sits near the end of the measure, not a quarter of the way.
    expect(last.progress).toBeGreaterThan(0.6);
  });

  it('takes a step of 1 at the start: a clean first set moves the module up a whole level', () => {
    const run = runHeadless({ launch: placement(), model: PERFECT_PLAYER });
    for (let m = 0; m < 5; m++) {
      const first = run.result.levels[m]!;
      const second = run.result.levels[m + 5]!;
      expect(first.level).toBe(3);
      expect(second.level).toBe(4);
    }
  });

  it('uses the set sizes from PLACEMENT', () => {
    const run = runHeadless({ launch: placement(), model: PERFECT_PLAYER });
    for (const s of run.result.levels) {
      const want = PLACEMENT.setSize[s.module]!;
      expect(s.objects, s.module).toBeGreaterThanOrEqual(Math.floor(want * 0.85));
      expect(s.objects, s.module).toBeLessThanOrEqual(want);
    }
  });

  it('reports final levels for all five modules', () => {
    const run = runHeadless({ launch: placement(), model: PERFECT_PLAYER });
    expect(Object.keys(run.result.finalLevels).sort()).toEqual([...PLACEMENT.modules].sort());
    for (const m of PLACEMENT.modules) expect(run.result.finalLevels[m]).toBeGreaterThanOrEqual(3);
  });

  it('places a player who passes both sets above where they started: the level after the last result', () => {
    const run = runHeadless({ launch: placement(), model: PERFECT_PLAYER });
    for (const m of PLACEMENT.modules) {
      const played = run.result.levels.filter((s) => s.module === m);
      // Set 1 at 3 moves up to 4, set 2 at 4 moves up to 5. The second set's own level is not the result.
      expect(
        played.map((s) => s.level),
        m,
      ).toEqual([3, 4]);
      expect(run.result.finalLevels[m], m).toBe(5);
    }
  });

  it('does not cut the play at its length before set 10', () => {
    // A weak player is slow to finish sets. Ten sets still all get played.
    const run = runHeadless({ launch: { ...placement(), lengthSec: 20 }, model: WEAK_PLAYER });
    expect(run.result.levels).toHaveLength(10);
  });

  it('gives the same sets for the same seed and a different map for another', () => {
    const a = setupPlay(placement(5)).map.objects;
    expect(setupPlay(placement(5)).map.objects).toEqual(a);
    expect(setupPlay(placement(6)).map.objects).not.toEqual(a);
  });

  it('ignores mods', () => {
    const setup = setupPlay({ ...placement(), mods: ['fast', 'mirror'] });
    expect(setup.map.mods).toEqual([]);
    expect(setup.map.rate).toBe(1);
  });
});
