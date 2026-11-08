// Every piece of text drawn on the canvas. It follows reference/writing.md. Each entry translates when it is read,
// so the HUD follows a language change on the next frame.

import { formatNumber, t } from '../../shared/i18n';

export { keyLabel } from '../../shared/keys';

const one = (n: number) => formatNumber(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const STRINGS = {
  /** First line of the start screen. */
  start: (key: string) => t('Click or press {key} to start', { key }),
  get startRaw() {
    return t('The pointer locks when you start. Esc pauses.');
  },
  get startAbsolute() {
    return t('Esc pauses.');
  },
  get clickToContinue() {
    return t('Click to continue');
  },
  get rawOffTitle() {
    return t('Raw input is off');
  },
  get rawOffSub() {
    return t('The pointer could not be locked, so this play uses the system pointer.');
  },
  get outOfHealth() {
    return t('Out of health');
  },
  get spinnerHint() {
    return t('Hold a key or button and circle the center');
  },
  get early() {
    return t('early');
  },
  get late() {
    return t('late');
  },
  /** Label on the error bar, left and right ends. */
  get barEarly() {
    return t('early');
  },
  get barLate() {
    return t('late');
  },
  level: (level: number) => t('Level {level}', { level: one(level) }),
  setUp: (from: number) => t('Up from {level}', { level: one(from) }),
  setDown: (from: number) => t('Down from {level}', { level: one(from) }),
  setHold: (at: number) => t('Holding at {level}', { level: one(at) }),
  comboLost: (n: number) => `-${n}`,
  timing: (side: 'early' | 'late', ms: number) => t('{side, select, early {early} other {late}} {ms} ms', { side, ms: Math.round(ms) }),
  accuracy: (a: number) => `${one(a * 100)}%`,
  fps: (n: number) => t('{n} fps', { n: Math.round(n) }),
  /** The 99th percentile frame time under the frame graph. */
  p99: (ms: number) => t('p99 {ms} ms', { ms: one(ms) }),
  get rpmLabel() {
    return t('rpm');
  },
  /** Shown under the combo while the retry key is held. */
  get retrying() {
    return t('Restarting');
  },
  /** Digits for the resume countdown, indexed by the number shown. */
  countdown: ['0', '1', '2', '3'],
  bonus: '+1',
  /** The set number shown for adaptive modes. */
  set: (n: number) => t('Set {n}', { n }),
};

/** Text for the set-change banner. */
export function setChangeText(direction: 'up' | 'down' | 'hold', from: number, to: number): { title: string; sub: string } {
  const title = STRINGS.level(to);
  const sub = direction === 'up' ? STRINGS.setUp(from) : direction === 'down' ? STRINGS.setDown(from) : STRINGS.setHold(to);
  return { title, sub };
}
