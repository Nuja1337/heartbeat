import { NavLink, Outlet } from 'react-router';
import { AnalysisError } from '../../components/AnalysisError';
import { useAnalysis } from '../../state/analysis';

const TABS = [
  { to: '/stats', label: 'Overview', end: true },
  { to: '/stats/trends', label: 'Trends', end: false },
  { to: '/stats/patterns', label: 'Patterns', end: false },
  { to: '/stats/timing', label: 'Timing', end: false },
  { to: '/stats/bests', label: 'Bests', end: false },
  { to: '/stats/history', label: 'History', end: false },
];

export function StatsLayout() {
  const { error, reload } = useAnalysis();
  return (
    <>
      <nav aria-label="Stats" className="mb-6 flex flex-wrap gap-1 border-b border-line pb-2">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) => `rounded-md px-3 py-1.5 text-sm transition ${isActive ? 'bg-surface-2 text-accent' : 'text-ink-2 hover:text-ink'}`}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      {error && <AnalysisError message={error} onRetry={reload} />}
      <Outlet />
    </>
  );
}
