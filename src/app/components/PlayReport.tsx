import type { ReactNode } from 'react';
import { JUDGMENTS, MODES } from '../../shared/catalog';
import type { Judgment } from '../../shared/types';
import type { PlaySummary } from '../../data/schema';
import type { HitRecord } from '../../shared/types';
import { median } from '../../analytics/stats';
import { AimScatter } from '../charts/AimScatter';
import { JCOLOR, useChartColors } from '../charts/scale';
import { Bars } from '../charts/Bars';
import { Histogram, histCounts } from '../charts/Histogram';
import { alongText, duration, int, lateralText, level, offsetText, pct, widthPct } from '../format';
import { t } from '../i18n';
import { Count } from './Count';
import { Card, SectionTitle, Stat, StatBig } from './ui';

const ORDER: Judgment[] = ['crisp', 'solid', 'rough', 'miss'];

/** How far a slider follower trails the ball, in words. A trail behind is a negative move along the path. */
function lagText(radii: number): string {
  const v = Math.round(Math.abs(radii) * 50);
  if (v === 0) return alongText(radii);
  return t('{pct}% {side, select, behind {behind} other {ahead}}', { pct: v, side: radii < 0 ? 'behind' : 'ahead' });
}

/**
 * The numbers and small charts shared by the results screen and the play detail page.
 * `extra` goes between the headline numbers and the rest, for panels only one of the two pages shows.
 */
