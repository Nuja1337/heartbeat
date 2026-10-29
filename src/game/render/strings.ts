// Every piece of text drawn on the canvas. It follows reference/writing.md.

/** A short name for a KeyboardEvent.code, as a player would say it. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Numpad ${code.slice(6)}`;
  if (code.startsWith('Arrow')) return code.slice(5);
  const names: Record<string, string> = {
    Space: 'Space',
    Semicolon: ';',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
  };
  return names[code] ?? code;
}

export const STRINGS = {
  /** First line of the start screen. */
  start: (key: string) => `Click or press ${key} to start`,
  startRaw: 'The pointer locks when you start. Esc pauses.',
  startAbsolute: 'Esc pauses.',
  clickToContinue: 'Click to continue',
  rawOffTitle: 'Raw input is off',
  rawOffSub: 'The pointer could not be locked, so this play uses the system pointer.',
  outOfHealth: 'Out of health',
  spinnerHint: 'Hold a key or button and circle the center',
  early: 'early',
  late: 'late',
  /** Label on the error bar, left and right ends. */
  barEarly: 'early',
  barLate: 'late',
  level: (level: number) => `Level ${level.toFixed(1)}`,
  setUp: (from: number) => `Up from ${from.toFixed(1)}`,
  setDown: (from: number) => `Down from ${from.toFixed(1)}`,
  setHold: (at: number) => `Holding at ${at.toFixed(1)}`,
  comboLost: (n: number) => `-${n}`,
  timing: (side: 'early' | 'late', ms: number) => `${side} ${Math.round(ms)} ms`,
  accuracy: (a: number) => `${(a * 100).toFixed(1)}%`,
  fps: (n: number) => `${Math.round(n)} fps`,
  rpmLabel: 'rpm',
  /** Digits for the resume countdown, indexed by the number shown. */
  countdown: ['0', '1', '2', '3'],
  bonus: '+1',
  /** The set number shown for adaptive modes. */
  set: (n: number) => `Set ${n}`,
} as const;

/** Text for the set-change banner. */
export function setChangeText(direction: 'up' | 'down' | 'hold', from: number, to: number): { title: string; sub: string } {
  const title = STRINGS.level(to);
  const sub = direction === 'up' ? STRINGS.setUp(from) : direction === 'down' ? STRINGS.setDown(from) : STRINGS.setHold(to);
  return { title, sub };
}
