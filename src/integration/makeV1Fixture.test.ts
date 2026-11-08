// Builds src/data/fixtures/v1-export.json from the real 1.0 code paths.
// Run once, on the code tagged v1.0, with MAKE_FIXTURE=1. The committed file is never regenerated:
// 2.0 tests use it to prove that 1.0 data and 1.0 export files still load intact.

import 'fake-indexeddb/auto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { deleteDatabase } from '../data/db';
import { saveDrill } from '../data/drills';
import { buildExport, validateExport } from '../data/exportImport';
import { getTierHistory, setTierHistory } from '../data/meta';
import { listSummaries, savePlay } from '../data/plays';
import { loadProgress } from '../data/progress';
import type { Drill } from '../data/schema';
import { cloneSettings, loadSettings, saveSettings } from '../data/settings';
import { NOISY_PLAYER } from '../game/sim/autoplay';
import { runHeadless } from '../game/sim/headless';
import { DEFAULT_DIFFICULTY, DEFAULT_SETTINGS, LEVEL_PRESETS } from '../shared/catalog';
import type { LaunchRequest, ModeId, ModuleOptions } from '../shared/types';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../data/fixtures/v1-export.json');

const T0 = 1_760_000_000_000; // fixed start of the first play
const HOUR = 3_600_000;
const EXPORTED_AT = T0 + 100 * HOUR;

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

function launch(modeId: ModeId, seed: number, lengthSec: number, options: ModuleOptions = {}): LaunchRequest {
  if (modeId === 'dynamic') {
    const preset = LEVEL_PRESETS[2]!; // Level 3
    return {
      modeId,
      difficulty: preset.difficulty,
      presetLevel: preset.level,
      options,
      mods: [],
      seed,
      lengthSec,
      levels: {},
      drillId: null,
    };
  }
  return {
    modeId,
    difficulty: { ...DEFAULT_DIFFICULTY },
    presetLevel: null,
    options,
    mods: [],
    seed,
    lengthSec,
    levels: {},
    drillId: null,
  };
}

