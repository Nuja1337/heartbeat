// The pure helpers in pwa.ts, and public/sw.js run against fakes so its rules are checked too.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assetsFromManifest, cacheNameFor, hashText, isCacheable, shouldRegister, workerUrlFor } from './pwa';

const SW_SOURCE = readFileSync(resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'public', 'sw.js'), 'utf8');

/** The shape Vite writes for build.manifest. */
const MANIFEST = {
  'index.html': { file: 'assets/index-abc.js', name: 'index', src: 'index.html', isEntry: true, css: ['assets/index-def.css'], assets: ['assets/font-1.woff2'] },
  'src/app/pages/Results.tsx': { file: 'assets/Results-123.js', isDynamicEntry: true, imports: ['index.html'], css: ['assets/index-def.css'] },
  'node_modules/@fontsource-variable/space-grotesk/files/font-1.woff2': { file: 'assets/font-1.woff2', src: 'node_modules/@fontsource-variable/space-grotesk/files/font-1.woff2' },
};

describe('assetsFromManifest', () => {
  it('lists the shell and every file, css and asset once', () => {
    expect(assetsFromManifest(MANIFEST).sort()).toEqual(
      ['/', '/index.html', '/assets/Results-123.js', '/assets/font-1.woff2', '/assets/index-abc.js', '/assets/index-def.css'].sort(),
    );
  });

  it('keeps a leading slash as it is', () => {
    expect(assetsFromManifest({ a: { file: '/assets/x.js' } })).toContain('/assets/x.js');
  });

  it('gives only the shell for anything that is not a manifest', () => {
    for (const bad of [null, undefined, 3, 'x', [], { a: null }, { a: { file: 4, css: 'no', assets: [1, ''] } }]) {
      expect(assetsFromManifest(bad)).toEqual(['/', '/index.html']);
    }
  });
});

describe('cache names and responses', () => {
  it('names the cache from the manifest text', () => {
    expect(cacheNameFor('a')).toBe(cacheNameFor('a'));
    expect(cacheNameFor('a')).not.toBe(cacheNameFor('b'));
    expect(cacheNameFor('{}')).toMatch(/^fw-[0-9a-z]+$/);
    expect(hashText('')).toBe(hashText(''));
  });

  it('caches only good responses that are not HTML', () => {
    const res = (init: { ok?: boolean; type?: string; ct?: string | null }) => ({
      ok: init.ok ?? true,
      type: init.type ?? 'basic',
      headers: { get: (n: string) => (n === 'Content-Type' ? (init.ct ?? null) : null) },
    });
    expect(isCacheable(res({ ct: 'text/javascript' }))).toBe(true);
    expect(isCacheable(res({ ct: 'text/html; charset=utf-8' }))).toBe(false);
    expect(isCacheable(res({ ct: 'TEXT/HTML' }))).toBe(false);
    expect(isCacheable(res({ ok: false, ct: 'text/javascript' }))).toBe(false);
    expect(isCacheable(res({ type: 'opaque', ct: 'text/javascript' }))).toBe(false);
  });

  it('gives each build its own worker address', () => {
    expect(workerUrlFor('a')).toBe(`/sw.js?v=${hashText('a')}`);
    expect(workerUrlFor('a')).not.toBe(workerUrlFor('b'));
  });

  it('registers only in production, and only where workers exist', () => {
    expect(shouldRegister({ PROD: true }, { serviceWorker: {} })).toBe(true);
    expect(shouldRegister({ PROD: false }, { serviceWorker: {} })).toBe(false);
    expect(shouldRegister({ PROD: true }, {})).toBe(false);
  });
});

/* ------------------------------------------------------------------ sw.js */

type Handler = (event: Record<string, unknown>) => void;

function norm(key: string | { url: string }): string {
  return new URL(typeof key === 'string' ? key : key.url, 'https://app.test').pathname;
}

function makeWorker(files: Record<string, () => Response | Promise<Response>>) {
  const handlers = new Map<string, Handler>();
  const stores = new Map<string, Map<string, Response>>();
  const fetched: { url: string; cache?: string }[] = [];
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        async put(k: string | { url: string }, r: Response) {
          store.set(norm(k), r);
        },
      };
    },
    async match(k: string | { url: string }) {
      for (const store of stores.values()) {
        const hit = store.get(norm(k));
        if (hit) return hit.clone();
      }
      return undefined;
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };
  let claimed = false;
  let skipped = false;
  const self = {
    location: { origin: 'https://app.test' },
    clients: { claim: async () => void (claimed = true) },
    skipWaiting: () => void (skipped = true),
    addEventListener: (type: string, fn: Handler) => void handlers.set(type, fn),
  };
  const fetchFake = async (input: string | { url: string }, init?: { cache?: string }) => {
    const path = norm(input);
    fetched.push({ url: path, cache: init?.cache });
    const make = files[path];
    if (!make) return new Response('missing', { status: 404 });
    return make();
  };
  runInNewContext(SW_SOURCE, { self, caches, fetch: fetchFake, Response, URL, Set, Promise, setTimeout: (...a: Parameters<typeof setTimeout>) => setTimeout(...a), clearTimeout: (t: Parameters<typeof clearTimeout>[0]) => clearTimeout(t), Math, Object, Array, JSON, Error });

  const run = async (type: string, event: Record<string, unknown> = {}) => {
    let pending: Promise<unknown> | undefined;
    handlers.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => void (pending = p), respondWith: (p: Promise<unknown>) => void (pending = p) });
    return { pending };
  };
  return { run, stores, fetched, handlers, state: () => ({ claimed, skipped }) };
}

