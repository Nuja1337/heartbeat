import { describe, expect, it } from 'vitest';
import { DEFAULT_DIFFICULTY, LEVEL_PRESETS, MODES } from '../../shared/catalog';
import type { HitRecord, LaunchRequest, ModId, ModeId, PlayResult } from '../../shared/types';
import { launchFor } from '../testing/fixtures';
import { NOISY_PLAYER, PERFECT_PLAYER, WEAK_PLAYER } from './autoplay';
import { runHeadless } from './headless';

function launches(): LaunchRequest[] {
  const out: LaunchRequest[] = [];
  const modSets: ModId[][] = [[], ['fade'], ['spotlight', 'mirror'], ['fast'], ['slow'], ['tight'], ['wide', 'nofail']];
  for (const round of [0, 1]) {
    LEVEL_PRESETS.forEach((lp, i) => {
      out.push(launchFor(lp.difficulty, 100 + i + 50 * round, 45, modSets[(i + round * 3) % modSets.length]));
    });
  }
  return out;
}

function expectPerfect(r: PlayResult, label: string) {
  const total = r.records.length;
  expect(r.status, label).toBe('completed');
  expect(total, label).toBe(r.map.counts.circle + r.map.counts.slider + r.map.counts.spinner);
  expect(r.counts.crisp, label).toBe(total);
  expect(r.counts.miss, label).toBe(0);
  expect(r.sliderParts.hit, label).toBe(r.sliderParts.total);
  expect(r.accuracy, label).toBe(1);
  expect(r.strayPresses, label).toBe(0);
  for (const rec of r.records) {
    if (rec.spinner) expect(rec.spinner.rotations, label).toBeGreaterThanOrEqual(rec.spinner.rotationsRequired);
    if (rec.slider) expect(rec.slider.endHit, label).toBe(true);
  }
}

describe('perfect player', () => {
  it('gets every object Crisp on Dynamic maps with and without mods', () => {
    for (const l of launches()) {
      const { result } = runHeadless({ launch: l, model: PERFECT_PLAYER });
      expectPerfect(result, `level ${l.difficulty.bpm} ${l.mods.join('+')}`);
      expect(result.maxCombo).toBeGreaterThan(20);
    }
  });

  it('reaches full health and a high score', () => {
    const { result } = runHeadless({ launch: launchFor(DEFAULT_DIFFICULTY, 7, 40), model: PERFECT_PLAYER });
    expect(result.healthAtEnd!).toBeGreaterThan(0.9);
    expect(result.score).toBeGreaterThan(1000);
  });
});

function aimStats(records: HitRecord[]) {
  const vals = records.filter((r) => r.aimAlong !== null && r.kind === 'circle');
  return vals;
}

describe('perfect player in training modes', () => {
  const modes: ModeId[] = ['jumps', 'angles', 'streams', 'tracking', 'spinning', 'precision', 'reading', 'timing', 'stamina', 'warmup', 'mix'];

  it('clears every set, and the level climbs', () => {
    const cases = modes.flatMap((modeId, i) => [0, 1].map((round) => ({ modeId, i: i + round * 11 })));
    expect(cases.length + launches().length).toBeGreaterThanOrEqual(30);
    cases.forEach(({ modeId, i }) => {
      const mods: ModId[] = i % 3 === 1 ? ['mirror'] : i % 3 === 2 ? ['fade'] : [];
      const launch = { ...launchFor(DEFAULT_DIFFICULTY, 500 + i, 60, mods, modeId), options: MODES[modeId].defaultOptions, levels: { jumps: 3, streams: 3, tracking: 3 } };
      const { result } = runHeadless({ launch, model: PERFECT_PLAYER });
      expectPerfect(result, modeId);
      if (MODES[modeId].adaptive) {
        expect(result.levels.length, modeId).toBeGreaterThanOrEqual(2);
        for (const step of result.levels) expect(step.success, modeId).toBe(1);
        const keys = Object.keys(result.finalLevels);
        expect(keys.length, modeId).toBeGreaterThanOrEqual(1);
      } else {
        expect(result.levels, modeId).toEqual([]);
        expect(result.finalLevels, modeId).toEqual({});
      }
      expect(result.healthAtEnd, modeId).toBeNull();
    });
  });

  it('keeps its level when it lets go of sliders 30 ms early', () => {
    const early = { ...PERFECT_PLAYER, sliderReleaseEarly: 30 };
    const launch = { ...launchFor(DEFAULT_DIFFICULTY, 14, 60, [], 'tracking'), options: {}, levels: { tracking: 8.5 } };
    const { result } = runHeadless({ launch, model: early });
    expect(result.levels.length).toBeGreaterThanOrEqual(2);
    for (const step of result.levels) expect(step.success).toBe(1);
    for (const rec of result.records) {
      expect(rec.slider!.breaks).toBe(0);
      expect(rec.slider!.endHit).toBe(true);
    }
  });

  it('rises one step at a time from half a level below the saved level', () => {
    const launch = { ...launchFor(DEFAULT_DIFFICULTY, 9, 60, [], 'jumps'), options: {}, levels: { jumps: 4 } };
    const { result } = runHeadless({ launch, model: PERFECT_PLAYER });
    expect(result.levels[0]!.level).toBe(3.5);
    expect(result.levels[1]!.level).toBe(4);
    expect(result.finalLevels.jumps!).toBeGreaterThan(4);
  });
});

