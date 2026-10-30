/* Flickwise service worker (PLAN-2 §8.3 and §4.11).
   The pure helpers mirror src/app/pwa.ts. src/app/pwa.test.ts runs this file against them.

   Kill switch: public/sw-kill.js. To retire a broken worker, serve it as sw.js (see the README). */

const PREFIX = 'fw-';
const MANIFEST_URL = '/asset-manifest.json';
const NAV_TIMEOUT_MS = 3000;

/* The page registers this file as /sw.js?v=<hash of the manifest>. The same hash names the cache, so the worker
   always knows its own cache, also after the browser stopped and restarted it. */
function versionParam() {
  try {
    return new URL(self.location.href).searchParams.get('v') || '';
  } catch {
    return '';
  }
}

let current = null;

function assetsFromManifest(json) {
  const out = new Set(['/', '/index.html']);
  if (!json || typeof json !== 'object' || Array.isArray(json)) return [...out];
  const add = (v) => {
    if (typeof v === 'string' && v.length > 0) out.add(v.startsWith('/') ? v : '/' + v);
  };
  for (const entry of Object.values(json)) {
    if (!entry || typeof entry !== 'object') continue;
    add(entry.file);
    for (const list of [entry.css, entry.assets]) if (Array.isArray(list)) list.forEach(add);
  }
  return [...out];
}

function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/* This host answers a missing /assets file with 200 text/html, so a good status is not enough. */
function isCacheable(res) {
  if (!res.ok || res.type === 'opaque') return false;
  return !(res.headers.get('Content-Type') || '').toLowerCase().includes('text/html');
}

/* A redirected response can't answer a navigation. The host may redirect /index.html to /, so the
   shell is stored as a fresh response with the same body. */
async function clean(res) {
  return new Response(await res.blob(), { status: 200, headers: res.headers });
}

async function fill() {
  const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('The asset manifest could not be fetched.');
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('The asset manifest is not JSON.');
  }
  const v = versionParam();
  const name = PREFIX + (v || hashText(text));
  current = name;
  const cache = await caches.open(name);
  for (const url of assetsFromManifest(json)) {
    const shell = url === '/' || url === '/index.html';
    const r = await fetch(url, { cache: 'reload' });
    // The shell is HTML by nature. Everything else must not be.
    if (shell ? !r.ok : !isCacheable(r)) throw new Error('Could not cache ' + url);
    await cache.put(url, r.redirected ? await clean(r) : r);
  }
}

/* A failed install must not leave a half-filled cache behind, or the next attempt would find it and activate
   would keep it. */
async function precache() {
  try {
    await fill();
  } catch (e) {
    const name = current;
    current = null;
    if (name) {
      try {
        await caches.delete(name);
      } catch {
        // Nothing more to do.
      }
    }
    throw e;
  }
}

async function currentName() {
  const v = versionParam();
  if (v) return PREFIX + v;
  if (current) return current;
  const keys = (await caches.keys()).filter((k) => k.startsWith(PREFIX));
  return keys.length > 0 ? keys[keys.length - 1] : null;
}

async function navigation(request) {
  try {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), NAV_TIMEOUT_MS);
    });
    try {
      return await Promise.race([fetch(request), timeout]);
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    const cached = await caches.match('/index.html');
    if (cached) return cached;
    throw e;
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (isCacheable(res)) {
    const name = await currentName();
    if (name) {
      const cache = await caches.open(name);
      await cache.put(request, res.clone());
    }
  }
  return res;
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = await currentName();
      for (const key of await caches.keys()) {
        if (key.startsWith(PREFIX) && key !== keep) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(navigation(request));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
  }
});
