// Key names as a player would say them, from a KeyboardEvent.code. The canvas and the menus both use this.

const NAMES: Record<string, string> = {
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
  CapsLock: 'Caps Lock',
  Escape: 'Esc',
};

/** "KeyZ" is "Z", "Digit3" is "3", "Backquote" is "`" and "ArrowLeft" is "Left". Unknown codes are split into words. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Numpad ${code.slice(6)}`;
  if (code.startsWith('Arrow')) return code.slice(5);
  return NAMES[code] ?? code.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
}