describe('a sloppy player in a training mode', () => {
  it('sees the level fall', () => {
    const sloppy = { ...NOISY_PLAYER, name: 'sloppy', sigmaAim: 0.9 };
    const launch = { ...launchFor(DEFAULT_DIFFICULTY, 3, 60, [], 'precision'), options: {}, levels: { precision: 6 } };
    const { result } = runHeadless({ launch, model: sloppy });
    const first = result.levels[0]!;
    const last = result.levels[result.levels.length - 1]!;
    expect(result.levels.length).toBeGreaterThanOrEqual(3);
    expect(first.success).toBeLessThan(0.7);
    expect(last.level).toBeLessThan(first.level);
    expect(result.finalLevels.precision!).toBeLessThan(first.level);
  });
});

describe('noisy player', () => {
  it('lands in the expected accuracy band', () => {
    let acc = 0;
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const l = launchFor(LEVEL_PRESETS[2 + i]!.difficulty, 300 + i, 60);
      const { result } = runHeadless({ launch: l, model: NOISY_PLAYER });
      expect(result.status).toBe('completed');
      acc += result.accuracy;
      n++;
      const total = result.records.length;
      // About 99% of presses fall inside the Crisp window, so most are Crisp and a few are not.
      expect(result.counts.crisp / total).toBeGreaterThan(0.85);
      expect(result.counts.miss / total).toBeLessThan(0.05);
    }
    expect(acc / n).toBeGreaterThan(0.93);
    expect(acc / n).toBeLessThan(1);
  });

  it('shows an unbiased aim', () => {
    const { result } = runHeadless({ launch: launchFor(LEVEL_PRESETS[4]!.difficulty, 12, 90), model: NOISY_PLAYER });
    const v = aimStats(result.records);
    const mean = v.reduce((a, r) => a + r.aimAlong! / r.radius, 0) / v.length;
    expect(Math.abs(mean)).toBeLessThan(0.1);
  });
});

describe('weak player', () => {
  it('undershoots far targets, so along is negative there', () => {
    const d = { ...DEFAULT_DIFFICULTY, spacing: 10, bpm: 120, density: 1, streams: 0, sliders: 0, spinners: 0 };
    const { result } = runHeadless({ launch: launchFor(d, 21, 90), model: WEAK_PLAYER });
    const far = result.records.filter((r) => r.kind === 'circle' && r.features.spacing !== null && r.features.spacing >= 4.5 && r.aimAlong !== null);
    expect(far.length).toBeGreaterThan(20);
    const mean = far.reduce((a, r) => a + r.aimAlong! / r.radius, 0) / far.length;
    expect(mean).toBeLessThan(-0.25);
    const near = result.records.filter((r) => r.kind === 'circle' && r.features.spacing !== null && r.features.spacing < 4.5 && r.aimAlong !== null);
    if (near.length > 10) {
      const m2 = near.reduce((a, r) => a + r.aimAlong! / r.radius, 0) / near.length;
      expect(Math.abs(m2)).toBeLessThan(0.15);
    }
  });
});

