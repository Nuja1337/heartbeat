import { describe, expect, it } from 'vitest';
import { DEFAULT_DIFFICULTY, DIFFICULTY_LIMITS, LEVEL_PRESETS, MODES, MODE_ORDER, MODULE_IDS } from './catalog';
import { ShareCodeError, cleanMods, dailySeed, decodeShare, encodeShare, localDateKey } from './codes';
import type { DifficultySettings, LaunchRequest, ModId, ModeId, ModuleOptions } from './types';

const VECTOR = 'AQABFc1bB1oAQAACBEM';

function launchFor(modeId: ModeId, over: Partial<LaunchRequest> = {}): LaunchRequest {
  const mode = MODES[modeId];
  return {
    modeId,
    difficulty: { ...DEFAULT_DIFFICULTY },
    presetLevel: null,
    options: { ...mode.defaultOptions },
    mods: [],
    seed: 987654321,
    lengthSec: mode.defaultLengthSec,
    levels: {},
    drillId: null,
    ...over,
  };
}

/** Appends the checksum and base64url-encodes, independently of the module under test. */
function codeOf(bytes: number[]): string {
  const sum = bytes.reduce((a, b) => (a + b) & 255, 0) ^ 0xa5;
  return Buffer.from([...bytes, sum]).toString('base64url');
}

function header(opts: { mode?: number; flags?: number; seed?: number; length?: number; mods?: number; gen?: number; version?: number } = {}): number[] {
  const seed = (opts.seed ?? 1) >>> 0;
  const length = opts.length ?? 90;
  const mods = opts.mods ?? 0;
  return [
    opts.version ?? 1,
    opts.mode ?? 0,
    opts.flags ?? 0,
    seed & 255,
    (seed >>> 8) & 255,
    (seed >>> 16) & 255,
    (seed >>> 24) & 255,
    length & 255,
    length >> 8,
    mods & 255,
    mods >> 8,
    opts.gen ?? 2,
  ];
}

function kindOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof ShareCodeError ? e.kind : `other:${String(e)}`;
  }
  return 'none';
}

describe('share code vector', () => {
  it('decodes to Dynamic, preset 4, seed 123456789, 90 s, Mirror, generator 2', () => {
    const { launch, generatorVersion } = decodeShare(VECTOR);
    expect(generatorVersion).toBe(2);
    expect(launch.modeId).toBe('dynamic');
    expect(launch.presetLevel).toBe(4);
    expect(launch.difficulty).toEqual(LEVEL_PRESETS[3]!.difficulty);
    expect(launch.seed).toBe(123456789);
    expect(launch.lengthSec).toBe(90);
    expect(launch.mods).toEqual(['mirror']);
    expect(launch.options).toEqual({});
  });

  it('encodes that launch to the same string', () => {
    const launch = launchFor('dynamic', {
      difficulty: { ...LEVEL_PRESETS[3]!.difficulty },
      presetLevel: 4,
      seed: 123456789,
      lengthSec: 90,
      mods: ['mirror'],
    });
    expect(encodeShare(launch, 2)).toBe(VECTOR);
  });

  it('has the documented bytes', () => {
    expect([...Buffer.from(VECTOR, 'base64url')]).toEqual([0x01, 0x00, 0x01, 0x15, 0xcd, 0x5b, 0x07, 0x5a, 0x00, 0x40, 0x00, 0x02, 0x04, 0x43]);
  });
});

