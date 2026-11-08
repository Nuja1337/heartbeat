// Logic behind the Settings, Play setup, Train and share-link pages: share text, the share route's decoding,
// the skin-preview and placement launches, the map panel's counts and the difficulty graph.

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { demandTimeline } from '../analytics/index';
import { DEFAULT_SETTINGS, LEVEL_PRESETS, MODES, MODE_ORDER } from '../shared/catalog';
import { decodeShare, encodeShare } from '../shared/codes';
import type { LaunchRequest, ObjectFeatures, PlayableMap } from '../shared/types';
import { DifficultyGraph, demandRuns, graphSummary } from './components/DifficultyGraph';
import { lastPlayedText, modeLevel } from './components/ModeCard';
import { shareText } from './components/ShareButton';
import { replayExportMb, rejectRetryKey } from './pages/Settings';
import { SHARED_VERSION_NOTE } from './pages/Share';
import {
  PLACEMENT_LENGTH_SEC,
  SKIN_PREVIEW,
  dynamicLaunch,
  mapStats,
  moduleLaunch,
  placementLaunch,
  presetDifficulty,
  readShareLink,
  setupPath,
  sharedFrom,
  skinPreviewLaunch,
} from './state/launch';

const base = (over: Partial<LaunchRequest> = {}): LaunchRequest => ({
  ...dynamicLaunch({ presetLevel: 4, difficulty: presetDifficulty(4), mods: ['mirror'], lengthSec: 90, seed: 123456789, levels: {} }),
  ...over,
});

describe('share text', () => {
  it('names the mode, the level and the mods before the link', () => {
    expect(shareText(base(), 'https://x.test/s/abc')).toBe('Heartbeat map: Dynamic, Level 4, Mirror. https://x.test/s/abc');
    expect(shareText(base({ mods: [] }), 'u')).toBe('Heartbeat map: Dynamic, Level 4. u');
    expect(shareText(base({ presetLevel: null, mods: ['fade', 'fast'] }), 'u')).toBe('Heartbeat map: Dynamic, custom, Fade, Fast. u');
  });

  it('names a module by its label alone', () => {
    const jumps = moduleLaunch({ modeId: 'jumps', options: {}, mods: [], lengthSec: 90, seed: 5, levels: {}, drillId: null });
    expect(shareText(jumps, 'u')).toBe('Heartbeat map: Jumps. u');
  });
});

describe('share route', () => {
  it('opens the Play screen for a Dynamic code, with the launch filled in', () => {
    const link = readShareLink('AQABFc1bB1oAQAACBEM');
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    expect(link.path).toBe('/play');
    expect(link.generatorVersion).toBe(2);
    expect(link.launch).toMatchObject({
      modeId: 'dynamic',
      presetLevel: 4,
      seed: 123456789,
      lengthSec: 90,
      mods: ['mirror'],
      levels: {},
      drillId: null,
    });
    expect(link.launch.difficulty).toEqual(LEVEL_PRESETS[3]!.difficulty);
  });

  it('opens the module setup for a module code, with no levels of its own', () => {
    const jumps = moduleLaunch({
      modeId: 'jumps',
      options: { distanceFocus: 'long', directionFocus: 3 },
      mods: [],
      lengthSec: 120,
      seed: 77,
      levels: { jumps: 9 },
      drillId: 'd1',
    });
    const link = readShareLink(encodeShare(jumps, 2));
    expect(link.ok && link.path).toBe('/train/jumps');
    if (!link.ok) return;
    expect(link.launch.options).toMatchObject({ distanceFocus: 'long', directionFocus: 3 });
    expect(link.launch.levels).toEqual({});
    expect(link.launch.drillId).toBeNull();
  });

  it('keeps the encoded generator version for the version note', () => {
    const link = readShareLink(encodeShare(base(), 1));
    expect(link.ok && link.generatorVersion).toBe(1);
    expect(SHARED_VERSION_NOTE).toMatch(/different map generator/);
  });

  it('returns the decoder message for a damaged code', () => {
    const bad = readShareLink('AQABFc1bB1oAQAACBEN');
    expect(bad).toEqual({ ok: false, kind: 'invalid', message: "This code isn't valid." });
    for (const code of [undefined, '', '   ', '!!!', 'AQ']) {
      const r = readShareLink(code);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.kind).toBe('invalid');
    }
  });

  it('says so when the code is from a newer version', () => {
    // A well-formed code: a version above ours, a header, and the checksum byte (the sum of the bytes before it, xor 0xa5).
    const body = [2, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 2, 4];
    const code = Buffer.from([...body, (body.reduce((a, b) => a + b, 0) & 255) ^ 0xa5]).toString('base64url');
    expect(() => decodeShare(code)).toThrow();
    expect(readShareLink(code)).toEqual({ ok: false, kind: 'newer', message: 'This code was made by a newer version of Heartbeat.' });
  });

  it('does not open a Placement code', () => {
    const code = encodeShare(placementLaunch({}, 5), 2);
    expect(readShareLink(code).ok).toBe(false);
  });

  it('reads the shared launch from the router state only for the matching mode', () => {
    const state = { prefill: base(), shared: { generatorVersion: 2 } };
    expect(sharedFrom(state, 'dynamic')?.shared.generatorVersion).toBe(2);
    expect(sharedFrom(state, 'jumps')).toBeNull();
    expect(sharedFrom(null, 'dynamic')).toBeNull();
    expect(sharedFrom({ prefill: base() }, 'dynamic')).toBeNull();
  });
});

