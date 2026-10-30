// Text on the calibration screens. It follows reference/writing.md: plain sentences, no colons joining clauses.

import type { CalibrationKind } from '../../shared/types';

export const CALIBRATION_STRINGS = {
  title: { visual: 'Visual calibration', audio: 'Audio calibration' } as Record<CalibrationKind, string>,
  ready: {
    visual: 'Press a hit key or click each time the ring closes on the target.',
    audio: 'Press a hit key or click on every click you hear.',
  } as Record<CalibrationKind, string>,
  start: 'Press a hit key or click to start.',
  leadIn: {
    visual: 'Watch the ring. Your taps count after four beats.',
    audio: 'Listen to the beat. Your taps count after four beats.',
  } as Record<CalibrationKind, string>,
  tapping: {
    visual: 'Tap as the ring closes.',
    audio: 'Tap with the clicks.',
  } as Record<CalibrationKind, string>,
  tooFar: 'That tap was too far from a beat and did not count.',
  paused: 'The page lost focus. Press a hit key or click to start again.',
  done: 'Done',
  doneSub: (offsetMs: number): string => `Your offset is ${Math.round(offsetMs)} ms.`,
  progress: (taps: number, needed: number): string => `${taps} of ${needed}`,
  beat: (n: number, total: number): string => `Beat ${n} of ${total}`,
  noCanvas: 'This browser could not start the calibration canvas.',
};
