// The languages Heartbeat ships. Each one has a dictionary in src/i18n/locales. English is the source text.

export type Locale = 'en' | 'es' | 'pt-BR' | 'fr' | 'de' | 'ru' | 'ja' | 'ko' | 'zh-CN';

/** What the player chose. 'auto' picks from the browser's languages. */
export type LanguageChoice = 'auto' | Locale;

export interface LocaleInfo {
  id: Locale;
  /** The language's own name for itself, shown in the picker. */
  label: string;
  dir: 'ltr' | 'rtl';
}

export const LOCALES: readonly LocaleInfo[] = [
  { id: 'en', label: 'English', dir: 'ltr' },
  { id: 'es', label: 'Español', dir: 'ltr' },
  { id: 'pt-BR', label: 'Português (Brasil)', dir: 'ltr' },
  { id: 'fr', label: 'Français', dir: 'ltr' },
  { id: 'de', label: 'Deutsch', dir: 'ltr' },
  { id: 'ru', label: 'Русский', dir: 'ltr' },
  { id: 'ja', label: '日本語', dir: 'ltr' },
  { id: 'ko', label: '한국어', dir: 'ltr' },
  { id: 'zh-CN', label: '简体中文', dir: 'ltr' },
];

export const LOCALE_IDS: readonly Locale[] = LOCALES.map((l) => l.id);

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALE_IDS as readonly string[]).includes(v);

/**
 * The best match for a list of browser languages, such as navigator.languages. "pt-PT" falls back to pt-BR and
 * "zh-TW" to zh-CN, because those are the closest dictionaries. Nothing matching gives English.
 */
export function pickLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const lower = tag.toLowerCase();
    const exact = LOCALE_IDS.find((id) => id.toLowerCase() === lower);
    if (exact) return exact;
    const base = lower.split('-')[0]!;
    const byBase = LOCALE_IDS.find((id) => id.toLowerCase().split('-')[0] === base);
    if (byBase) return byBase;
  }
  return 'en';
}
