// Collects every translatable sentence from the source and writes src/i18n/keys.json: a sorted list of keys, each with
// the files it appears in. Translators work from that file, and src/i18n/i18n.test.ts checks that it is current and
// that every dictionary covers it.
//
//   node scripts/i18n-extract.mjs          writes keys.json
//   node scripts/i18n-extract.mjs --check  exits 1 when keys.json is out of date
//
// What counts: the first argument of t(), msg(), tx() and raw() when it is a plain string literal (single or double
// quotes, or a template literal without ${}), the noun arguments of count(), and a `context` third argument when it is
// a literal. A call whose first argument is not a literal is reported, so it can be rewritten or marked with msg().

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC = join(ROOT, 'src');
const OUT = join(SRC, 'i18n', 'keys.json');
const SEPARATOR = '##';

function files(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'fixtures' || e.name === 'i18n' || e.name === 'dev' || e.name === 'testing') continue;
      out.push(...files(full));
    } else if (
      /\.(ts|tsx)$/.test(e.name) &&
      !/\.test\.tsx?$/.test(e.name) &&
      !((dir.endsWith('shared') && e.name === 'i18n.ts') || (dir.endsWith('app') && e.name === 'i18n.tsx'))
    )
      out.push(full);
  }
  return out;
}

/** The string a literal argument holds, or null when the argument is not a plain literal. */
function literal(src, at) {
  let i = at;
  while (src[i] === ' ' || src[i] === '\n' || src[i] === '\r' || src[i] === '\t') i++;
  const q = src[i];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  let out = '';
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') {
      const n = src[j + 1];
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n;
      j++;
      continue;
    }
    if (q === '`' && c === '$' && src[j + 1] === '{') return null;
    if (c === q) return { text: out, end: j + 1 };
    out += c;
  }
  return null;
}

/** The index just past the closing bracket of the call that opens at `open`. */
function callEnd(src, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return src.length;
}

/** Splits the text of a call's arguments at the top-level commas. */
function splitArgs(args) {
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(' || c === '{' || c === '[' || c === '<') depth++;
    else if (c === ')' || c === '}' || c === ']' || c === '>') depth--;
    else if (c === ',' && depth === 0) {
      out.push(args.slice(start, i));
      start = i + 1;
    }
  }
  out.push(args.slice(start));
  return out.map((s) => s.trim()).filter((s, i, a) => s !== '' || i < a.length - 1);
}

const CALL = /(?<![A-Za-z0-9_.$])(t|msg|tx|raw|count)\s*\(/g;
/** A plain identifier, a member access or an element access, such as `TIER_NOTE`, `n.label` or `OCTANT_PHRASE[o]!`. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*(?:(?:\?\.|\.|!\.)[A-Za-z_$][\w$]*|\[[^\]]*\]!?)*$/;

function extract(file, src, keys, problems) {
  const rel = relative(SRC, file).split(sep).join('/');
  const bare = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
  for (const m of bare.matchAll(CALL)) {
    const name = m[1];
    const open = m.index + m[0].length - 1;
    const end = callEnd(bare, open);
    const args = splitArgs(bare.slice(open + 1, end - 1));
    const add = (key) => {
      const entry = keys.get(key) ?? new Set();
      entry.add(rel);
      keys.set(key, entry);
    };
    if (name === 'count') {
      // Other functions are called count() too. Only the two-or-three-argument form with a noun is ours.
      if (args.length < 2 || args.length > 3) continue;
      const one = args[1] === undefined ? null : literal(args[1], 0);
      if (!one) {
        problems.push(
          `${rel}: count() with a noun that is not a literal: ${bare.slice(m.index, Math.min(end, m.index + 80)).replace(/\s+/g, ' ')}`,
        );
        continue;
      }
      const many = args[2] === undefined ? null : literal(args[2], 0);
      if (args[2] !== undefined && !many) {
        problems.push(`${rel}: count() with a plural that is not a literal`);
        continue;
      }
      add(`{n, plural, one {# ${one.text}} other {# ${many ? many.text : `${one.text}s`}}}`);
      continue;
    }
    const first = args[0] === undefined ? null : literal(args[0], 0);
    // t(n.label) or t(TIER_NOTE): the text was marked with msg() where it is defined, so it is already collected.
    if (!first && args[0] !== undefined && IDENTIFIER.test(args[0].trim())) continue;
    if (!first) {
      problems.push(
        `${rel}: ${name}() whose text is not a literal: ${bare.slice(m.index, Math.min(end, m.index + 90)).replace(/\s+/g, ' ')}`,
      );
      continue;
    }
    // t(text, params, context), tx(text, parts, context), raw(text, context), msg(text)
    const contextArg = name === 'raw' ? args[1] : name === 'msg' ? undefined : args[2];
    const context = contextArg === undefined ? null : literal(contextArg, 0);
    add(context ? `${first.text}${SEPARATOR}${context.text}` : first.text);
  }
}

export function collect() {
  const keys = new Map();
  const problems = [];
  for (const f of files(SRC)) extract(f, readFileSync(f, 'utf8'), keys, problems);
  const sorted = [...keys.entries()].sort(([a], [b]) => a.localeCompare(b, 'en'));
  const out = {};
  for (const [key, where] of sorted) out[key] = [...where].sort();
  return { keys: out, problems };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { keys, problems } = collect();
  const text = `${JSON.stringify(keys, null, 2)}\n`;
  for (const p of problems) console.error(`warning: ${p}`);
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(OUT, 'utf8');
    } catch {
      // Missing is out of date.
    }
    if (current !== text) {
      console.error('src/i18n/keys.json is out of date. Run: node scripts/i18n-extract.mjs');
      process.exit(1);
    }
    console.log(`${Object.keys(keys).length} keys, up to date.`);
  } else {
    writeFileSync(OUT, text);
    console.log(`${Object.keys(keys).length} keys written to ${relative(ROOT, OUT)}.`);
  }
}