const js = () => new Response('code', { headers: { 'Content-Type': 'text/javascript' } });
const html = () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } });
const MANIFEST_TEXT = JSON.stringify(MANIFEST);
const GOOD = {
  '/asset-manifest.json': () => new Response(MANIFEST_TEXT, { headers: { 'Content-Type': 'application/json' } }),
  '/': html,
  '/index.html': html,
  '/assets/index-abc.js': js,
  '/assets/index-def.css': () => new Response('css', { headers: { 'Content-Type': 'text/css' } }),
  '/assets/font-1.woff2': () => new Response('font', { headers: { 'Content-Type': 'font/woff2' } }),
  '/assets/Results-123.js': js,
};

describe('public/sw.js', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('installs by precaching the shell and every manifest entry into fw- plus a hash of the manifest', async () => {
    const w = makeWorker(GOOD);
    await (await w.run('install')).pending;
    const name = cacheNameFor(MANIFEST_TEXT);
    expect([...w.stores.keys()]).toEqual([name]);
    expect([...w.stores.get(name)!.keys()].sort()).toEqual(assetsFromManifest(MANIFEST).sort());
    // The manifest is read from the network, never from the HTTP cache.
    expect(w.fetched[0]).toEqual({ url: '/asset-manifest.json', cache: 'no-store' });
  });

  it('fails the install when a file answers 200 with HTML', async () => {
    const w = makeWorker({ ...GOOD, '/assets/Results-123.js': html });
    await expect((await w.run('install')).pending).rejects.toThrow('/assets/Results-123.js');
  });

  it('fails the install when a file is missing or the manifest is not JSON', async () => {
    const missing = { ...GOOD } as Record<string, () => Response>;
    delete missing['/assets/font-1.woff2'];
    await expect((await makeWorker(missing).run('install')).pending).rejects.toThrow();
    const bad = makeWorker({ ...GOOD, '/asset-manifest.json': () => new Response('nope') });
    await expect((await bad.run('install')).pending).rejects.toThrow();
  });

  it('stores a redirected shell as a plain response', async () => {
    const redirected = () => Object.defineProperty(new Response('<html>', { headers: { 'Content-Type': 'text/html' } }), 'redirected', { value: true });
    const w = makeWorker({ ...GOOD, '/index.html': redirected });
    await (await w.run('install')).pending;
    const stored = w.stores.get(cacheNameFor(MANIFEST_TEXT))!.get('/index.html')!;
    expect(stored.redirected).toBe(false);
    expect(await stored.text()).toBe('<html>');
  });

  it('serves /assets from the cache first, and caches only good non-HTML answers', async () => {
    const w = makeWorker({ ...GOOD, '/assets/new.js': js, '/assets/gone.js': html });
    await (await w.run('install')).pending;
    const before = w.fetched.length;
    const hit = await (await w.run('fetch', { request: { method: 'GET', url: 'https://app.test/assets/index-abc.js', mode: 'cors' } })).pending;
    expect(await (hit as Response).text()).toBe('code');
    expect(w.fetched.length).toBe(before);

    const fresh = await (await w.run('fetch', { request: { method: 'GET', url: 'https://app.test/assets/new.js', mode: 'cors' } })).pending;
    expect(await (fresh as Response).text()).toBe('code');
    expect(w.stores.get(cacheNameFor(MANIFEST_TEXT))!.has('/assets/new.js')).toBe(true);

    await (await w.run('fetch', { request: { method: 'GET', url: 'https://app.test/assets/gone.js', mode: 'cors' } })).pending;
    expect(w.stores.get(cacheNameFor(MANIFEST_TEXT))!.has('/assets/gone.js')).toBe(false);
  });

  it('answers a navigation from the network, and from the cached shell after 3 s without one', async () => {
    const w = makeWorker({ ...GOOD, '/stats': () => new Response('live', { headers: { 'Content-Type': 'text/html' } }) });
    await (await w.run('install')).pending;
    const nav = { method: 'GET', url: 'https://app.test/stats', mode: 'navigate' };
    const live = await (await w.run('fetch', { request: nav })).pending;
    expect(await (live as Response).text()).toBe('live');

    // A network that never answers.
    const slow = makeWorker({ ...GOOD, '/stats': () => new Promise<Response>(() => undefined) });
    await (await slow.run('install')).pending;
    const { pending } = await slow.run('fetch', { request: nav });
    await vi.advanceTimersByTimeAsync(2900);
    let settled = false;
    void Promise.resolve(pending).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(await ((await pending) as Response).text()).toBe('<html>');
  });

  it('leaves other requests to the network', async () => {
    const w = makeWorker(GOOD);
    await (await w.run('install')).pending;
    for (const request of [
      { method: 'POST', url: 'https://app.test/assets/x.js', mode: 'cors' },
      { method: 'GET', url: 'https://other.test/assets/x.js', mode: 'cors' },
      { method: 'GET', url: 'https://app.test/api/x', mode: 'cors' },
    ]) {
      expect((await w.run('fetch', { request })).pending).toBeUndefined();
    }
  });

  it('removes other fw- caches on activate, keeps unrelated ones and claims clients', async () => {
    const w = makeWorker(GOOD);
    await (await w.run('install')).pending;
    w.stores.set('fw-old', new Map());
    w.stores.set('other-app', new Map());
    await (await w.run('activate')).pending;
    expect([...w.stores.keys()].sort()).toEqual([cacheNameFor(MANIFEST_TEXT), 'other-app'].sort());
    expect(w.state().claimed).toBe(true);
  });

  it('skips waiting only when the page asks', async () => {
    const w = makeWorker(GOOD);
    await w.run('install');
    expect(w.state().skipped).toBe(false);
    await w.run('message', { data: { type: 'other' } });
    await w.run('message', { data: null });
    expect(w.state().skipped).toBe(false);
    await w.run('message', { data: { type: 'skipWaiting' } });
    expect(w.state().skipped).toBe(true);
  });
});
