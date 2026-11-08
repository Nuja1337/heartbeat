// Text in the player's language. The English sentence is the key, so the code stays readable and English needs no
// dictionary. A dictionary maps each English sentence to its translation, and messages use a small part of the ICU
// MessageFormat syntax for values, plurals and choices:
//
//   t('Level {level}', { level: 4.2 })
//   t('{n, plural, one {# play} other {# plays}}', { n })
//   t('{side, select, early {early} other {late}}', { side })
//
// Numbers are written for the locale, so 4.2 is "4,2" in German. `msg` marks text that is translated later, where it
// is shown, such as a label in a table. scripts/i18n-extract.mjs collects the keys from t(), msg(), tx() and count().

import { isLocale } from './locales';
import type { Locale } from './locales';

export type Params = Record<string, string | number | undefined>;
export type Dictionary = Record<string, string>;

/** Splits an English sentence from the context that tells two uses of the same words apart. */
export const CONTEXT_SEPARATOR = '##';

let locale: Locale = 'en';
let dict: Dictionary = {};
const listeners = new Set<() => void>();
let plurals: Intl.PluralRules | null = null;
let numbers: Intl.NumberFormat | null = null;

/** The BCP 47 tag Intl should use. English keeps the day-first dates and the spellings the app was written in. */
export const intlTag = (l: Locale = locale): string => (l === 'en' ? 'en-GB' : l);

export const getLocale = (): Locale => locale;

export function setLocale(next: Locale, messages: Dictionary): void {
  if (!isLocale(next)) return;
  locale = next;
  dict = messages;
  plurals = null;
  numbers = null;
  listeners.forEach((l) => l());
}

export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Marks English text that is translated where it is shown. It returns its argument. */
export const msg = <T extends string>(s: T): T => s;

/** The translation of an English sentence, with its values filled in. Unknown sentences come back in English. */
export function t(message: string, params?: Params, context?: string): string {
  const key = context ? `${message}${CONTEXT_SEPARATOR}${context}` : message;
  const text = dict[key] ?? message;
  if (text.indexOf('{') === -1) return text;
  return format(text, params ?? {});
}

/** The translated text with its placeholders left in place, for callers that fill them with something other than text. */
export function raw(message: string, context?: string): string {
  const key = context ? `${message}${CONTEXT_SEPARATOR}${context}` : message;
  return dict[key] ?? message;
}

/* ------------------------------------------------------------ formatting */

function numberFormat(): Intl.NumberFormat {
  numbers ??= new Intl.NumberFormat(intlTag(), { maximumFractionDigits: 3 });
  return numbers;
}

function pluralRules(): Intl.PluralRules {
  plurals ??= new Intl.PluralRules(intlTag());
  return plurals;
}

/** A number as the locale writes it, with grouping and up to three decimals. */
export const formatNumber = (n: number, options?: Intl.NumberFormatOptions): string =>
  options ? new Intl.NumberFormat(intlTag(), options).format(n) : numberFormat().format(n);

/** The index of the brace that closes the one at `open`, or -1. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/** Splits "one {# play} other {# plays}" into its branches. */
function branches(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    while (i < body.length && body[i] === ' ') i++;
    const open = body.indexOf('{', i);
    if (open === -1) break;
    const name = body.slice(i, open).trim();
    const close = closing(body, open);
    if (close === -1) break;
    out.set(name, body.slice(open + 1, close));
    i = close + 1;
  }
  return out;
}

function pick(map: Map<string, string>, value: string | number | undefined, plural: boolean): string | undefined {
  if (typeof value === 'number') {
    const exact = map.get(`=${value}`);
    if (exact !== undefined) return exact;
    if (plural) {
      const byRule = map.get(pluralRules().select(value));
      if (byRule !== undefined) return byRule;
    }
  }
  if (typeof value === 'string') {
    const byName = map.get(value);
    if (byName !== undefined) return byName;
  }
  return map.get('other');
}

/** Fills a message. `hash` is what `#` stands for inside a plural branch. */
export function format(text: string, params: Params, hash?: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) {
      out += hash === undefined ? text.slice(i) : text.slice(i).replaceAll('#', hash);
      break;
    }
    const literal = text.slice(i, open);
    out += hash === undefined ? literal : literal.replaceAll('#', hash);
    const close = closing(text, open);
    if (close === -1) {
      out += text.slice(open);
      break;
    }
    const inner = text.slice(open + 1, close);
    const comma = inner.indexOf(',');
    if (comma === -1) {
      const name = inner.trim();
      const value = params[name];
      out += value === undefined ? `{${name}}` : typeof value === 'number' ? numberFormat().format(value) : value;
    } else {
      const name = inner.slice(0, comma).trim();
      const rest = inner.slice(comma + 1);
      const comma2 = rest.indexOf(',');
      const kind = (comma2 === -1 ? rest : rest.slice(0, comma2)).trim();
      const body = comma2 === -1 ? '' : rest.slice(comma2 + 1);
      const value = params[name];
      const branch = pick(branches(body), value, kind === 'plural');
      if (branch === undefined) out += `{${name}}`;
      else out += format(branch, params, typeof value === 'number' ? numberFormat().format(value) : hash);
    }
    i = close + 1;
  }
  return out;
}

/** "1 play", "2 plays", in the player's language. `many` is the irregular plural, when the noun has one. */
export function count(n: number, one: string, many = `${one}s`): string {
  return t(`{n, plural, one {# ${one}} other {# ${many}}}`, { n });
}

/** What a message asks for: the names it fills, and the branch keys of its selects, at any depth. */
export interface MessageShape {
  /** Plain placeholders, in order of first appearance. Text inside a plural or select branch is read too. */
  placeholders: string[];
  /** The arguments of plurals and selects. */
  subjects: string[];
  /** The branch keys of every select, sorted. A translation must keep them, because the code passes them. */
  selectKeys: string[];
}

/** Reads a message the way `format` does, so a word inside a branch is never mistaken for a placeholder. */
export function shapeOf(text: string): MessageShape {
  const shape: MessageShape = { placeholders: [], subjects: [], selectKeys: [] };
  const add = (list: string[], v: string) => {
    if (!list.includes(v)) list.push(v);
  };
  const walk = (part: string) => {
    let i = 0;
    while (i < part.length) {
      const open = part.indexOf('{', i);
      if (open === -1) break;
      const close = closing(part, open);
      if (close === -1) break;
      const inner = part.slice(open + 1, close);
      const comma = inner.indexOf(',');
      if (comma === -1) {
        const name = inner.trim();
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) add(shape.placeholders, name);
      } else {
        const name = inner.slice(0, comma).trim();
        const rest = inner.slice(comma + 1);
        const comma2 = rest.indexOf(',');
        const kind = (comma2 === -1 ? rest : rest.slice(0, comma2)).trim();
        add(shape.subjects, name);
        const body = comma2 === -1 ? '' : rest.slice(comma2 + 1);
        for (const [key, branch] of branches(body)) {
          if (kind === 'select') add(shape.selectKeys, key);
          walk(branch);
        }
      }
      i = close + 1;
    }
  };
  walk(text);
  shape.selectKeys.sort();
  return shape;
}

/**
 * The placeholder names a message uses, in order of first appearance, for callers that fill them with elements.
 * A plural or select is text to them, so its branches are not read.
 */
export function placeholders(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const close = closing(text, open);
    if (close === -1) break;
    const inner = text.slice(open + 1, close).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(inner) && !out.includes(inner)) out.push(inner);
    i = close + 1;
  }
  return out;
}