describe('skin preview launch', () => {
  it('is Dynamic Level 3, seed 1, 30 seconds, with no mods', () => {
    const l = skinPreviewLaunch();
    expect(SKIN_PREVIEW).toEqual({ presetLevel: 3, seed: 1, lengthSec: 30 });
    expect(l).toMatchObject({ modeId: 'dynamic', presetLevel: 3, seed: 1, lengthSec: 30, mods: [], drillId: null });
    expect(l.difficulty).toEqual(LEVEL_PRESETS[2]!.difficulty);
    expect(skinPreviewLaunch()).toEqual(l);
  });
});

describe('placement launch', () => {
  it('has no mods or options, runs 240 seconds and carries the saved levels', () => {
    const l = placementLaunch({ jumps: 5.5, streams: 4 }, 9);
    expect(l).toMatchObject({
      modeId: 'placement',
      mods: [],
      options: {},
      lengthSec: 240,
      seed: 9,
      drillId: null,
      levels: { jumps: 5.5, streams: 4 },
    });
    expect(PLACEMENT_LENGTH_SEC).toBe(MODES.placement.defaultLengthSec);
  });

  it('stays out of the Train grid and goes back to Train', () => {
    expect(MODE_ORDER).not.toContain('placement');
    expect(setupPath(placementLaunch({}))).toBe('/train');
    expect(setupPath(base())).toBe('/play');
  });

  it('is accepted by the module launch builder, which drops every mod', () => {
    const l = moduleLaunch({
      modeId: 'placement',
      options: {},
      mods: ['fast', 'mirror'],
      lengthSec: 240,
      seed: 1,
      levels: {},
      drillId: null,
    });
    expect(l.mods).toEqual([]);
  });
});

