// First-run setup: step order, the stored state, the offset a calibration applies, and the new pages' first render.

import 'fake-indexeddb/auto';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteDatabase } from '../data/db';
import { getOnboarding } from '../data/meta';
import { Calibrate } from './pages/Calibrate';
import { Welcome } from './pages/Welcome';
import {
  EMPTY_ONBOARDING, finished, nextStep, offsetToApply, offsetWords, patchOnboarding, stepDone, withStepDone,
} from './state/onboarding';

beforeEach(async () => {
  await deleteDatabase();
});

describe('steps', () => {
  it('resume at the first step that is not finished', () => {
    expect(nextStep(EMPTY_ONBOARDING)).toBe('input');
    expect(nextStep({ ...EMPTY_ONBOARDING, input: true })).toBe('timing');
    expect(nextStep({ ...EMPTY_ONBOARDING, input: true, calibrated: true })).toBe('placement');
    expect(nextStep({ ...EMPTY_ONBOARDING, input: true, calibrated: true, placed: true })).toBeNull();
  });

  it('finishing the last step ends setup and keeps the first finish time', () => {
    let o = withStepDone(EMPTY_ONBOARDING, 'input', 10);
    o = withStepDone(o, 'timing', 20);
    expect(o.done).toBe(false);
    expect(stepDone(o, 'timing')).toBe(true);
    o = withStepDone(o, 'placement', 30);
    expect(o).toMatchObject({ done: true, at: 30, placed: true });
    expect(finished(o, 99).at).toBe(30);
  });

  it('skipping all of setup marks it done at once', () => {
    expect(finished(EMPTY_ONBOARDING, 5)).toMatchObject({ done: true, at: 5, input: false, calibrated: false, placed: false });
  });
});

describe('stored state', () => {
  it('is empty before setup starts and keeps each patch', async () => {
    expect(await getOnboarding()).toBeUndefined();
    await patchOnboarding((o) => ({ ...o, input: true }));
    await patchOnboarding((o) => ({ ...o, calibrated: true }));
    expect(await getOnboarding()).toMatchObject({ done: false, input: true, calibrated: true, placed: false });
  });
});

describe('calibration offsets', () => {
  it('rounds the median and holds it to the setting range', () => {
    expect(offsetToApply('visual', 12.4)).toBe(12);
    expect(offsetToApply('visual', -0.3)).toBe(0);
    expect(offsetToApply('visual', 400)).toBe(150);
    expect(offsetToApply('visual', -90)).toBe(-50);
    expect(offsetToApply('audio', 250.2)).toBe(250);
    expect(offsetToApply('audio', 999)).toBe(300);
    expect(offsetToApply('audio', -250)).toBe(-100);
  });

  it('describes a median in words', () => {
    expect(offsetWords(12.4)).toBe('12 ms late');
    expect(offsetWords(-8)).toBe('8 ms early');
    expect(offsetWords(0.2)).toBe('on the beat');
  });
});

describe('pages render', () => {
  const at = (path: string, element: ReturnType<typeof createElement>) =>
    renderToString(createElement(MemoryRouter, { initialEntries: [path] }, createElement(Routes, null, createElement(Route, { path: '*', element }))));

  it('Welcome waits for the stored state', () => {
    expect(at('/welcome', createElement(Welcome))).toContain('Loading.');
  });

  it('Calibrate shows the title for each kind', () => {
    expect(at('/calibrate?kind=visual', createElement(Calibrate))).toContain('Visual calibration');
    expect(at('/calibrate?kind=audio&from=welcome', createElement(Calibrate))).toContain('Audio calibration');
    expect(at('/calibrate?kind=audio&from=welcome', createElement(Calibrate))).toContain('Back to setup');
  });
});
