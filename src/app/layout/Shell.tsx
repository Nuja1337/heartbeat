import { Suspense, useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigationType } from 'react-router';
import { DB_BLOCKED_MESSAGE } from '../../data/db';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { IconSettings } from '../components/icons';
import { PageSkeleton } from '../components/Skeleton';
import { Button, Notice } from '../components/ui';
import { FAKE_BANNER, FOOTER, NAV, OUTDATED } from '../copy';
import { isFakeMode } from '../play/mode';
import { UPDATE_READY_MESSAGE, applyUpdate, usePwa } from '../pwa';
import { useAppState } from '../state/store';
import { t } from '../i18n';
import { StreakChip } from './StreakChip';

// On a phone the tabs are smaller, so they fit beside the wordmark, the streak chip and the settings icon at 390 px.
const BAR = '-mb-px flex h-14 items-center border-b-2 px-1.5 text-sm transition sm:px-3 sm:text-base';

/** The location the shell last scrolled to the top for. */
let scrolledFor = '';

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-display text-xl font-bold tracking-tight text-ink ${className}`}>
      Heart<span className="text-accent">beat</span>
    </span>
  );
}

export function Shell() {
  const { storageError, outdated, blocked, dbMessage } = useAppState();
  const { updateReady } = usePwa();
  const { pathname, hash, key: locationKey } = useLocation();
  const navigationType = useNavigationType();
  // The first path segment, so moving between stats tabs doesn't replay the page enter.
  const area = pathname.split('/')[1] ?? '';

  // A link opens its page at the top. Back and forward keep the browser's position, and a link with an anchor
  // leaves the scrolling to the page that owns the anchor. A language change mounts the shell again for the same
  // location, which is not a navigation, so the location key says whether this one was handled.
  // After a link, focus moves to the main region as well, so a screen reader starts reading the new page instead of
  // staying on the link that was clicked.
  useEffect(() => {
    if (scrolledFor === locationKey) return;
    const first = scrolledFor === '';
    scrolledFor = locationKey;
    if (navigationType !== 'POP' && !hash) {
      window.scrollTo(0, 0);
      if (!first) document.getElementById('main')?.focus({ preventScroll: true });
    }
    // The location key is the signal to scroll. Nothing else in the effect is read for its value.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [locationKey, hash, navigationType]);

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-1 focus:text-accent-ink"
      >
        {t('Skip to content')}
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-1 px-4 sm:gap-2 sm:px-6">
          <NavLink to="/" aria-label={t('Heartbeat, home')} className="mr-1 sm:mr-6">
            <Wordmark />
          </NavLink>
          <nav aria-label={t('Main')} className="flex min-w-0 flex-1 items-center">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                // The wordmark already links home, so the Home tab gives way on a phone to make room for the others.
                className={({ isActive }) =>
                  `${BAR} ${n.to === '/' ? 'max-sm:hidden' : ''} ${isActive ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`
                }
              >
                {t(n.label)}
              </NavLink>
            ))}
          </nav>
          <StreakChip />
          <NavLink
            to="/settings"
            aria-label={t('Settings')}
            title={t('Settings')}
            className={({ isActive }) =>
              `grid size-9 shrink-0 place-items-center rounded-md transition ${isActive ? 'bg-surface-2 text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`
            }
          >
            <IconSettings />
          </NavLink>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-8 outline-none sm:px-6 sm:py-12">
        <div className="mb-6 space-y-2 empty:hidden">
          {updateReady && (
            <Notice tone="accent">
              <span className="flex flex-wrap items-center justify-between gap-3">
                <span>{t(UPDATE_READY_MESSAGE)}</span>
                <Button size="sm" variant="primary" onClick={applyUpdate}>
                  {t('Reload')}
                </Button>
              </span>
            </Notice>
          )}
          {blocked && <Notice tone="warn">{t(DB_BLOCKED_MESSAGE)}</Notice>}
          {dbMessage && <Notice tone="bad">{t(dbMessage)}</Notice>}
          {outdated && <Notice tone="warn">{t(OUTDATED)}</Notice>}
          {storageError && (
            <Notice tone="bad">
              {t('Saving is not working in this browser. {error} Plays will not be kept.', { error: storageError })}
            </Notice>
          )}
          {isFakeMode() && <Notice tone="accent">{t(FAKE_BANNER)}</Notice>}
        </div>
        <ErrorBoundary resetKey={pathname}>
          <Suspense fallback={<PageSkeleton />}>
            <div key={area} className="hb-enter">
              <Outlet />
            </div>
          </Suspense>
        </ErrorBoundary>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-6 text-sm text-ink-3 sm:px-6">
          <p>{t('Heartbeat {version}. Your plays stay in this browser.', { version: __APP_VERSION__ })}</p>
          <nav aria-label={t('About Heartbeat')} className="flex flex-wrap gap-x-5 gap-y-1">
            {FOOTER.map((f) => (
              <Link key={f.to} to={f.to} className="transition hover:text-ink">
                {t(f.label)}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
