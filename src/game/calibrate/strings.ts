// Text on the calibration screens. It follows reference/writing.md: plain sentences, no colons joining clauses.
// Each entry translates when it is read.

import { t } from '../../shared/i18n';
import type { CalibrationKind } from '../../shared/types';

export const CALIBRATION_STRINGS = {
  title: (kind: CalibrationKind): string => (kind === 'visual' ? t('Visual calibration') : t('Audio calibration')),
  ready: (kind: CalibrationKind): string =>
    kind === 'visual'
      ? t('Press a hit key or click each time the ring closes on the target.')
      : t('Press a hit key or click on every click you hear.'),
  get start() {
    return t('Press a hit key or click to start.');
  },
  leadIn: (kind: CalibrationKind): string =>
    kind === 'visual' ? t('Watch the ring. Your taps count after four beats.') : t('Listen to the beat. Your taps count after four beats.'),
  tapping: (kind: CalibrationKind): string => (kind === 'visual' ? t('Tap as the ring closes.') : t('Tap with the clicks.')),
  get tooFar() {
    return t('That tap was too far from a beat and did not count.');
  },
  get paused() {
    return t('The page lost focus. Press a hit key or click to start again.');
  },
  get done() {
    return t('Done');
  },
  doneSub: (offsetMs: number): string => t('Your offset is {ms} ms.', { ms: Math.round(offsetMs) }),
  progress: (taps: number, needed: number): string => t('{taps} of {needed}', { taps, needed }),
  beat: (n: number, total: number): string => t('Beat {n} of {total}', { n, total }),
  get noCanvas() {
    return t('This browser could not start the calibration canvas.');
  },
  get noSound() {
    return t("Sound couldn't start in this browser, so the audio calibration can't run.");
  },
};