describe('map panel', () => {
  // 40 taps 150 ms apart, then a slider and a spinner, then 20 jumps.
  const windows = { crisp: 40, solid: 80, rough: 120 };
  const common = { pos: { x: 500, y: 300 }, radius: 40, approachMs: 600, windows, group: 0, number: 1, pattern: 'jump', intensity: 0.5 };
  const objects = [
    ...Array.from({ length: 40 }, (_, i) => ({ ...common, kind: 'circle' as const, index: i, time: 1000 + i * 150 })),
    { ...common, kind: 'slider' as const, index: 40, time: 8000, velocity: 0.4, followRadius: 70, endTime: 8800 },
    { ...common, kind: 'spinner' as const, index: 41, time: 9500, endTime: 11_000, rotationsRequired: 3 },
    ...Array.from({ length: 20 }, (_, i) => ({ ...common, kind: 'circle' as const, index: 42 + i, time: 12_000 + i * 500 })),
  ];
  const map = { objects, durationMs: 30_000, sections: [], mods: [], rate: 1 } as unknown as PlayableMap;
  const features = objects.map((o, i): ObjectFeatures => {
    const stream = i > 0 && i < 40;
    return {
      distance: i === 0 ? null : stream ? 30 : 300,
      gapMs: i === 0 ? null : stream ? 150 : 500,
      velocity: null,
      spacing: stream ? 0.4 : 3.75,
      turnAngle: null,
      direction: null,
      runIndex: i < 40 ? i + 1 : 0,
      runLength: i < 40 ? 40 : 0,
      visibleCount: 3,
      progress: o.time / 30_000,
    };
  });

  it('counts objects, sliders, spinners and the longest stream', () => {
    const stats = mapStats(map, features);
    expect(stats.objects).toBe(map.objects.length);
    expect(stats.sliders).toBe(map.objects.filter((o) => o.kind === 'slider').length);
    expect(stats.spinners).toBe(map.objects.filter((o) => o.kind === 'spinner').length);
    expect(stats).toEqual({ objects: 62, perMinute: 124, longestStream: 40, sliders: 1, spinners: 1 });
  });

  it('reports no stream when no run has three objects', () => {
    expect(mapStats({ objects: [], durationMs: 0 }, [])).toEqual({ objects: 0, perMinute: 0, longestStream: 0, sliders: 0, spinners: 0 });
  });

  it('draws the difficulty graph from demandTimeline', () => {
    const timeline = demandTimeline(map, features, 2000);
    expect(timeline.bins.length).toBe(Math.ceil(map.durationMs / 2000));
    const html = renderToString(createElement(DifficultyGraph, { timeline }));
    expect(html).toContain('<svg');
    expect(html).toContain('Demand, on the level scale');
    expect(graphSummary(timeline)).toMatch(/^Difficulty over \d+:\d\d, from level [\d.]+ at the lowest to level [\d.]+ at the highest\.$/);
  });

  it('breaks the line where a bin has no objects and draws a band for each role', () => {
    const bin = (i: number, overall: number | null) => ({
      start: i * 2000,
      end: (i + 1) * 2000,
      aim: overall,
      speed: overall,
      overall,
      n: overall === null ? 0 : 3,
    });
    const timeline = {
      binMs: 2000,
      bins: [bin(0, 2), bin(1, 3), bin(2, null), bin(3, 4)],
      sections: [
        { start: 0, end: 4000, role: 'build' as const, focus: 'jumps' as const, intensity: 0.4 },
        { start: 4000, end: 8000, role: 'peak' as const, focus: 'mixed' as const, intensity: 0.9 },
      ],
    };
    expect(demandRuns(timeline.bins).map((r) => r.length)).toEqual([2, 1]);
    const html = renderToString(createElement(DifficultyGraph, { timeline }));
    expect(html).toContain('Build, 0:00 to 0:04');
    expect(html).toContain('Peak, 0:04 to 0:08');
    expect(graphSummary({ binMs: 2000, bins: [bin(0, null)], sections: [] })).toBe('The map has no demand to show.');
  });
});

describe('Train cards', () => {
  it('show a module level, or the starting level before the first play', () => {
    expect(modeLevel('jumps', { level: 4.25 }, true)).toEqual({ value: 4.25, caption: 'Your level' });
    expect(modeLevel('jumps', undefined, true)).toEqual({ value: 3, caption: 'Starting level' });
    expect(modeLevel('mix', undefined, false).text).toBe('Adaptive');
    expect(modeLevel('stamina', undefined, false).text).toBe('Fixed');
  });

  it('say when a mode was last played', () => {
    expect(lastPlayedText(null)).toBe('Not played yet');
    expect(lastPlayedText(1_000_000, 1_000_000 + 2 * 86_400_000)).toBe('Last played 2 days ago');
  });
});

describe('Settings helpers', () => {
  it('refuses Escape, Tab and the hit keys as the retry key', () => {
    const keys = ['KeyZ', 'KeyX'];
    expect(rejectRetryKey('Escape', keys)).toMatch(/pause/);
    expect(rejectRetryKey('Tab', keys)).toMatch(/Tab/);
    expect(rejectRetryKey('KeyZ', keys)).toMatch(/hit keys/);
    expect(rejectRetryKey('KeyX', keys)).toMatch(/hit keys/);
    expect(rejectRetryKey('Backquote', keys)).toBeNull();
    expect(rejectRetryKey(DEFAULT_SETTINGS.input.retryKey, DEFAULT_SETTINGS.input.keys)).toBeNull();
  });

  it('estimates the replay part of an export in megabytes', () => {
    expect(replayExportMb(0)).toBe('under 0.1 MB');
    expect(replayExportMb(3 * 1024 ** 2)).toBe('4.0 MB');
  });
});

describe('Settings and the share page render', () => {
  it('lists every settings section', async () => {
    const { Settings } = await import('./pages/Settings');
    const html = renderToString(createElement(MemoryRouter, null, createElement(Settings)));
    for (const name of ['Input', 'Look', 'Sound', 'Timing', 'Display', 'Goals', 'Data', 'App']) expect(html).toContain(`>${name}<`);
    expect(html).toContain('/calibrate?kind=visual');
    expect(html).toContain('/calibrate?kind=audio');
    expect(html).toContain('Retry key');
  });
});
