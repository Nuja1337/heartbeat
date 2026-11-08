// The boot script in index.html is the only inline script, and the Content Security Policy in public/_headers allows
// it by hash. A change to the script without a new hash would make every browser skip it, and the page would flash
// the wrong theme. This test keeps the two in step.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const html = readFileSync(new URL('index.html', ROOT), 'utf8');
const headers = readFileSync(new URL('public/_headers', ROOT), 'utf8');

describe('content security policy', () => {
  const scripts = [...html.matchAll(/<script(?![^>]*\btype="module")[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);

  it('has exactly one inline script, the boot script', () => {
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain("getItem('hb-theme')");
  });

  it('allows the boot script by hash', () => {
    const hash = `'sha256-${createHash('sha256').update(scripts[0]!).digest('base64')}'`;
    const scriptSrc = headers.match(/script-src ([^;]+);/)?.[1] ?? '';
    expect(scriptSrc.split(/\s+/), `script-src should contain ${hash}`).toContain(hash);
  });

  it('keeps the boot script free of anything but storage and media queries', () => {
    // Nothing fetched, nothing evaluated. The script may only read storage and set data attributes.
    expect(scripts[0]).not.toMatch(/fetch|XMLHttpRequest|eval|import|document\.write|innerHTML/);
  });
});