describe('share code round trip', () => {
  const same = (a: LaunchRequest, b: Partial<LaunchRequest>): void => {
    expect(b.modeId).toBe(a.modeId);
    expect(b.difficulty).toEqual(MODES[a.modeId].id === 'dynamic' ? a.difficulty : DEFAULT_DIFFICULTY);
    expect(b.presetLevel).toBe(a.modeId === 'dynamic' ? a.presetLevel : null);
    expect(b.seed).toBe(a.seed);
    expect(b.lengthSec).toBe(a.lengthSec);
    expect(b.mods).toEqual(cleanMods(a.mods, a.modeId));
  };

  it('round-trips every mode in MODE_ORDER with default options and its default length', () => {
    for (const modeId of MODE_ORDER) {
      for (const lengthSec of MODES[modeId].lengthOptions) {
        const launch = launchFor(modeId, { lengthSec });
        const out = decodeShare(encodeShare(launch, 2));
        same(launch, out.launch);
        expect(out.launch.options).toEqual(MODES[modeId].defaultOptions);
        expect(out.generatorVersion).toBe(2);
      }
    }
  });

  it('round-trips every preset', () => {
    for (const preset of LEVEL_PRESETS) {
      // Level 2 is 75 s, which is not a Dynamic length option: it ties between 60 and 90 and snaps up.
      const lengthSec = preset.lengthSec === 75 ? 90 : preset.lengthSec;
      const launch = launchFor('dynamic', { difficulty: { ...preset.difficulty }, presetLevel: preset.level, lengthSec });
      same(launch, decodeShare(encodeShare(launch, 2)).launch);
      expect(decodeShare(encodeShare({ ...launch, lengthSec: preset.lengthSec }, 2)).launch.lengthSec).toBe(lengthSec);
    }
  });

  it('round-trips custom difficulties, including both limits of every control', () => {
    const keys = Object.keys(DIFFICULTY_LIMITS) as (keyof DifficultySettings)[];
    const cases: DifficultySettings[] = [
      { ...DEFAULT_DIFFICULTY, radius: 33, approachMs: 1230, bpm: 177, streamMaxLength: 21 },
      Object.fromEntries(keys.map((k) => [k, DIFFICULTY_LIMITS[k].min])) as unknown as DifficultySettings,
      Object.fromEntries(keys.map((k) => [k, DIFFICULTY_LIMITS[k].max])) as unknown as DifficultySettings,
    ];
    for (const difficulty of cases) {
      const launch = launchFor('dynamic', { difficulty, presetLevel: null, lengthSec: 120 });
      same(launch, decodeShare(encodeShare(launch, 2)).launch);
    }
  });

  it('round-trips every option value', () => {
    const cases: [ModeId, ModuleOptions][] = [];
    for (const distanceFocus of ['mixed', 'short', 'long'] as const) {
      for (const directionFocus of [null, 0, 3, 7]) cases.push(['jumps', { distanceFocus, directionFocus }]);
    }
    for (const angleFocus of ['mixed', 'sharp', 'wide'] as const) cases.push(['angles', { angleFocus }]);
    for (const streamLength of ['short', 'medium', 'long'] as const) cases.push(['streams', { streamLength }]);
    for (const sliderFocus of ['mixed', 'straight', 'curves', 'repeats'] as const) cases.push(['tracking', { sliderFocus }]);
    cases.push(['mix', { mixModules: ['jumps', 'timing'] }]);
    cases.push(['mix', { mixModules: ['reading', 'spinning', 'precision', 'angles'] }]);
    for (const [modeId, options] of cases) {
      const out = decodeShare(encodeShare(launchFor(modeId, { options }), 2)).launch;
      expect(out.options).toEqual(options);
    }
  });

  it('keeps mods the mode allows, in share order, and drops the rest', () => {
    const mods: ModId[] = ['onelife', 'mirror', 'fast', 'fade'];
    const dynamic = decodeShare(encodeShare(launchFor('dynamic', { mods }), 2)).launch;
    expect(dynamic.mods).toEqual(['fade', 'fast', 'mirror', 'onelife']);
    const module = decodeShare(encodeShare(launchFor('jumps', { mods }), 2)).launch;
    expect(module.mods).toEqual(['fade', 'mirror']);
  });

  it('round-trips seeds across the whole u32 range', () => {
    for (const seed of [0, 1, 255, 256, 65535, 2 ** 31, 2 ** 32 - 1]) {
      expect(decodeShare(encodeShare(launchFor('dynamic', { seed }), 2)).launch.seed).toBe(seed);
    }
  });

  it('leaves out levels, the drill and the source', () => {
    const out = decodeShare(encodeShare(launchFor('jumps', { levels: { jumps: 5 }, drillId: 'x' }), 2)).launch;
    expect(out).not.toHaveProperty('levels');
    expect(out).not.toHaveProperty('drillId');
    expect(out).not.toHaveProperty('source');
  });

  it('refuses to encode a Mix outside 2 to 4 modules, and a bad generator version', () => {
    expect(() => encodeShare(launchFor('mix', { options: { mixModules: ['jumps'] } }), 2)).toThrow(RangeError);
    expect(() => encodeShare(launchFor('mix', { options: { mixModules: [...MODULE_IDS].slice(0, 5) } }), 2)).toThrow(RangeError);
    expect(() => encodeShare(launchFor('dynamic'), 256)).toThrow(RangeError);
    expect(() => encodeShare(launchFor('dynamic'), 1.5)).toThrow(RangeError);
  });
});

