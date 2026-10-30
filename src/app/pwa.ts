// The offline app (PLAN-2 §8.3 and §4.11). The pure helpers here mirror public/sw.js, which can't import
// anything. pwa.test.ts runs sw.js against these helpers so the two can't drift apart.
// Kill switch: public/sw-kill.js. Serve it as /sw.js and stop calling `register` below (see the README).

import { useSyncExternalStore } from 'react';

// The prefix keeps the old app name on purpose: the worker finds and deletes caches by it.
export const CACHE_PREFIX = 'fw-';
export const SW_URL = '/sw.js';
export const MANIFEST_URL = '/asset-manifest.json';
export const UPDATE_READY_MESSAGE = 'A new version of Heartbeat is ready.';

/** The URLs to precache from Vite's manifest: every entry's file, css and assets, plus the shell. */
export function assetsFromManifest(json: unknown): string[] {
  const out = new Set<string>(['/', '/index.html']);
  if (!json || typeof json !== 'object' || Array.isArray(json)) return [...out];
  const add = (v: unknown) => {
    if (typeof v === 'string' && v.length > 0) out.add(v.startsWith('/') ? v : `/${v}`);
  };
  for (const entry of Object.values(json as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { file?: unknown; css?: unknown; assets?: unknown };
    add(e.file);
    for (const list of [e.css, e.assets]) if (Array.isArray(list)) list.forEach(add);
  }
  return [...out];
}

/** A short hash of the manifest text. A new build gives a new cache name. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export const cacheNameFor = (manifestText: string): string => `${CACHE_PREFIX}${hashText(manifestText)}`;

/**
 * Whether a response may be cached. This host answers a missing /assets file with 200 text/html, so
 * a good status isn't enough. Opaque and non-200 responses never qualify.
 */
export function isCacheable(res: { ok: boolean; type?: string; headers: { get(name: string): string | null } }): boolean {
  if (!res.ok || res.type === 'opaque') return false;
  return !(res.headers.get('Content-Type') ?? '').toLowerCase().includes('text/html');
}

/**
 * The worker's address for a build. public/sw.js never changes between builds, and a browser installs a new
 * worker only when the script differs. Putting the manifest hash in the address makes every build a new script
 * address, so the browser installs it and the precache refreshes. The file served is the same one.
 */
export const workerUrlFor = (manifestText: string): string => `${SW_URL}?v=${hashText(manifestText)}`;

/** Only production builds register the worker. A dev server's modules must never be cached. */
export const shouldRegister = (env: { PROD: boolean }, nav: { serviceWorker?: unknown }): boolean => env.PROD && Boolean(nav.serviceWorker);

/**
 * What the update banner's Reload button does. Another tab may already have applied the update, which leaves this
 * tab's waiting worker activated or redundant. It will never fire another controllerchange, so the page reloads
 * directly. Otherwise the worker is told to take over.
 */
export const updateAction = (worker: { state: string } | null): 'reload' | 'activate' =>
  !worker || worker.state === 'activated' || worker.state === 'redundant' ? 'reload' : 'activate';

/** A new controller while an update is pending means the update was applied, here or in another tab. */
export const reloadOnControllerChange = (pending: { updateReady: boolean; reloadRequested: boolean }): boolean => pending.reloadRequested || pending.updateReady;

/* ------------------------------------------------------------ page side */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaState {
  /** A new worker is waiting to take over. */
  updateReady: boolean;
  /** The browser offered to install the app and the offer is still unused. */
  canInstall: boolean;
}

let state: PwaState = { updateReady: false, canInstall: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<PwaState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const usePwa = (): PwaState => useSyncExternalStore(subscribe, () => state, () => state);

let waiting: ServiceWorker | null = null;
const watched = new WeakSet<ServiceWorkerRegistration>();
let installEvent: InstallPromptEvent | null = null;
let reloadOnControl = false;
let started = false;

function watch(reg: ServiceWorkerRegistration) {
  if (watched.has(reg)) return;
  watched.add(reg);
  const offer = (worker: ServiceWorker | null) => {
    if (!worker) return;
    waiting = worker;
    set({ updateReady: true });
  };
  // A worker that is already waiting, for example after a reload that didn't take it over.
  if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const next = reg.installing;
    next?.addEventListener('statechange', () => {
      // With no controller this is the first install, so there is nothing to update.
      if (next.state === 'installed' && navigator.serviceWorker.controller) offer(next);
    });
  });
}

/** Registers the worker in production builds and captures the install prompt. Safe to call twice. */
export function initPwa(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e as InstallPromptEvent;
    set({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    set({ canInstall: false });
  });

  if (!shouldRegister({ PROD: import.meta.env.PROD }, navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadOnControllerChange({ updateReady: state.updateReady, reloadRequested: reloadOnControl })) window.location.reload();
  });
  const check = () => {
    registerWorker().catch(() => undefined);
  };
  if (document.readyState === 'complete') check();
  else window.addEventListener('load', check, { once: true });
  // A tab left open for days still learns about a new build.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > CHECK_EVERY_MS) check();
  });
}

const CHECK_EVERY_MS = 60 * 60 * 1000;
let lastCheck = 0;

/** Reads the current manifest and registers the worker for that build. Offline, the existing worker carries on. */
async function registerWorker(): Promise<void> {
  lastCheck = Date.now();
  const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!res.ok) return;
  const reg = await navigator.serviceWorker.register(workerUrlFor(await res.text()));
  watch(reg);
}

/** Tells the waiting worker to take over. The page reloads when it has. */
export function applyUpdate(): void {
  if (updateAction(waiting) === 'reload') {
    window.location.reload();
    return;
  }
  reloadOnControl = true;
  waiting?.postMessage({ type: 'skipWaiting' });
}

/** Shows the browser's install prompt. Resolves true when the player accepted. */
export async function promptInstall(): Promise<boolean> {
  const ev = installEvent;
  if (!ev) return false;
  installEvent = null;
  set({ canInstall: false });
  try {
    await ev.prompt();
    return (await ev.userChoice).outcome === 'accepted';
  } catch {
    return false;
  }
}
