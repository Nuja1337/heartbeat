// What the settings change on the page itself: the judgment colors and reduced motion.

import { PALETTES } from '../../shared/catalog';
import type { PaletteId, Settings } from '../../shared/types';

/** The CSS variables for a palette. index.css reads them through --color-crisp and its siblings. The --fw- prefix keeps the old app name on purpose. */
export function paletteVars(id: PaletteId): Record<'--fw-crisp' | '--fw-solid' | '--fw-rough' | '--fw-miss', string> {
  const j = (PALETTES[id] ?? PALETTES.flickwise).judgments;
  return { '--fw-crisp': j.crisp, '--fw-solid': j.solid, '--fw-rough': j.rough, '--fw-miss': j.miss };
}

/** True when the OS asks for less motion. */
export function osPrefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Settings that were never saved have `updatedAt` 0. On that first run, reduced motion follows the OS.
 * The result is not written back, so the setting keeps following the OS until the player saves a choice.
 */
export function withFirstRunMotion(settings: Settings, osReduces: boolean): Settings {
  if (settings.updatedAt !== 0 || !osReduces || settings.display.reduceMotion) return settings;
  return { ...settings, display: { ...settings.display, reduceMotion: true } };
}

/** Writes the palette and the reduced-motion flag onto the root element. */
export function applyAppearance(settings: Settings, root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(paletteVars(settings.skin.palette))) root.style.setProperty(name, value);
  root.dataset.reduceMotion = settings.display.reduceMotion ? 'true' : 'false';
}

/** Whether motion is off right now, from the setting or the OS. Counters and draw-ins check it. */
export function motionReduced(): boolean {
  return document.documentElement.dataset.reduceMotion === 'true' || osPrefersReducedMotion();
}
