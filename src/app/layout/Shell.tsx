import { NavLink, Outlet } from 'react-router';
import { Notice } from '../components/ui';
import { FAKE_BANNER, NAV, OUTDATED } from '../copy';
import { isFakeMode } from '../play/mode';
import { useAppState } from '../state/store';

export function Shell() {
  const { storageError, outdated } = useAppState();
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-1 focus:text-accent-ink">
        Skip to content
      </a>
      <header className="border-b border-line bg-bg/80 backdrop-blur">
        <nav aria-label="Main" className="mx-auto flex max-w-5xl items-center gap-1 px-4 py-3">
          <NavLink to="/" className="mr-4 text-lg font-semibold tracking-tight text-ink">
            Flick<span className="text-accent">wise</span>
          </NavLink>
          {NAV.filter((n) => n.to !== '/').map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm transition ${isActive ? 'bg-surface-2 text-accent' : 'text-ink-2 hover:text-ink'}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-4 space-y-2 empty:hidden">
          {outdated && <Notice tone="warn">{OUTDATED}</Notice>}
          {storageError && (
            <Notice tone="bad">
              Saving is not working in this browser. {storageError} Plays will not be kept.
            </Notice>
          )}
          {isFakeMode() && <Notice tone="accent">{FAKE_BANNER}</Notice>}
        </div>
        <Outlet />
      </main>
    </div>
  );
}
