import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { AnalysisError } from '../../components/AnalysisError';
import { PageSkeleton } from '../../components/Skeleton';
import { TabNav } from '../../components/ui';
import { useAnalysis } from '../../state/analysis';

const TABS = [
  { to: '/stats', label: 'Overview', end: true },
  { to: '/stats/trends', label: 'Trends', end: false },
  { to: '/stats/patterns', label: 'Patterns', end: false },
  { to: '/stats/aim', label: 'Aim', end: false },
  { to: '/stats/timing', label: 'Timing', end: false },
  { to: '/stats/bests', label: 'Bests', end: false },
  { to: '/stats/history', label: 'History', end: false },
];

export function StatsLayout() {
  const { error, reload } = useAnalysis();
  return (
    <>
      <TabNav label="Stats" tabs={TABS} />
      {error && <AnalysisError message={error} onRetry={reload} />}
      <Suspense fallback={<PageSkeleton />}>
        <Outlet />
      </Suspense>
    </>
  );
}
