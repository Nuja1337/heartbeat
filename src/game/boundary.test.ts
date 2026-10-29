import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const rel = (f: string) => relative(root, f).replace(/\\/g, '/');
const all = files(root);

describe('boundaries', () => {
  it('imports nothing from the app, data or analytics folders', () => {
    for (const f of all) {
      const src = readFileSync(f, 'utf8');
      expect(src, rel(f)).not.toMatch(/from\s+['"][^'"]*\/(app|data|analytics)\//);
    }
  });

  it('keeps browser code in the files that may use it', () => {
    const browserOk = /^(engine\/(game|input|loop|playfield)\.ts|replay\/playback\.ts|render\/|audio\/|dev\/|testing\/fake|index\.ts$)/;
    const browserApi = /\b(document|window|navigator|AudioContext|HTMLCanvasElement|requestAnimationFrame|CanvasRenderingContext2D|OffscreenCanvas|ResizeObserver)\b/;
    for (const f of all) {
      if (browserOk.test(rel(f))) continue;
      const src = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, rel(f)).not.toMatch(browserApi);
    }
  });

  it('uses extensionless imports', () => {
    for (const f of all) {
      const src = readFileSync(f, 'utf8');
      expect(src, rel(f)).not.toMatch(/from\s+['"]\.[^'"]*\.(ts|js)['"]/);
    }
  });
});
