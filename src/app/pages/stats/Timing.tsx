import { useEffect, useMemo, useState } from 'react';
import { isStreamNote } from '../../../analytics/buckets';
import { aggOf, median } from '../../../analytics/stats';
import { listSummariesSince, loadPlayData } from '../../../data/plays';
import type { PlayData } from '../../../data/schema';
import { Histogram, histCounts } from '../../charts/Histogram';
import { useChartColors } from '../../charts/scale';
import { Card, PageHeader, Stat } from '../../components/ui';
import { INTRO } from '../../copy';
import { offsetText, pct0 } from '../../format';
import { THEMES, darkenToContrast } from '../../../shared/theme';
import { useAnalysis } from '../../state/analysis';
import { useTheme } from '../../state/appearance';
import { msg, t } from '../../i18n';

const DAY = 86_400_000;
const MAX_PLAYS = 40;

const SERIES = [
  { id: 'circle', label: msg('Circles'), color: '#ffb340' },
  { id: 'head', label: msg('Slider heads'), color: '#b49bff' },
  { id: 'stream', label: msg('Stream notes'), color: '#ff7ab8' },
] as const;

export function Timing() {
  const C = useChartColors();
  const theme = useTheme();
  // The series colors suit the dark surface. On white they are darkened until they reach 4.5 to 1.
  const series = SERIES.map((s) => ({
    ...s,
    color: theme === 'light' ? darkenToContrast(s.color, THEMES.light.surface, 4.5) : s.color,
  }));
  const { data } = useAnalysis();
  const [plays, setPlays] = useState<PlayData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Record<string, boolean>>({ circle: true, head: false, stream: true });

  useEffect(() => {
    if (!data) return;
    let alive = true;
    listSummariesSince(data.now - 30 * DAY)
      .then((list) => loadPlayData(list.filter((s) => s.hasDetail).slice(0, MAX_PLAYS)))
      .then((p) => alive && setPlays(p))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : t('Could not read your plays.')));
    return () => {
      alive = false;
    };
  }, [data]);

  const groups = useMemo(() => {
    const all: number[] = [];
    const circle: number[] = [];
    const head: number[] = [];
    const stream: number[] = [];
    const crisp: number[] = [];
    for (const { records } of plays ?? []) {
      for (const r of records) {
        if (r.afterPause || r.kind === 'spinner' || r.timingError === null) continue;
        all.push(r.timingError);
        crisp.push(r.crispMs);
        if (r.kind === 'circle') circle.push(r.timingError);
        else head.push(r.timingError);
        if (isStreamNote(r)) stream.push(r.timingError);
      }
    }
    return { all, circle, head, stream, crispMs: crisp.length ? median(crisp) : 40 };
  }, [plays]);

  if (error) return <p className="text-danger">{error}</p>;
  if (!plays) return <p className="text-ink-2">{t('Loading.')}</p>;

  const a = aggOf(groups.all);
  const within = groups.all.filter((v) => Math.abs(v) <= groups.crispMs).length;
  const early = groups.all.filter((v) => v < 0).length;

  return (
    <>
      <PageHeader title={t('Timing')} intro={INTRO.timing} />
      {groups.all.length === 0 ? (
        <Card>
          <p className="text-ink-2">
            {t('No clicks with stored detail from the last 30 days. Play a few maps, or check the detail retention in Settings.')}
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <div className="flex flex-wrap gap-x-12 gap-y-4">
              <Stat
                label={t('Average')}
                value={offsetText(a.mean)}
                sub={t('{clicks, plural, one {# click} other {# clicks}} from {plays, plural, one {# play} other {# plays}}', {
                  clicks: groups.all.length,
                  plays: plays.length,
                })}
              />
              <Stat label={t('Spread')} value={`${Math.round(a.sd)} ms`} sub={t('one standard deviation')} />
              <Stat
                label={t('Inside the Crisp window')}
                value={pct0(within / groups.all.length)}
                sub={t('{ms} ms either side', { ms: Math.round(groups.crispMs) })}
              />
              <Stat
                label={t('Early')}
                value={pct0(early / groups.all.length)}
                sub={t('{pct} late or on time', { pct: pct0(1 - early / groups.all.length) })}
              />
            </div>
          </Card>
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="flex items-center gap-2">
                <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: C.accent }} />
                {t('All clicks (bars)')}
              </span>
              {series.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-[var(--color-accent)]"
                    checked={shown[s.id] ?? false}
                    onChange={(e) => setShown((cur) => ({ ...cur, [s.id]: e.target.checked }))}
                  />
                  <span aria-hidden className="h-0.5 w-4" style={{ background: s.color }} />
                  {t('{label} ({n})', { label: t(s.label), n: groups[s.id].length })}
                </label>
              ))}
            </div>
            <Histogram
              label={t('Timing errors in 5 ms bins from minus 150 to plus 150 milliseconds')}
              series={[
                { label: t('All clicks'), color: C.accent, counts: histCounts(groups.all) },
                ...series
                  .filter((s) => shown[s.id] && groups[s.id].length > 0)
                  .map((s) => ({
                    label: t(s.label),
                    color: s.color,
                    counts: histCounts(groups[s.id]),
                  })),
              ]}
              mean={a.mean}
              sd={a.sd}
              windows={{ crisp: groups.crispMs, solid: groups.crispMs * 2, rough: groups.crispMs * 3 }}
              height={280}
            />
            <p className="mt-2 text-sm text-ink-2">
              {t(
                'Left of zero is early and right of zero is late. Each series is a share of its own clicks. The white line is the average and the bracket is one spread either side. Shaded bands are the Crisp, Solid and Rough windows.',
              )}
            </p>
          </Card>
        </div>
      )}
    </>
  );
}