describe('share code rejection', () => {
  it('rejects every single-character change of the vector', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let accepted = 0;
    for (let i = 0; i < VECTOR.length; i++) {
      for (const c of alphabet) {
        if (c === VECTOR[i]) continue;
        const changed = VECTOR.slice(0, i) + c + VECTOR.slice(i + 1);
        if (kindOf(() => decodeShare(changed)) === 'none') accepted++;
      }
    }
    expect(accepted).toBe(0);
  });

  it('rejects the canonical-form trap AQABFc1bB1oAQAACBEN', () => {
    expect(kindOf(() => decodeShare('AQABFc1bB1oAQAACBEN'))).toBe('invalid');
  });

  it('rejects a newer version, even with a valid checksum', () => {
    expect(kindOf(() => decodeShare(codeOf(header({ version: 2, flags: 1 }).concat([4]))))).toBe('newer');
    expect(kindOf(() => decodeShare(codeOf(header({ version: 255 }))))).toBe('newer');
  });

  it('calls a code newer only when it is otherwise well formed', () => {
    // Garbage with a first byte above the version, and a valid code with any one character changed.
    expect(kindOf(() => decodeShare('Zm9vYmFyYmF6cXV4cXV4cXV4'))).toBe('invalid');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (let i = 0; i < VECTOR.length; i++) {
      for (const c of alphabet) {
        if (c === VECTOR[i]) continue;
        const changed = VECTOR.slice(0, i) + c + VECTOR.slice(i + 1);
        expect(kindOf(() => decodeShare(changed)), changed).not.toBe('newer');
      }
    }
    // A newer code with a bad checksum, or with text that is not canonical, is invalid too.
    const newer = header({ version: 2, flags: 1 }).concat([4]);
    const good = codeOf(newer);
    expect(kindOf(() => decodeShare(good))).toBe('newer');
    const wrong = Buffer.from([...newer, (newer.reduce((a, b) => (a + b) & 255, 0) ^ 0xa5) ^ 1]).toString('base64url');
    expect(kindOf(() => decodeShare(wrong))).toBe('invalid');
    expect(kindOf(() => decodeShare(good.slice(0, -1) + 'B'))).toBe('invalid');
  });

  it('rejects version 0, empty, too short, and characters outside base64url', () => {
    expect(kindOf(() => decodeShare(codeOf(header({ version: 0, flags: 1 }).concat([4]))))).toBe('invalid');
    expect(kindOf(() => decodeShare(''))).toBe('invalid');
    expect(kindOf(() => decodeShare(VECTOR.slice(0, 10)))).toBe('invalid');
    expect(kindOf(() => decodeShare(VECTOR.slice(0, -1)))).toBe('invalid');
    expect(kindOf(() => decodeShare(VECTOR + 'A'))).toBe('invalid');
    expect(kindOf(() => decodeShare(VECTOR + '='))).toBe('invalid');
    expect(kindOf(() => decodeShare(VECTOR.replace('c1b', 'c+b')))).toBe('invalid');
  });

  it('rejects placement, whether or not the rest is valid', () => {
    // Index 12 with no flags and no payload is otherwise a well-formed code.
    expect(kindOf(() => decodeShare(codeOf(header({ mode: 12, flags: 0, length: 240 }))))).toBe('invalid');
    expect(kindOf(() => decodeShare(encodeShare(launchFor('placement'), 2)))).toBe('invalid');
  });

  it('rejects an unknown mode, unknown flags, a preset flag outside Dynamic, and a bad preset', () => {
    expect(kindOf(() => decodeShare(codeOf(header({ mode: 13, flags: 0 }))))).toBe('invalid');
    expect(kindOf(() => decodeShare(codeOf(header({ flags: 4 }).concat([4]))))).toBe('invalid');
    expect(kindOf(() => decodeShare(codeOf(header({ mode: 1, flags: 3 }).concat([4, 0, 255]))))).toBe('invalid');
    expect(kindOf(() => decodeShare(codeOf(header({ flags: 1 }).concat([0]))))).toBe('invalid');
    expect(kindOf(() => decodeShare(codeOf(header({ flags: 1 }).concat([9]))))).toBe('invalid');
  });

  it('rejects missing or extra payload bytes', () => {
    expect(kindOf(() => decodeShare(codeOf(header({ flags: 1 }))))).toBe('invalid');
    expect(kindOf(() => decodeShare(codeOf(header({ flags: 1 }).concat([4, 4]))))).toBe('invalid');
    expect(kindOf(() => decodeShare(codeOf(header({ flags: 0 }).concat([4]))))).toBe('invalid');
  });

  it('rejects options that are missing, out of range, or on a mode without options', () => {
    // Jumps (index 1) with the options flag: distanceFocus, directionFocus.
    expect(kindOf(() => decodeShare(codeOf(header({ mode: 1, flags: 2 }).concat([3, 255]))))).toBe('invalid');
    expect(kindOf(() => decodeShare(codeOf(header({ mode: 1, flags: 2 }).concat([1, 8]))))).toBe('invalid');
    expect(kindOf(() => decodeShare(codeOf(header({ mode: 1, flags: 2 }).concat([1]))))).toBe('invalid');
    expect(kindOf(() => decodeShare(codeOf(header({ mode: 1, flags: 0 }))))).toBe('invalid');
    expect(kindOf(() => decodeShare(codeOf(header({ mode: 5, flags: 2 }).concat([0]))))).toBe('invalid'); // spinning has no options
    // Mix (index 11): count and indexes.
    expect(kindOf(() => decodeShare(codeOf(header({ mode: 11, flags: 2 }).concat([1, 0]))))).toBe('invalid');
    expect(kindOf(() => decodeShare(codeOf(header({ mode: 11, flags: 2 }).concat([2, 0, 8]))))).toBe('invalid');
    expect(kindOf(() => decodeShare(codeOf(header({ mode: 11, flags: 2 }).concat([2, 0, 1]))))).toBe('none');
  });
});

