import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = fileURLToPath(new URL('.', import.meta.url));

const SRC = resolve(HERE, '..');

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) out.push(m[1]!);
  return out;
}

/** Imports that point inside src, as paths relative to src. */
function internal(file: string): { spec: string; target: string }[] {
  return importsOf(file)
    .filter((s) => s.startsWith('.'))
    .map((spec) => ({ spec, target: relative(SRC, resolve(join(file, '..'), spec)).split(sep).join('/') }));
}

describe('module boundaries', () => {
  const mine = ['app', 'data', 'analytics'].flatMap((d) => files(join(SRC, d)).map((f) => ({ f, area: d })));

  it('app, data and analytics reach src/game only through src/game/index', () => {
    const bad = mine.flatMap(({ f }) => internal(f).filter((i) => i.target.startsWith('game') && i.target !== 'game/index' && i.target !== 'game').map((i) => `${relative(SRC, f)} imports ${i.spec}`));
    expect(bad).toEqual([]);
  });

  it('data and analytics do not import from app', () => {
    const bad = mine
      .filter(({ area }) => area !== 'app')
      .flatMap(({ f }) => internal(f).filter((i) => i.target.startsWith('app')).map((i) => `${relative(SRC, f)} imports ${i.spec}`));
    expect(bad).toEqual([]);
  });

  it('analytics imports data only for types, the schema and the clock-free helpers', () => {
    const bad = mine
      .filter(({ area, f }) => area === 'analytics' && !/\.test\.ts$/.test(f))
      .flatMap(({ f }) => internal(f).filter((i) => i.target.startsWith('data/') && i.target !== 'data/schema').map((i) => `${relative(SRC, f)} imports ${i.spec}`));
    expect(bad).toEqual([]);
  });

  it('nothing outside the game imports a game file by path other than the index', () => {
    const other = files(join(SRC, 'shared')).flatMap((f) => internal(f).filter((i) => i.target.startsWith('game')));
    expect(other).toEqual([]);
  });
});
