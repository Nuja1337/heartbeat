import { Suspense, lazy, useEffect, useLayoutEffect } from 'react';
import type { ComponentType } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { DB_BLOCKED_MESSAGE } from '../data/db';
import { prunePlans } from '../data/meta';
import { scheduleReplayRetention } from '../data/replays';
import { scheduleRetention } from '../data/retention';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SessionSkeleton } from './components/Skeleton';
import { LinkButton, Notice, Panel } from './components/ui';
import { Shell, Wordmark } from './layout/Shell';
import { Home } from './pages/Home';
import { initPwa } from './pwa';
import { invalidateAnalysis } from './state/analysis';
import { applyAppearance } from './state/appearance';
import { boot, useAppState } from './state/store';

/** Routes load their code on demand (PLAN-2 §8.1). Home stays in the entry chunk. */
function lazyNamed<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }));
}

const PlaySetup = lazyNamed(() => import('./pages/PlaySetup'), 'PlaySetup');
const Train = lazyNamed(() => import('./pages/Train'), 'Train');
const ModuleSetup = lazyNamed(() => import('./pages/ModuleSetup'), 'ModuleSetup');
const PlayScreen = lazyNamed(() => import('./pages/PlayScreen'), 'PlayScreen');
const Results = lazyNamed(() => import('./pages/Results'), 'Results');
const Settings = lazyNamed(() => import('./pages/Settings'), 'Settings');
const StatsLayout = lazyNamed(() => import('./pages/stats/Layout'), 'StatsLayout');
const Overview = lazyNamed(() => import('./pages/stats/Overview'), 'Overview');
const Trends = lazyNamed(() => import('./pages/stats/Trends'), 'Trends');
const Patterns = lazyNamed(() => import('./pages/stats/Patterns'), 'Patterns');
const Timing = lazyNamed(() => import('./pages/stats/Timing'), 'Timing');
const Bests = lazyNamed(() => import('./pages/stats/Bests'), 'Bests');
const History = lazyNamed(() => import('./pages/stats/History'), 'History');
const PlayDetail = lazyNamed(() => import('./pages/stats/PlayDetail'), 'PlayDetail');

function NotFound() {
  return (
    <Panel className="max-w-xl">
      <span className="fw-kicker">404</span>
      <h1 className="mt-3 text-2xl">Page not found</h1>
      <p className="mt-2 text-ink-2">There is nothing at this address.</p>
      <LinkButton to="/" variant="primary" className="mt-6">
        Go home
      </LinkButton>
    </Panel>
  );
}

/** Shown while settings load. It also carries the message when another tab holds the database open. */
function BootScreen() {
  const { blocked } = useAppState();
  return (
    <div className="grid min-h-screen place-items-center px-4" aria-busy="true">
      <div className="flex flex-col items-center gap-4">
        <Wordmark className="text-2xl" />
        {blocked && <Notice tone="warn">{DB_BLOCKED_MESSAGE}</Notice>}
      </div>
    </div>
  );
}

export function App() {
  const { ready, settings } = useAppState();

  useEffect(() => {
    initPwa();
    void boot().then(() => {
      scheduleRetention((removed) => removed > 0 && invalidateAnalysis());
      scheduleReplayRetention((removed) => removed > 0 && invalidateAnalysis());
      prunePlans(Date.now()).catch(() => undefined);
    });
  }, []);

  // The palette and reduced motion live on the root element, so every screen and the game follow them.
  useLayoutEffect(() => {
    applyAppearance(settings);
  }, [settings]);

  if (!ready) return <BootScreen />;

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/session"
          element={
            <ErrorBoundary>
              <Suspense fallback={<SessionSkeleton />}>
                <PlayScreen />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="play" element={<PlaySetup />} />
          <Route path="train" element={<Train />} />
          <Route path="train/:mode" element={<ModuleSetup />} />
          <Route path="results/:id" element={<Results />} />
          <Route path="settings" element={<Settings />} />
          <Route path="stats" element={<StatsLayout />}>
            <Route index element={<Overview />} />
            <Route path="trends" element={<Trends />} />
            <Route path="patterns" element={<Patterns />} />
            <Route path="timing" element={<Timing />} />
            <Route path="bests" element={<Bests />} />
            <Route path="history" element={<History />} />
            <Route path="play/:id" element={<PlayDetail />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
