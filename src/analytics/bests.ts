// Personal bests. Only completed plays count, and only plays from the same scoring version are compared.

import type { PbFlags, PlaySummary } from '../data/schema';
import { MODS } from '../shared/catalog';
import type { DifficultySettings, ModId, ModuleId } from '../shared/types';

/** Module levels and their bests change only after plays with no mods, or with Mirror alone. */
export function countsForProgress(mods: readonly ModId[]): boolean {
  return mods.every((m) => m === 'mirror');
}

function difficultyKey(d: DifficultySettings): string {
  return [
    d.radius,
    d.approachMs,
    d.bpm,
    d.density,
    d.spacing,
    d.complexity,
    d.streams,
    d.streamMaxLength,
    d.sliders,
    d.spinners,
    d.timing,
  ].join('-');
}

/** Scores compare only within the same setting, mod set and length. */
export function dynamicKey(s: PlaySummary): string {
  const setting = s.presetLevel !== null ? `L${s.presetLevel}` : `custom:${difficultyKey(s.launch.difficulty)}`;
  return `${setting}|${[...s.mods].sort().join('+')}|${s.launch.lengthSec}`;
}

export function dynamicLabel(s: PlaySummary): string {
  const setting = s.presetLevel !== null ? `Level ${s.presetLevel}` : 'Custom';
  const mods = s.mods.length ? ` with ${s.mods.map((m) => MODS[m].label).join(', ')}` : '';
  return `${setting}${mods}, ${s.launch.lengthSec} s`;
}

const completed = (s: PlaySummary) => s.status === 'completed';

export interface DynamicBest {
  key: string;
  label: string;
  plays: number;
  score: PlaySummary;
  accuracy: PlaySummary;
  combo: PlaySummary;
}

export interface ModuleBest {
  moduleId: ModuleId;
  level: number;
  summary: PlaySummary;
  plays: number;
}

/** 1.0 summaries have no scoringVersion and count as version 1. */
const scoringOf = (s: PlaySummary): number => s.scoringVersion ?? 1;

function latestScoring(summaries: readonly PlaySummary[]): number {
  return summaries.reduce((m, s) => Math.max(m, scoringOf(s)), 0);
}

export function computeBests(summaries: readonly PlaySummary[]): { dynamic: DynamicBest[]; modules: ModuleBest[] } {
  const done = summaries.filter(completed);
  const scoring = latestScoring(done);
  const current = done.filter((s) => scoringOf(s) === scoring);

  const groups = new Map<string, PlaySummary[]>();
  for (const s of current) {
    if (s.modeId !== 'dynamic') continue;
    const key = dynamicKey(s);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const dynamic: DynamicBest[] = [];
  for (const [key, list] of groups) {
    const by = (f: (s: PlaySummary) => number) => list.reduce((a, b) => (f(b) > f(a) ? b : a));
    dynamic.push({
      key,
      label: dynamicLabel(list[0]!),
      plays: list.length,
      score: by((s) => s.score),
      accuracy: by((s) => s.accuracy),
      combo: by((s) => s.maxCombo),
    });
  }
  dynamic.sort((a, b) => b.score.endedAt - a.score.endedAt);

  const best = new Map<ModuleId, ModuleBest>();
  for (const s of current) {
    if (!countsForProgress(s.mods)) continue;
    for (const [id, level] of Object.entries(s.finalLevels) as [ModuleId, number][]) {
      const prev = best.get(id);
      best.set(id, {
        moduleId: id,
        level: Math.max(level, prev?.level ?? 0),
        summary: prev && prev.level >= level ? prev.summary : s,
        plays: (prev?.plays ?? 0) + 1,
      });
    }
  }
  return { dynamic, modules: [...best.values()] };
}

/** Which records a new play breaks. `existing` is every earlier play. */
export function pbFlags(play: PlaySummary, existing: readonly PlaySummary[]): PbFlags {
  const flags: PbFlags = {};
  if (play.status !== 'completed') return flags;
  const same = existing.filter((s) => completed(s) && scoringOf(s) === scoringOf(play));
  if (play.modeId === 'dynamic') {
    const key = dynamicKey(play);
    const peers = same.filter((s) => s.modeId === 'dynamic' && dynamicKey(s) === key);
    if (peers.length > 0) {
      if (play.score > Math.max(...peers.map((s) => s.score))) flags.score = true;
      if (play.accuracy > Math.max(...peers.map((s) => s.accuracy))) flags.accuracy = true;
      if (play.maxCombo > Math.max(...peers.map((s) => s.maxCombo))) flags.combo = true;
    }
  }
  if (countsForProgress(play.mods)) {
    for (const [id, level] of Object.entries(play.finalLevels) as [ModuleId, number][]) {
      const earlier = same.filter((s) => countsForProgress(s.mods) && s.finalLevels[id] !== undefined);
      if (earlier.length > 0 && level > Math.max(...earlier.map((s) => s.finalLevels[id]!))) flags.level = true;
    }
  }
  return flags;
}