describe('records', () => {
  it('has one record per judged object, in index order', () => {
    const { result, session } = runHeadless({ launch: launchFor(DEFAULT_DIFFICULTY, 33, 40), model: NOISY_PLAYER });
    const judged = result.counts.crisp + result.counts.solid + result.counts.rough + result.counts.miss;
    expect(result.records.length).toBe(judged);
    expect(result.records.length).toBe(session.map.objects.length);
    result.records.forEach((r, i) => expect(r.index).toBe(i));
  });

  it('keeps timing and aim signs from the contract', () => {
    const { result } = runHeadless({ launch: launchFor(DEFAULT_DIFFICULTY, 34, 40), model: PERFECT_PLAYER });
    for (const r of result.records) {
      if (r.kind === 'circle') {
        // The session snaps press times to the 1/64 ms grid, so a perfect press is off by at most 1/128 ms.
        expect(Math.abs(r.timingError!)).toBeLessThanOrEqual(1 / 128 + 1e-9);
        expect(r.aimRadial!).toBeLessThan(0.01);
        expect(r.input === 'key1' || r.input === 'key2').toBe(true);
        expect(r.crispMs).toBeGreaterThan(0);
      }
    }
    const withMove = result.records.filter((r) => r.movement.peakSpeed !== null);
    expect(withMove.length).toBeGreaterThan(10);
    for (const r of withMove) {
      expect(r.movement.arriveMs!).toBeLessThanOrEqual(0);
      expect(r.movement.efficiency!).toBeGreaterThan(0.9);
    }
  });
});

describe('planted movement habits', () => {
  const launch = { ...launchFor(DEFAULT_DIFFICULTY, 77, 60, [], 'jumps'), options: MODES.jumps.defaultOptions, levels: { jumps: 5 } };

  function stats(model: typeof PERFECT_PLAYER) {
    const { result } = runHeadless({ launch, model });
    const jumps = result.records.filter(
      (r) => r.kind === 'circle' && r.movement.primaryAlong != null && r.features.distance !== null && r.features.gapMs !== null && r.features.spacing! >= 2.5,
    );
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    return {
      n: jumps.length,
      leave: mean(jumps.map((r) => r.movement.leaveMs!)),
      leaveFrac: mean(jumps.map((r) => r.movement.leaveMs! / r.features.gapMs!)),
      along: mean(jumps.map((r) => r.movement.primaryAlong! / r.features.distance!)),
      correction: mean(jumps.map((r) => r.movement.correctionPath! / r.features.distance!)),
      result,
    };
  }

  it('a clean player ends the first motion on the target and leaves early', () => {
    const s = stats(PERFECT_PLAYER);
    expect(s.n).toBeGreaterThan(10);
    expect(Math.abs(s.along)).toBeLessThan(0.05);
    expect(s.correction).toBeLessThan(0.05);
    expect(s.leaveFrac).toBeLessThan(0.3);
  });

  it('leaveDelayMs delays the start of the move and leaves the play perfect', () => {
    const base = stats(PERFECT_PLAYER);
    const late = stats({ ...PERFECT_PLAYER, leaveDelayMs: 150 });
    expect(late.leave).toBeGreaterThan(base.leave + 80);
    expect(late.leaveFrac).toBeGreaterThan(base.leaveFrac + 0.2);
    expect(late.result.counts.miss).toBe(0);
    expect(late.result.counts.crisp).toBe(base.result.counts.crisp);
  });

  it('primaryShort stops the first motion short and adds a correction', () => {
    const base = stats(PERFECT_PLAYER);
    const short = stats({ ...PERFECT_PLAYER, primaryShort: 0.3 });
    expect(short.along).toBeLessThan(-0.2);
    expect(short.along).toBeGreaterThan(-0.4);
    expect(short.correction).toBeGreaterThan(base.correction + 0.2);
    expect(short.result.counts.miss).toBe(0);
  });
});