export function PlayReport({
  summary: s,
  records,
  extra,
  hideLevels = false,
}: {
  summary: PlaySummary;
  records: HitRecord[] | null;
  extra?: ReactNode;
  /** Leaves the module levels out of the headline numbers, for a page whose `extra` already shows them. */
  hideLevels?: boolean;
}) {
  const C = useChartColors();
  const isDynamic = s.modeId === 'dynamic';
  const levelEntries = Object.entries(s.finalLevels) as [string, number][];
  const total = Math.max(1, s.objectCount);
  const crispMs = records && records.length ? median(records.map((r) => r.crispMs)) : 40;
  const timing = records ? records.filter((r) => r.kind !== 'spinner' && r.timingError !== null).map((r) => r.timingError!) : [];

  return (
    <div className="space-y-6">
      <Card marks>
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          {isDynamic ? (
            <StatBig label={t('Score')} value={<Count value={s.score} format={int} />} />
          ) : !hideLevels && levelEntries.length > 0 ? (
            levelEntries.map(([id, v]) => (
              <StatBig
                key={id}
                label={t('{module} level', { module: MODES[id as keyof typeof MODES].label })}
                value={<Count value={v} format={level} />}
              />
            ))
          ) : null}
          <Stat label={t('Accuracy')} value={<Count value={s.accuracy * 100} format={(v) => pct(v / 100)} />} />
          <Stat label={t('Max combo')} value={int(s.maxCombo)} />
          <Stat label={t('Time played')} value={duration(s.playedMs)} />
          <Stat label={t('Objects')} value={int(s.objectCount)} />
        </div>
        <div className="mt-5">
          <div
            className="flex h-2 overflow-hidden rounded-full bg-line"
            role="img"
            aria-label={ORDER.map((j) => t('{judgment} {n}', { judgment: JUDGMENTS[j].label, n: s.counts[j] })).join(', ')}
          >
            {ORDER.map((j) => (
              <span key={j} style={{ width: `${(s.counts[j] / total) * 100}%`, background: JCOLOR[j] }} />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {ORDER.map((j) => (
              <li key={j} className="flex items-center gap-2">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: JCOLOR[j] }} />
                <span className="text-ink-2">{JUDGMENTS[j].label}</span>
                <span>{s.counts[j]}</span>
              </li>
            ))}
            {s.sliderParts.total > 0 && (
              <li className="text-ink-2">{t('Slider parts {hit} of {total}', { hit: s.sliderParts.hit, total: s.sliderParts.total })}</li>
            )}
            <li className="text-ink-2">{t('Stray presses {n}', { n: s.strayPresses })}</li>
          </ul>
        </div>
      </Card>

      {extra}

      {s.levels.length > 0 && (
        <Card>
          <SectionTitle>{t('Level by set')}</SectionTitle>
          <Bars
            label={t('Level after each set')}
            max={Math.max(...s.levels.map((l) => l.level), 1) * 1.1}
            items={s.levels.map((l) => ({
              label: t('Set {n}, {module}', { n: l.set + 1, module: MODES[l.module].label }),
              value: l.level,
              text: `${level(l.level)} · ${Math.round(l.success * 100)}%`,
            }))}
          />
          <p className="mt-2 text-sm text-ink-2">{t('The number after the level is the share of the set that counted as a success.')}</p>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <SectionTitle>{t('Timing')}</SectionTitle>
          {s.timing.n > 0 ? (
            <>
              <div className="mb-3 flex gap-8">
                <Stat label={t('Average')} value={offsetText(s.timing.mean)} />
                <Stat label={t('Spread')} value={`${Math.round(s.timing.sd)} ms`} sub={t('one standard deviation')} />
              </div>
              {timing.length > 0 ? (
                <Histogram
                  label={t('Timing errors in 5 ms bins')}
                  compact
                  height={250}
                  series={[{ label: t('All taps'), color: C.accent, counts: histCounts(timing) }]}
                  mean={s.timing.mean}
                  sd={s.timing.sd}
                  windows={{ crisp: crispMs, solid: crispMs * 2, rough: crispMs * 3 }}
                />
              ) : (
                <p className="text-sm text-ink-2">
                  {t('The histogram needs the per-object detail, which has been removed for this play.')}
                </p>
              )}
            </>
          ) : (
            <p className="text-ink-2">{t('No presses were recorded.')}</p>
          )}
        </Card>

        <Card>
          <SectionTitle>{t('Aim')}</SectionTitle>
          {s.aim.n > 0 ? (
            <>
              <div className="mb-3 flex flex-wrap gap-x-8 gap-y-2">
                <Stat
                  label={t('Along the move')}
                  value={alongText(s.aim.alongMean)}
                  sub={t('spread {value}', { value: widthPct(s.aim.alongSd) })}
                />
                <Stat
                  label={t('Across the move')}
                  value={lateralText(s.aim.lateralMean)}
                  sub={t('spread {value}', { value: widthPct(s.aim.lateralSd) })}
                />
                <Stat label={t('From center')} value={widthPct(s.aim.radialMean)} sub={t("of a target's width")} />
              </div>
              {records ? (
                <AimScatter records={records} size={260} />
              ) : (
                <p className="text-sm text-ink-2">{t('The scatter needs the per-object detail, which has been removed for this play.')}</p>
              )}
            </>
          ) : (
            <p className="text-ink-2">{t('No aimed clicks were recorded.')}</p>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle>{t('By kind of object')}</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-2">
                <th className="py-1 pr-4 font-normal">{t('Kind')}</th>
                <th className="py-1 pr-4 font-normal">{t('Count')}</th>
                <th className="py-1 pr-4 font-normal">{t('Accuracy')}</th>
                <th className="py-1 font-normal">{t('Details')}</th>
              </tr>
            </thead>
            <tbody>
              {s.kinds.circle && (
                <tr className="border-t border-line">
                  <td className="py-1.5 pr-4">{t('Circles')}</td>
                  <td className="pr-4">{s.kinds.circle.n}</td>
                  <td className="pr-4">{pct(s.kinds.circle.accuracy)}</td>
                  <td className="text-ink-2">
                    {t('{misses} missed, timing {timing} with a spread of {sd} ms', {
                      misses: s.kinds.circle.misses,
                      timing: offsetText(s.kinds.circle.timingMean),
                      sd: Math.round(s.kinds.circle.timingSd),
                    })}
                  </td>
                </tr>
              )}
              {s.kinds.slider && (
                <tr className="border-t border-line">
                  <td className="py-1.5 pr-4">{t('Sliders')}</td>
                  <td className="pr-4">{s.kinds.slider.n}</td>
                  <td className="pr-4">{pct(s.kinds.slider.accuracy)}</td>
                  <td className="text-ink-2">
                    {t('{tracked} tracked, {lag}, end held on {end}', {
                      tracked: pct(s.kinds.slider.trackedMean, 0),
                      lag: lagText(s.kinds.slider.lagMean),
                      end: pct(s.kinds.slider.endHitRate, 0),
                    })}
                  </td>
                </tr>
              )}
              {s.kinds.spinner && (
                <tr className="border-t border-line">
                  <td className="py-1.5 pr-4">{t('Spinners')}</td>
                  <td className="pr-4">{s.kinds.spinner.n}</td>
                  <td className="pr-4">{pct(s.kinds.spinner.accuracy)}</td>
                  <td className="text-ink-2">
                    {t('{mean} rpm on average, {peak} at the peak', {
                      mean: Math.round(s.kinds.spinner.meanRpm),
                      peak: Math.round(s.kinds.spinner.peakRpm),
                    })}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