describe.skipIf(!process.env.MAKE_FIXTURE)('make the 1.0 fixture', () => {
  it('writes src/data/fixtures/v1-export.json', async () => {
    await deleteDatabase();
    // Play ids and the device id come from crypto.randomUUID. Fix them so the file reads the same on every run.
    let n = 0;
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` as Uuid);
    vi.spyOn(Date, 'now').mockReturnValue(EXPORTED_AT);

    const plays: { launch: LaunchRequest; startedAt: number; maxMs?: number }[] = [
      { launch: launch('dynamic', 1101, 45), startedAt: T0 },
      { launch: launch('jumps', 1102, 45, { distanceFocus: 'long' }), startedAt: T0 + 24 * HOUR },
      { launch: launch('mix', 1103, 45, { mixModules: ['jumps', 'streams', 'angles'] }), startedAt: T0 + 48 * HOUR },
      { launch: launch('dynamic', 1104, 45), startedAt: T0 + 72 * HOUR, maxMs: 25_000 },
    ];
    const statuses: string[] = [];
    for (const p of plays) {
      const { result } = runHeadless({ launch: p.launch, model: NOISY_PLAYER, maxMs: p.maxMs });
      const endedAt = p.startedAt + result.playedMs;
      const saved = await savePlay({ ...result, startedAt: p.startedAt, endedAt }, endedAt);
      expect(saved).not.toBeNull();
      statuses.push(result.status);
    }
    expect(statuses[0]).toBe('completed');
    expect(statuses[3]).toBe('quit');

    const drill: Drill = {
      id: '00000000-0000-4000-9000-000000000001',
      ruleId: 'long-undershoot',
      variant: null,
      modeId: 'jumps',
      options: { distanceFocus: 'long' },
      title: 'Long jumps stop short',
      createdAt: T0 + 50 * HOUR,
      baseline: { kind: 'mean', mean: -0.35, sd: 0.4, n: 40 },
      status: 'active',
      final: null,
    };
    await saveDrill(drill);

    const settings = cloneSettings(await loadSettings());
    settings.input.sensitivity = 1.7;
    settings.input.keys = ['KeyA', 'KeyS'];
    settings.input.rawInput = true;
    settings.input.cursor = 'drawn';
    settings.audio.master = 0.35;
    settings.audio.hits = 0.5;
    settings.display.showFps = true;
    settings.display.reduceMotion = true;
    settings.data.detailRetentionDays = 90;
    await saveSettings(settings);

    // savePlay may have written tier events of its own. Keep them and make sure the history is not empty.
    const tiers = await getTierHistory();
    if (Object.values(tiers).every((h) => (h?.length ?? 0) === 0)) {
      tiers.aim = [{ tier: 1, at: T0 + 12 * HOUR }];
      await setTierHistory(tiers);
    }

    const file = await buildExport({ engineVersion: 1, generatorVersion: 1 }, {}, EXPORTED_AT);
    const summaries = await listSummaries();
    const progress = await loadProgress();
    vi.restoreAllMocks();

    expect(file.plays).toHaveLength(4);
    expect(file.drills).toHaveLength(1);
    expect(file.progress).toHaveLength(3);
    expect(Object.values(file.meta.tiers).some((h) => (h?.length ?? 0) > 0)).toBe(true);
    const changed = [
      file.settings.input.sensitivity !== DEFAULT_SETTINGS.input.sensitivity,
      file.settings.input.keys[0] !== DEFAULT_SETTINGS.input.keys[0],
      file.settings.input.rawInput !== DEFAULT_SETTINGS.input.rawInput,
      file.settings.input.cursor !== DEFAULT_SETTINGS.input.cursor,
      file.settings.audio.master !== DEFAULT_SETTINGS.audio.master,
      file.settings.audio.hits !== DEFAULT_SETTINGS.audio.hits,
      file.settings.display.showFps !== DEFAULT_SETTINGS.display.showFps,
      file.settings.display.reduceMotion !== DEFAULT_SETTINGS.display.reduceMotion,
      file.settings.data.detailRetentionDays !== DEFAULT_SETTINGS.data.detailRetentionDays,
    ].filter(Boolean).length;
    expect(changed).toBeGreaterThanOrEqual(5);
    const quit = file.plays.find((p) => p.summary.status === 'quit')!;
    expect(quit.summary.objectCount).toBeGreaterThanOrEqual(20);

    const json = JSON.stringify(file, null, 2) + '\n';
    expect(json.length).toBeLessThan(1_500_000);
    mkdirSync(dirname(FIXTURE), { recursive: true });
    writeFileSync(FIXTURE, json);

    console.log(
      JSON.stringify({
        bytes: json.length,
        plays: summaries.map((s) => ({ id: s.id, mode: s.modeId, status: s.status, objects: s.objectCount, startedAt: s.startedAt })),
        progress: Object.values(progress).map((r) => r && { moduleId: r.moduleId, level: r.level, sessions: r.sessions }),
        tiers: file.meta.tiers,
      }),
    );
  });
});

describe('the committed 1.0 fixture', () => {
  it.skipIf(!existsSync(FIXTURE))('passes the 1.0 import validator and holds what the plan says', () => {
    const raw: unknown = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const file = validateExport(raw);
    expect(file.formatVersion).toBe(1);
    expect(file.plays).toHaveLength(4);
    expect(file.drills).toHaveLength(1);
    expect(file.progress).toHaveLength(3);
    expect(Object.values(file.meta.tiers).some((h) => (h?.length ?? 0) > 0)).toBe(true);
    expect(file.plays.every((p) => p.detail !== null)).toBe(true);
    expect(file.plays.some((p) => p.summary.status === 'quit' && p.summary.objectCount >= 20)).toBe(true);
  });
});