describe('share code clamping and snapping', () => {
  it('clamps custom difficulty values to DIFFICULTY_LIMITS', () => {
    // radius 30+255, approach 300+2550, bpm 90+255, everything else 255.
    const high = decodeShare(codeOf(header({ flags: 0 }).concat(Array(11).fill(255)))).launch.difficulty!;
    for (const key of Object.keys(DIFFICULTY_LIMITS) as (keyof DifficultySettings)[]) expect(high[key]).toBe(DIFFICULTY_LIMITS[key].max);
    const low = decodeShare(codeOf(header({ flags: 0 }).concat(Array(11).fill(0)))).launch.difficulty!;
    for (const key of Object.keys(DIFFICULTY_LIMITS) as (keyof DifficultySettings)[]) expect(low[key]).toBe(DIFFICULTY_LIMITS[key].min);
  });

  it('clamps on encode too, so the code only holds legal values', () => {
    const wild = { ...DEFAULT_DIFFICULTY, radius: 5, approachMs: 99999, density: 40, streamMaxLength: 1.4 };
    const out = decodeShare(encodeShare(launchFor('dynamic', { difficulty: wild }), 2)).launch.difficulty!;
    expect(out.radius).toBe(DIFFICULTY_LIMITS.radius.min);
    expect(out.approachMs).toBe(DIFFICULTY_LIMITS.approachMs.max);
    expect(out.density).toBe(DIFFICULTY_LIMITS.density.max);
    expect(out.streamMaxLength).toBe(DIFFICULTY_LIMITS.streamMaxLength.min);
  });

  it('snaps lengthSec to the nearest option of the mode, a tie going to the longer one', () => {
    const len = (mode: number, length: number): number | undefined =>
      decodeShare(codeOf(header({ mode, flags: mode === 0 ? 1 : 0, length }).concat(mode === 0 ? [3] : []))).launch.lengthSec;
    expect(len(0, 100)).toBe(90);
    expect(len(0, 105)).toBe(120);
    expect(len(0, 0)).toBe(60);
    expect(len(0, 65535)).toBe(300);
    expect(len(5, 100)).toBe(90); // spinning: 60, 90, 120 -> 100 is nearest to 90
    expect(len(9, 150)).toBe(180); // stamina: 120, 180, 300 -> 150 ties and goes up
  });

  it('cleanMods drops conflicts and mods a mode does not allow', () => {
    expect(cleanMods(['fast', 'slow'], 'dynamic')).toEqual(['fast']);
    expect(cleanMods(['fast'], 'jumps')).toEqual([]);
    expect(cleanMods(['mirror', 'mirror'], 'dynamic')).toEqual(['mirror']);
  });
});

describe('daily seed', () => {
  it('matches the plan vectors', () => {
    expect(dailySeed('2026-11-01')).toBe(1500758254);
    expect(dailySeed('2027-01-01')).toBe(2909596274);
  });

  it('is a u32 and differs by date', () => {
    const a = dailySeed('2026-11-02');
    expect(Number.isInteger(a) && a >= 0 && a < 2 ** 32).toBe(true);
    expect(a).not.toBe(dailySeed('2026-11-03'));
  });
});

describe('localDateKey', () => {
  it('uses local date parts', () => {
    const d = new Date(2026, 10, 1, 23, 59, 59, 999);
    expect(localDateKey(d.getTime())).toBe('2026-11-01');
    expect(localDateKey(new Date(2026, 10, 2, 0, 0, 0, 0).getTime())).toBe('2026-11-02');
    expect(localDateKey(new Date(2027, 0, 1, 0, 0, 0, 1).getTime())).toBe('2027-01-01');
    expect(localDateKey(new Date(2024, 1, 29, 12).getTime())).toBe('2024-02-29');
  });

  it('pads month and day', () => {
    expect(localDateKey(new Date(2026, 2, 5, 8).getTime())).toBe('2026-03-05');
  });
});
