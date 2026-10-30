import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { detectInsights } from '../analytics/insights';
import { deleteDatabase } from '../data/db';
import { listSummaries, loadPlayData, savePlay } from '../data/plays';
import { LEVEL_PRESETS } from '../shared/catalog';
import type { LaunchRequest } from '../shared/types';
import { WEAK_PLAYER } from '../game/sim/autoplay';
import type { PlayerModel } from '../game/sim/autoplay';
import { runHeadless } from '../game/sim/headless';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

/** Stops short of the player's longer jumps. Level 4 has few jumps past 4.5 widths, so it starts at 2.5. */
const UNDERSHOOTER: PlayerModel = { ...WEAK_PLAYER, name: 'undershooter', undershoot: { minSpacing: 2.5, radii: 0.45 } };

function launch(seed: number): LaunchRequest {
  const preset = LEVEL_PRESETS[3]!;
  return {
    modeId: 'dynamic',
    difficulty: preset.difficulty,
    presetLevel: preset.level,
    options: {},
    mods: [],
    seed,
    lengthSec: 90,
    levels: {},
    drillId: null,
  };
}

const CLEAN: PlayerModel = { ...UNDERSHOOTER, name: 'clean', undershoot: undefined };

beforeEach(async () => {
  await deleteDatabase();
});

describe('play, save, analyse', () => {
  it('finds the planted undershoot at the top', async () => {
    for (let i = 0; i < 5; i++) {
      const { result } = runHeadless({ launch: launch(40 + i), model: UNDERSHOOTER });
      const startedAt = NOW - (5 - i) * 6 * HOUR;
      const saved = await savePlay({ ...result, startedAt, endedAt: startedAt + result.playedMs }, startedAt + result.playedMs);
      expect(saved).not.toBeNull();
    }
    const summaries = await listSummaries();
    expect(summaries).toHaveLength(5);
    const plays = await loadPlayData(summaries);
    expect(plays.every((p) => p.records.length > 100)).toBe(true);
    const insights = detectInsights(plays, NOW);
    expect(insights.length).toBeGreaterThan(0);
    expect(insights[0]!.ruleId).toBe('long-undershoot');
  });

  it('stays quiet about undershoot for a player who aims true', async () => {
    for (let i = 0; i < 5; i++) {
      const { result } = runHeadless({ launch: launch(60 + i), model: CLEAN });
      const startedAt = NOW - (5 - i) * 6 * HOUR;
      await savePlay({ ...result, startedAt, endedAt: startedAt + result.playedMs }, startedAt + result.playedMs);
    }
    const plays = await loadPlayData(await listSummaries());
    const insights = detectInsights(plays, NOW);
    expect(insights.some((i) => i.ruleId === 'long-undershoot')).toBe(false);
  });

  /** Saves five plays of one model over the last 30 hours, then lists the insights for them. */
  async function insightsFor(model: PlayerModel, firstSeed: number) {
    for (let i = 0; i < 5; i++) {
      const { result } = runHeadless({ launch: launch(firstSeed + i), model });
      const startedAt = NOW - (5 - i) * 6 * HOUR;
      await savePlay({ ...result, startedAt, endedAt: startedAt + result.playedMs }, startedAt + result.playedMs);
    }
    return detectInsights(await loadPlayData(await listSummaries()), NOW);
  }

  it('finds a planted late leave near the top', async () => {
    const insights = await insightsFor({ ...CLEAN, name: 'late-leaver', leaveDelayMs: 90 }, 80);
    const rank = insights.findIndex((i) => i.ruleId === 'late-leave');
    expect(rank).toBeGreaterThanOrEqual(0);
    expect(rank).toBeLessThan(2);
  });

  it('finds a planted short first motion near the top', async () => {
    const insights = await insightsFor({ ...CLEAN, name: 'short-mover', primaryShort: 0.3 }, 100);
    const rank = insights.findIndex((i) => i.ruleId === 'first-motion');
    expect(rank).toBeGreaterThanOrEqual(0);
    expect(rank).toBeLessThan(2);
  });

  it('stays quiet about both for a player who leaves on time and moves in one motion', async () => {
    const insights = await insightsFor(CLEAN, 120);
    expect(insights.some((i) => i.ruleId === 'late-leave' || i.ruleId === 'first-motion')).toBe(false);
  });
});
