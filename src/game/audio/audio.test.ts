import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/catalog';
import type { FeedbackEvent, FeedbackType } from '../engine/session';
import { fakeAudioContext } from '../testing/fakes';
import type { AudioLog } from '../testing/fakes';
import { AudioEngine } from './audio';
import { comboPitch } from './sounds';

const saved = (globalThis as Record<string, unknown>).window;
beforeEach(() => {
  (globalThis as Record<string, unknown>).window = { setTimeout: () => 0 };
});
afterEach(() => {
  (globalThis as Record<string, unknown>).window = saved;
});

const event = (type: FeedbackType, extra: Partial<FeedbackEvent> = {}): FeedbackEvent => ({
  type,
  t: 0,
  index: 0,
  judgment: null,
  x: 0,
  y: 0,
  value: 0,
  combo: 0,
  head: false,
  reason: null,
  setEnd: null,
  ...extra,
});

function engine() {
  const log: AudioLog = { oscillators: 0, sources: 0 };
  const a = new AudioEngine(DEFAULT_SETTINGS.audio, () => fakeAudioContext(log));
  return { a, log };
}

describe('AudioEngine', () => {
  it('makes no sound before the first gesture', () => {
    const { a, log } = engine();
    a.onEvent(event('hit', { judgment: 'crisp' }));
    expect(log.oscillators).toBe(0);
    expect(a.ready).toBe(false);
  });

  it('plays every kind of event', () => {
    const { a, log } = engine();
    a.resume();
    const types: FeedbackType[] = ['miss', 'tick', 'tickMiss', 'repeat', 'repeatMiss', 'endHit', 'endMiss', 'comboBreak', 'milestone', 'spinComplete', 'spinBonus', 'fail', 'stray', 'trackOn'];
    for (const t of types) a.onEvent(event(t));
    for (const j of ['crisp', 'solid', 'rough'] as const) a.onEvent(event('hit', { judgment: j }));
    a.onEvent(event('setEnd', { setEnd: { set: 0, module: 'jumps', from: 3, to: 3.5, success: 0.9, direction: 'up' } }));
    a.countdown();
    expect(log.oscillators).toBeGreaterThan(10);
    expect(log.sources).toBeGreaterThan(3);
  });

  it('caps the live voices', () => {
    const { a, log } = engine();
    a.resume();
    for (let i = 0; i < 100; i++) a.onEvent(event('hit', { judgment: 'crisp', combo: i }));
    expect(log.oscillators).toBeLessThanOrEqual(24);
  });

  it('runs the tracking and spinner hums', () => {
    const { a } = engine();
    a.resume();
    a.setTracking(true, 0.5);
    a.setTracking(false, 0);
    a.setSpinning(150);
    a.setSpinning(0);
    a.quiet();
    a.setSettings({ ...DEFAULT_SETTINGS.audio, muted: true });
    a.destroy();
    a.onEvent(event('miss'));
  });

  it('survives a browser without Web Audio', () => {
    const a = new AudioEngine(DEFAULT_SETTINGS.audio, () => {
      throw new Error('none');
    });
    a.resume();
    a.onEvent(event('miss'));
    expect(a.ready).toBe(false);
  });

  it('raises Crisp pitch two semitones for every 25 combo, up to four steps', () => {
    expect(comboPitch(0)).toBe(1);
    expect(comboPitch(24)).toBe(1);
    expect(comboPitch(25)).toBeCloseTo(Math.pow(2, 2 / 12), 9);
    expect(comboPitch(100)).toBeCloseTo(Math.pow(2, 8 / 12), 9);
    expect(comboPitch(900)).toBeCloseTo(Math.pow(2, 8 / 12), 9);
  });
});
