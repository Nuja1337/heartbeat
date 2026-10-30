// Player-facing text must follow reference/writing.md. This scans the source files that hold it.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = fileURLToPath(new URL('.', import.meta.url));

const ROOT = resolve(HERE, '..', '..');
const SRC = join(ROOT, 'src');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}

const TARGETS = [
  join(SRC, 'shared', 'catalog.ts'),
  join(SRC, 'game', 'render', 'strings.ts'),
  ...walk(join(SRC, 'app')),
  ...walk(join(SRC, 'analytics')),
  ...walk(join(SRC, 'data')),
  join(ROOT, 'README.md'),
  join(ROOT, 'index.html'),
  join(ROOT, 'public', 'manifest.webmanifest'),
].filter(existsSync);

const BANNED_WORDS = [
  'simply', 'just', 'really', 'actually', 'truly', 'seamless', 'seamlessly', 'robust', 'powerful', 'effortless', 'effortlessly',
  'elevate', 'empower', 'unlock', 'unleash', 'leverage', 'delve', 'harness', 'streamline', 'cutting-edge', 'game-changer',
  'supercharge', 'journey', 'testament', 'crucial', 'vital', 'pivotal', 'comprehensive', 'intuitive',
];
const BANNED_PHRASES = ['hard rock', 'double time', 'beatmap', 'osu!', 'unstable rate'];

/** Source without comments. Text in strings and JSX stays. */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1').replace(/<!--[\s\S]*?-->/g, '');
}

describe('writing rules', () => {
  it('scans the files that hold player-facing text', () => {
    const names = TARGETS.map((f) => relative(ROOT, f).split('\\').join('/'));
    expect(names).toContain('src/shared/catalog.ts');
    expect(names).toContain('src/analytics/insightCopy.ts');
    expect(names).toContain('src/app/copy.ts');
    expect(names).toContain('README.md');
    expect(names).toContain('public/manifest.webmanifest');
  });

  it.each(TARGETS.map((f) => [relative(ROOT, f).split('\\').join('/'), f]))('%s', (_name, file) => {
    const raw = readFileSync(file!, 'utf8');
    const text = file!.endsWith('.md') || file!.endsWith('.html') || file!.endsWith('.webmanifest') ? raw : withoutComments(raw);
    const found: string[] = [];

    for (const w of BANNED_WORDS) {
      const re = new RegExp(`(?<![\\w-])${w.replace('-', '\\-')}(?![\\w-])`, 'i');
      // "test harness" is allowed by the writing rules.
      const cleaned = w === 'harness' ? text.replace(/test harness/gi, '') : text;
      if (re.test(cleaned)) found.push(`word "${w}"`);
    }
    for (const p of BANNED_PHRASES) if (text.toLowerCase().includes(p)) found.push(`phrase "${p}"`);
    if (/\bHidden\b/.test(text)) found.push('word "Hidden"');
    if (/\bpp\b/i.test(text)) found.push('word "pp"');
    if (/\u2014/.test(raw)) found.push('em dash');
    if (/[\u2192\u2190\u21d2\u2794]/.test(raw)) found.push('arrow');
    if (/\p{Extended_Pictographic}/u.test(raw)) found.push('emoji');

    expect(found).toEqual([]);
  });
});
