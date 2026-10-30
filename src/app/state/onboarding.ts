// First-run setup (PLAN-2 §8.13). The progress lives in the meta key `onboarding`, so leaving and coming back
// resumes at the right step. A step's flag is set when the player finished it or skipped it.

import { useCallback, useEffect, useState } from 'react';
import { getOnboarding, setOnboarding } from '../../data/meta';
import type { Onboarding } from '../../data/schema';
import { SETTING_RANGES } from '../../shared/catalog';
import type { CalibrationKind } from '../../shared/types';

export type OnboardingStep = 'input' | 'timing' | 'placement';
export const STEPS: readonly { id: OnboardingStep; label: string }[] = [
  { id: 'input', label: 'Input' },
  { id: 'timing', label: 'Timing' },
  { id: 'placement', label: 'Placement' },
];

/** A spread above this many milliseconds means the taps were too uneven to trust the median. */
export const UNEVEN_SD_MS = 30;
export const UNEVEN_NOTE = 'Your taps were uneven. Try once more for a steadier number.';

export const EMPTY_ONBOARDING: Onboarding = { done: false, at: null, input: false, calibrated: false, placed: false };

const FLAG: Record<OnboardingStep, 'input' | 'calibrated' | 'placed'> = { input: 'input', timing: 'calibrated', placement: 'placed' };

export const stepDone = (o: Onboarding, step: OnboardingStep): boolean => o[FLAG[step]];

/** The first step that is not finished yet, or null when all three are. */
export function nextStep(o: Onboarding): OnboardingStep | null {
  return STEPS.find((s) => !stepDone(o, s.id))?.id ?? null;
}

/** `o` with a step marked as finished. When that was the last one, setup is done. */
export function withStepDone(o: Onboarding, step: OnboardingStep, now: number): Onboarding {
  const next = { ...o, [FLAG[step]]: true };
  return nextStep(next) === null ? finished(next, now) : next;
}

/** `o` marked as done, keeping the time it was first finished. */
export function finished(o: Onboarding, now: number): Onboarding {
  return { ...o, done: true, at: o.at ?? now };
}

/** The offset to save for a calibration: the median rounded to a whole millisecond and held to the setting's range. */
export function offsetToApply(kind: CalibrationKind, medianMs: number): number {
  const range = kind === 'visual' ? SETTING_RANGES.visualOffsetMs : SETTING_RANGES.audioOffsetMs;
  const rounded = Math.round(medianMs);
  return Math.min(range.max, Math.max(range.min, Object.is(rounded, -0) ? 0 : rounded));
}

/** How a calibration median reads: "12 ms late", "8 ms early" or "on the beat". */
export function offsetWords(medianMs: number): string {
  const v = Math.round(medianMs);
  if (v === 0) return 'on the beat';
  return `${Math.abs(v)} ms ${v > 0 ? 'late' : 'early'}`;
}

/** Writes a change to the stored state. It reads the row first, so two screens can't undo each other. */
export async function patchOnboarding(change: (o: Onboarding) => Onboarding): Promise<Onboarding> {
  const next = change((await getOnboarding()) ?? EMPTY_ONBOARDING);
  await setOnboarding(next);
  return next;
}

/** The stored state. `state` is null until it has been read, and EMPTY_ONBOARDING when setup never started. */
export function useOnboarding(): { state: Onboarding | null; error: string | null; update(change: (o: Onboarding) => Onboarding): Promise<void> } {
  const [state, setState] = useState<Onboarding | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getOnboarding().then(
      (o) => alive && setState(o ?? EMPTY_ONBOARDING),
      (e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Could not read your setup progress.');
        setState(EMPTY_ONBOARDING);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback(async (change: (o: Onboarding) => Onboarding) => {
    try {
      const next = await patchOnboarding(change);
      setState(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your setup progress.');
    }
  }, []);

  return { state, error, update };
}
