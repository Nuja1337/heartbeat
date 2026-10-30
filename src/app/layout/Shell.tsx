import { Suspense } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { DB_BLOCKED_MESSAGE } from '../../data/db';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { IconSettings } from '../components/icons';
import { PageSkeleton } from '../components/Skeleton';
import { Button, Notice } from '../components/ui';
import { FAKE_BANNER, NAV, OUTDATED } from '../copy';
import { isFakeMode } from '../play/mode';
import { UPDATE_READY_MESSAGE, applyUpdate, usePwa } from '../pwa';
import { useAppState } from '../state/store';
import { StreakChip } from './StreakChip';

const BAR = '-mb-px flex h-14 items-center border-b-2 px-2.5 text-base transition sm:px-3';

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-display text-xl font-bold tracking-tight text-ink ${className}`}>
      Flick<span className="text-accent">wise</span>
    </span>
  );
}

export function Shell() {
  const { storageError, outdated, blocked, dbMessage } = useAppState();
  const { updateReady } = usePwa();
  // The first path segment, so moving between stats tabs doesn't replay the page enter.
  const area = useLocation().pathname.split('/')[1] ?? '';

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-1 focus:text-accent-ink">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-1 px-4 sm:gap-2 sm:px-6">
          <NavLink to="/" aria-label="Flickwise, home" className="mr-2 sm:mr-6">
            <Wordmark />
          </NavLink>
          <nav aria-label="Main" className="flex min-w-0 flex-1 items-center">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => `${BAR} ${isActive ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <StreakChip />
          <NavLink
            to="/settings"
            aria-label="Settings"
            title="Settings"
            className={({ isActive }) =>
              `grid size-9 shrink-0 place-items-center rounded-md transition ${isActive ? 'bg-surface-2 text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`
            }
          >
            <IconSettings />
          </NavLink>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-6 space-y-2 empty:hidden">
          {updateReady && (
            <Notice tone="accent">
              <span className="flex flex-wrap items-center justify-between gap-3">
                <span>{UPDATE_READY_MESSAGE}</span>
                <Button size="sm" variant="primary" onClick={applyUpdate}>
                  Reload
                </Button>
              </span>
            </Notice>
          )}
          {blocked && <Notice tone="warn">{DB_BLOCKED_MESSAGE}</Notice>}
          {dbMessage && <Notice tone="bad">{dbMessage}</Notice>}
          {outdated && <Notice tone="warn">{OUTDATED}</Notice>}
          {storageError && (
            <Notice tone="bad">
              Saving is not working in this browser. {storageError} Plays will not be kept.
            </Notice>
          )}
          {isFakeMode() && <Notice tone="accent">{FAKE_BANNER}</Notice>}
        </div>
        <ErrorBoundary resetKey={area}>
          <Suspense fallback={<PageSkeleton />}>
            <div key={area} className="fw-enter">
              <Outlet />
            </div>
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
