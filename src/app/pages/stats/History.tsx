import { useState } from 'react';
import { Link } from 'react-router';
import { groupSessions } from '../../../analytics/sessions';
import { deletePlay } from '../../../data/plays';
import { MODES, MODE_ORDER } from '../../../shared/catalog';
import type { ModeId } from '../../../shared/types';
import { Badge, Button, Card, PageHeader } from '../../components/ui';
import { EMPTY_STATS, INTRO } from '../../copy';
import { dateTime, duration, int, modList, pct, playTitle, timeOf } from '../../format';
import { invalidateAnalysis, useAnalysis } from '../../state/analysis';
import { t } from '../../i18n';

export function History() {
  const { data } = useAnalysis();
  const [mode, setMode] = useState<ModeId | 'all'>('all');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!data) return <p className="text-ink-2">{t('Loading.')}</p>;

  const plays = data.summaries.filter((s) => mode === 'all' || s.modeId === mode);
  const sessions = groupSessions(plays);

  const remove = async (id: string) => {
    try {
      await deletePlay(id);
      invalidateAnalysis();
      setConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not delete this play.'));
    }
  };

  return (
    <>
      <PageHeader title={t('History')} intro={INTRO.history} />
      {data.summaries.length === 0 ? (
        <Card>
          <p className="text-ink-2">{t(EMPTY_STATS)}</p>
        </Card>
      ) : (
        <>
          <div className="mb-4">
            <label className="mr-2 text-sm text-ink-2" htmlFor="mode-filter">
              {t('Mode')}
            </label>
            <select id="mode-filter" value={mode} onChange={(e) => setMode(e.target.value as ModeId | 'all')}>
              <option value="all">{t('All modes')}</option>
              {MODE_ORDER.map((m) => (
                <option key={m} value={m}>
                  {MODES[m].label}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p role="alert" className="mb-3 text-danger">
              {error}
            </p>
          )}
          <div className="space-y-4">
            {sessions.map((session) => (
              <Card key={session.start}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-medium">{dateTime(session.start)}</h2>
                  <span className="text-sm text-ink-2">
                    {t('{n, plural, one {# play} other {# plays}}, {duration} played', {
                      n: session.plays.length,
                      duration: duration(session.playedMs),
                    })}
                  </span>
                </div>
                <ul className="divide-y divide-line">
                  {[...session.plays].reverse().map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
                      <span className="w-12 text-ink-2">{timeOf(p.startedAt)}</span>
                      <Link to={`/stats/play/${p.id}`} className="min-w-40 flex-1 text-accent hover:underline">
                        {playTitle(p)}
                      </Link>
                      <span className="text-ink-2">{modList(p.mods)}</span>
                      {p.status !== 'completed' && <Badge tone="warn">{p.status === 'failed' ? t('Failed') : t('Quit')}</Badge>}
                      {p.modeId === 'dynamic' && <span className="w-20 text-right">{int(p.score)}</span>}
                      <span className="w-16 text-right">{pct(p.accuracy)}</span>
                      {confirm === p.id ? (
                        <span className="flex gap-1">
                          <Button size="sm" variant="danger" onClick={() => void remove(p.id)}>
                            {t('Delete')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                            {t('Keep')}
                          </Button>
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t('Delete the play from {date}', { date: dateTime(p.startedAt) })}
                          onClick={() => setConfirm(p.id)}
                        >
                          {t('Delete')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
            {sessions.length === 0 && (
              <Card>
                <p className="text-ink-2">{t('No plays in this mode.')}</p>
              </Card>
            )}
          </div>
        </>
      )}
    </>
  );
}
