// The dictionaries. keys.json lists every English sentence in the source (scripts/i18n-extract.mjs writes it), and each
// locale file must translate exactly those keys, with the same placeholders. A translation with a typo in a
// placeholder would show "{n}" to a player, so that is checked here rather than found in use.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { format, shapeOf } from '../shared/i18n';
import { LOCALE_IDS } from '../shared/locales';
import { collect } from '../../scripts/i18n-extract.mjs';

const here = new URL('.', import.meta.url);
const keys = JSON.parse(readFileSync(new URL('keys.json', here), 'utf8')) as Record<string, string[]>;
const KEYS = Object.keys(keys);

/** Every argument a message asks for: plain placeholders and the subjects of plurals and selects, sorted. */
function argNames(text: string): string[] {
  const shape = shapeOf(text);
  return [...new Set([...shape.placeholders, ...shape.subjects])].sort();
}

/** The branch keys of every select in a message, so a translation keeps the keys the code passes. */
const selectKeys = (text: string): string[] => shapeOf(text).selectKeys;

function balanced(text: string): boolean {
  let depth = 0;
  for (const c of text) {
    if (c === '{') depth++;
    else if (c === '}' && --depth < 0) return false;
  }
  return depth === 0;
}

describe('keys.json', () => {
  it('is up to date with the source', () => {
    const { keys: fresh, problems } = collect();
    expect(problems, 'every t() takes a literal or a msg() constant').toEqual([]);
    expect(Object.keys(fresh)).toEqual(KEYS);
  });

  it('holds only balanced messages', () => {
    for (const k of KEYS) expect(balanced(k), k).toBe(true);
  });
});

const files = readdirSync(new URL('locales/', here)).filter((f) => f.endsWith('.json'));

describe('locale files', () => {
  it('exist for every locale but English', () => {
    expect(files.map((f) => f.replace(/\.json$/, '')).sort()).toEqual(LOCALE_IDS.filter((l) => l !== 'en').sort());
  });

  for (const file of files) {
    const locale = file.replace(/\.json$/, '');
    const dict = JSON.parse(readFileSync(new URL(`locales/${file}`, here), 'utf8')) as Record<string, string>;

    describe(locale, () => {
      it('translates every key and nothing else', () => {
        const have = Object.keys(dict).sort();
        const missing = KEYS.filter((k) => !(k in dict));
        const extra = have.filter((k) => !(k in keys));
        expect(missing, 'missing').toEqual([]);
        expect(extra, 'not in the source any more').toEqual([]);
      });

      it('keeps every placeholder and select key', () => {
        for (const k of KEYS) {
          const v = dict[k];
          if (v === undefined) continue;
          expect(typeof v, k).toBe('string');
          expect(v.trim().length, k).toBeGreaterThan(0);
          expect(balanced(v), `${locale}: unbalanced braces in the translation of ${k}`).toBe(true);
          expect(argNames(v), `${locale}: placeholders of ${k}`).toEqual(argNames(k));
          expect(selectKeys(v), `${locale}: select keys of ${k}`).toEqual(selectKeys(k));
        }
      });

      it('formats without leaving a placeholder behind', () => {
        for (const k of KEYS) {
          const v = dict[k];
          if (v === undefined || v.indexOf('{') === -1) continue;
          const params: Record<string, string | number> = {};
          for (const name of argNames(k)) params[name] = 2;
          const out = format(v, params);
          expect(out, `${locale}: ${k}`).not.toMatch(/\{[A-Za-z_]/);
        }
      });
    });
  }
});
