// The language layer for React: the hook that re-renders on a change, sentences with elements inside them, and the
// loading of a dictionary. The dictionaries are JSON files under src/i18n/locales, one chunk each, so an English
// reader downloads none of them.

import { Fragment, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { getLocale, onLocaleChange, placeholders, raw, setLocale } from '../shared/i18n';
import type { Dictionary } from '../shared/i18n';
import { pickLocale } from '../shared/locales';
import type { LanguageChoice, Locale } from '../shared/locales';

export { count, msg, t } from '../shared/i18n';

/** The language on screen. A component that calls this re-renders when it changes. */
export const useLocale = (): Locale => useSyncExternalStore(onLocaleChange, getLocale, getLocale);

/**
 * A translated sentence with elements in it, such as a link. The English sentence names each part in braces, and
 * `parts` supplies them: tx('Read the {guide} first.', { guide: <Link to="/guide">guide</Link> }).
 */
export function tx(message: string, parts: Record<string, ReactNode>, context?: string): ReactNode {
  const text = raw(message, context);
  const names = placeholders(text);
  if (names.length === 0) return text;
  const pieces = text.split(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/);
  // split() alternates literal text and placeholder names.
  return pieces.map((piece, i) => (i % 2 === 0 ? piece : <Fragment key={i}>{parts[piece] ?? `{${piece}}`}</Fragment>));
}

const loaders: Record<Exclude<Locale, 'en'>, () => Promise<{ default: Dictionary }>> = {
  es: () => import('../i18n/locales/es.json'),
  'pt-BR': () => import('../i18n/locales/pt-BR.json'),
  fr: () => import('../i18n/locales/fr.json'),
  de: () => import('../i18n/locales/de.json'),
  ru: () => import('../i18n/locales/ru.json'),
  ja: () => import('../i18n/locales/ja.json'),
  ko: () => import('../i18n/locales/ko.json'),
  'zh-CN': () => import('../i18n/locales/zh-CN.json'),
};

/** The language a choice means in this browser. */
export function languageFor(choice: LanguageChoice): Locale {
  if (choice !== 'auto') return choice;
  try {
    return pickLocale(typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]));
  } catch {
    return 'en';
  }
}

let loading: Promise<Locale> | null = null;

/**
 * Loads the dictionary and makes it the language on screen. English needs no file. A failed download leaves the
 * current language in place and resolves, so the app never waits on a translation.
 */
export function activateLocale(locale: Locale): Promise<Locale> {
  if (locale === 'en') {
    loading = null;
    setLocale('en', {});
    return Promise.resolve('en');
  }
  const p = loaders[locale]()
    .then((m) => {
      // A newer request wins when two overlap.
      if (loading === p) setLocale(locale, m.default);
      return locale;
    })
    .catch(() => getLocale());
  loading = p;
  return p;
}
