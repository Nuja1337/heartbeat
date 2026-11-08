import { Link } from 'react-router';
import { AnalysisError } from '../components/AnalysisError';
import { DailyCard } from '../components/DailyCard';
import { Badge, GradeBadge, PageHeader, Panel, SectionTitle } from '../components/ui';
import { INTRO } from '../copy';
import { pct, shortDate } from '../format';
import { t } from '../i18n';
import { useAnalysis } from '../state/analysis';
import { dailyHistory } from '../state/daily';

/** A date key such as 2026-10-29 as a day and month. */
const dayOf = (key: string): string => {
  const [y, m, d] = key.split('-').map(Number);
  return y && m && d ? shortDate(new Date(y, m - 1, d).getTime()) : key;
};

const HISTORY_ROWS = 30;

export function Daily() {
  const { data, error, reload } = useAnalysis();
  const rows = data ? dailyHistory(data.summaries) : [];

  return (
    <>
      <PageHeader title={t('Daily')} intro={INTRO.daily} />
      {error && (
        <div className="mb-6">
          <AnalysisError message={error} onRetry={reload} />
        </div>
      )}
      {!data ? (
        !error && (
          <div role="status" aria-busy="true" className="grid gap-6 lg:grid-cols-3">
            <div className="hb-skeleton h-72 lg:col-span-1" />
            <div className="hb-skeleton h-72 lg:col-span-2" />
            <span className="sr-only">{t('Loading.')}</span>
          </div>
        )
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <DailyCard data={data} full />
          </div>
          <Panel className="min-w-0 lg:col-span-2">
            <SectionTitle
              aside={<span>{t('Longest streak, {n, plural, one {# day} other {# days}}', { n: data.dailyStreak.longest })}</span>}
            >
              {t('History')}
            </SectionTitle>
            {rows.length === 0 ? (
              <p className="text-ink-2">{t('No daily maps played yet. Your first one will show up here.')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-ink-3">
                      <th className="py-2 pr-4 text-micro font-semibold uppercase">{t('Date')}</th>
                      <th className="py-2 pr-4 text-micro font-semibold uppercase">{t('Level')}</th>
                      <th className="py-2 pr-4 text-micro font-semibold uppercase">{t('Accuracy')}</th>
                      <th className="py-2 text-micro font-semibold uppercase">{t('Grade')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, HISTORY_ROWS).map((r) => (
                      <tr key={r.id} className="border-t border-line">
                        <td className="py-2 pr-4">
                          <Link to={`/results/${r.id}`} className="text-ink hover:text-accent hover:underline">
                            {dayOf(r.date)}
                          </Link>
                        </td>
                        <td className="py-2 pr-4 tabular-nums">{r.level ?? t('Custom')}</td>
                        <td className="py-2 pr-4 tabular-nums">{pct(r.accuracy)}</td>
                        <td className="py-2">
                          {r.grade ? <GradeBadge grade={r.grade} size="chip" /> : <Badge tone="warn">{t('Not finished')}</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {rows.length > HISTORY_ROWS && (
              <p className="mt-3 text-sm text-ink-2">
                {t('The latest {shown} of {n, plural, one {# play} other {# plays}}.', { shown: HISTORY_ROWS, n: rows.length })}
              </p>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
