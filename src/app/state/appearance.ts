// What the settings change on the page itself: the theme, the text size, the contrast, the judgment colors,
// reduced motion and the language attributes. Everything lands on the root element, where index.css reads it.

import { useSyncExternalStore } from 'react';
import { PALETTES } from '../../shared/catalog';
import { LOCALES } from '../../shared/locales';
import type { Locale } from '../../shared/locales';
import { THEMES, paletteForTheme, resolveTheme } from '../../shared/theme';
import type { ThemeId } from '../../shared/theme';
import type { PaletteId, Settings } from '../../shared/types';

/** The keys the boot script in index.html reads before the first paint. They mirror the saved settings. */
export const BOOT_KEYS = { theme: 'hb-theme', text: 'hb-text', contrast: 'hb-contrast' } as const;

function media(query: string): MediaQueryList | null {
  try {
    return typeof matchMedia === 'function' ? matchMedia(query) : null;
  } catch {
    return null;
  }
}

/** True when the OS asks for less motion. */
export function osPrefersReducedMotion(): boolean {
  return media('(prefers-reduced-motion: reduce)')?.matches ?? false;
}

export function osPrefersLight(): boolean {
  return media('(prefers-color-scheme: light)')?.matches ?? false;
}

export function osPrefersMoreContrast(): boolean {
  return media('(prefers-contrast: more)')?.matches ?? false;
}

/** The theme on screen for these settings, right now. */
export const themeOf = (settings: Pick<Settings, 'display'>): ThemeId => resolveTheme(settings.display.theme, osPrefersLight());

/** The CSS variables for a palette on a theme. index.css reads them through --color-crisp and its siblings. */
export function paletteVars(id: PaletteId, theme: ThemeId): Record<'--hb-crisp' | '--hb-solid' | '--hb-rough' | '--hb-miss', string> {
  const p = PALETTES[id] ?? PALETTES.heartbeat;
  const j = paletteForTheme(id, p, theme).judgments;
  return { '--hb-crisp': j.crisp, '--hb-solid': j.solid, '--hb-rough': j.rough, '--hb-miss': j.miss };
}

/**
 * Settings that were never saved have `updatedAt` 0. On that first run, reduced motion follows the OS.
 * The result is not written back, so the setting keeps following the OS until the player saves a choice.
 */
export function withFirstRunMotion(settings: Settings, osReduces: boolean): Settings {
  if (settings.updatedAt !== 0 || !osReduces || settings.display.reduceMotion) return settings;
  return { ...settings, display: { ...settings.display, reduceMotion: true } };
}

/* ------------------------------------------------------------ the theme on screen, for components */

let currentTheme: ThemeId = 'dark';
const themeListeners = new Set<() => void>();
const subscribeTheme = (l: () => void) => {
  themeListeners.add(l);
  return () => themeListeners.delete(l);
};
const getTheme = () => currentTheme;

/** The theme on screen. Charts and previews re-render when it changes. */
export const useTheme = (): ThemeId => useSyncExternalStore(subscribeTheme, getTheme, getTheme);
export const getCurrentTheme = (): ThemeId => currentTheme;

function remember(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private windows and blocked storage: the boot script falls back to the OS, which is fine.
  }
}

/** Writes the theme, the text size, the contrast, the palette and the reduced-motion flag onto the root element. */
export function applyAppearance(settings: Settings, root: HTMLElement = document.documentElement): void {
  const theme = themeOf(settings);
  root.dataset.theme = theme;
  if (settings.display.textSize === 'default') delete root.dataset.text;
  else root.dataset.text = settings.display.textSize;
  const contrast = settings.display.highContrast || osPrefersMoreContrast();
  if (contrast) root.dataset.contrast = 'high';
  else delete root.dataset.contrast;
  for (const [name, value] of Object.entries(paletteVars(settings.skin.palette, theme))) root.style.setProperty(name, value);
  root.dataset.reduceMotion = settings.display.reduceMotion ? 'true' : 'false';

  // The browser chrome follows the page background on phones.
  const bg = THEMES[theme].bg;
  for (const meta of root.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = bg;

  remember(BOOT_KEYS.theme, settings.display.theme === 'system' ? null : settings.display.theme);
  remember(BOOT_KEYS.text, settings.display.textSize === 'default' ? null : settings.display.textSize);
  remember(BOOT_KEYS.contrast, settings.display.highContrast ? 'high' : null);

  if (theme !== currentTheme) {
    currentTheme = theme;
    themeListeners.forEach((l) => l());
  }
}

/** Sets the language attributes on the root element. The dictionary itself is handled by src/app/i18n. */
export function applyLanguage(locale: Locale, root: HTMLElement = document.documentElement): void {
  root.lang = locale;
  root.dir = LOCALES.find((l) => l.id === locale)?.dir ?? 'ltr';
}

/**
 * Re-applies the appearance when the OS theme or contrast preference changes, for settings that follow the OS.
 * Returns a function that stops listening.
 */
export function watchOs(apply: () => void): () => void {
  const lists = [media('(prefers-color-scheme: light)'), media('(prefers-contrast: more)')].filter((m): m is MediaQueryList => m !== null);
  for (const m of lists) m.addEventListener('change', apply);
  return () => {
    for (const m of lists) m.removeEventListener('change', apply);
  };
}

/** Whether motion is off right now, from the setting or the OS. Counters and draw-ins check it. */
export function motionReduced(): boolean {
  return document.documentElement.dataset.reduceMotion === 'true' || osPrefersReducedMotion();
}
