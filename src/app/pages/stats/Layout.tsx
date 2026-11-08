import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { AnalysisError } from '../../components/AnalysisError';
import { PageSkeleton } from '../../components/Skeleton';
import { TabNav } from '../../components/ui';
import { useAnalysis } from '../../state/analysis';
import { msg, t } from '../../i18n';

const TABS = [
  { to: '/stats', label: msg('Overview'), end: true },
  { to: '/stats/trends', label: msg('Trends'), end: false },
  { to: '/stats/patterns', label: msg('Patterns'), end: false },
  { to: '/stats/aim', label: msg('Aim'), end: false },
  { to: '/stats/timing', label: msg('Timing'), end: false },
  { to: '/stats/bests', label: msg('Bests'), end: false },
  { to: '/stats/history', label: msg('History'), end: false },
];

export function StatsLayout() {
  const { error, reload } = useAnalysis();
  return (
    <>
      <TabNav label={t('Stats')} tabs={TABS.map((tab) => ({ ...tab, label: t(tab.label) }))} />
      {error && <AnalysisError message={error} onRetry={reload} />}
      <Suspense fallback={<PageSkeleton />}>
        <Outlet />
      </Suspense>
    </>
  );
}
