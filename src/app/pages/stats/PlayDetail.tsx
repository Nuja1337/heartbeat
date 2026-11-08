import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { fatigueCurve } from '../../../analytics/index';
import { JUDGMENTS } from '../../../shared/catalog';
import { Bars } from '../../charts/Bars';
import { Fatigue } from '../../charts/Fatigue';
import { Timeline } from '../../charts/Timeline';
import { PlayReport } from '../../components/PlayReport';
import { SectionStrip } from '../../components/SectionStrip';
import { Badge, Button, Card, LinkButton, Notice, PageHeader, SectionTitle, usePageTitle } from '../../components/ui';
import { dateTime, modList, pct, playTitle } from '../../format';
import { OLD_GENERATOR_NOTE, isOlderGenerator, useGeneratorVersion } from '../../state/generator';
import { setupPath, startWithCurrentLevels } from '../../state/launch';
import { replayLink } from '../../state/replayMarkers';
import { getAppState } from '../../state/store';
import { usePlay } from '../../state/usePlay';
import { formatNumber } from '../../../shared/i18n';
import { t } from '../../i18n';

export function PlayDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { play, missing, error } = usePlay(id);
  const [startError, setStartError] = useState<string | null>(null);
  const generator = useGeneratorVersion();
  const fatigue = useMemo(() => (play?.records ? fatigueCurve(play.records) : []), [play]);
  usePageTitle(t('Play', undefined, 'noun'));

  if (error) return <Notice tone="bad">{error}</Notice>;
  if (missing) {
    return (
      <Card>
        <p>{t("This play isn't saved on this device. It may have been deleted.")}</p>
        <LinkButton to="/stats/history" className="mt-3">
          {t('History')}
        </LinkButton>
      </Card>
    );
  }
  if (!play) return <p className="text-ink-2">{t('Loading.')}</p>;
  const { summary: s, records } = play;
  const sliders = (records ?? []).filter((r) => r.slider);
  const spinners = (records ?? []).filter((r) => r.spinner);
  const older = isOlderGenerator(s.generatorVersion, generator);
  const misses = (records ?? []).filter((r) => r.judgment === 'miss');
  const replay = () =>
    startWithCurrentLevels(navigate, s.launch, setupPath(s.launch), getAppState().prefs.fullscreen, false).catch((e: unknown) =>
      setStartError(e instanceof Error ? e.message : t('Could not read your module levels.')),
    );

  return (
    <>
      <PageHeader
        title={playTitle(s)}
        intro={t('{date}. {mods}. Seed {seed}.', { date: dateTime(s.startedAt), mods: modList(s.mods), seed: String(s.seed) })}
        actions={
          <>
            <Button variant="primary" onClick={replay}>
              {older ? t('Play with these settings') : t('Play this map again')}
            </Button>
            {s.hasReplay && <LinkButton to={`/replay/${s.id}`}>{t('Watch replay')}</LinkButton>}
            <LinkButton to="/stats/history" variant="ghost">
              {t('History')}
            </LinkButton>
          </>
        }
      />
      {startError && (
        <div className="mb-4">
          <Notice tone="bad">{startError}</Notice>
        </div>
      )}
      {older && (
        <div className="mb-4">
          <Notice tone="warn">{t(OLD_GENERATOR_NOTE)}</Notice>
        </div>
      )}
      {!records && (
        <div className="mb-4">
          <Notice>
            {t('The per-object detail for this play was removed by the retention setting. The summary numbers below are still here.')}
          </Notice>
        </div>
      )}
      <div className="space-y-6">
        <PlayReport
          summary={s}
          records={records}
          extra={
            s.sections && s.sections.length > 0 ? (
              <Card>
                <SectionTitle aside={t('Accuracy in each part of the map')}>{t('Sections')}</SectionTitle>
                <SectionStrip sections={s.sections} />
              </Card>
            ) : null
          }
        />

        {records && (
          <Card>
            <SectionTitle>{t('Timing through the play')}</SectionTitle>
            <Timeline records={records} onOpen={s.hasReplay ? (time) => navigate(replayLink(s.id, time)) : undefined} />
          </Card>
        )}

        {records && (
          <Card>
            <SectionTitle>{t('Accuracy through the play')}</SectionTitle>
            <Fatigue points={fatigue} />
          </Card>
        )}

        {s.hasReplay && misses.length > 0 && (
          <Card>
            <SectionTitle aside={t('Each link opens the replay 1.5 seconds before the miss')}>{t('Misses in the replay')}</SectionTitle>
            <ul className="flex flex-wrap gap-2">
              {misses.slice(0, 40).map((r) => (
                <li key={r.index}>
                  <Link
                    to={replayLink(s.id, r.time)}
                    className="inline-flex h-7 items-center rounded-full border border-line-2 bg-surface-2 px-3 text-sm text-ink-2 transition hover:border-accent hover:text-ink"
                  >
                    {t('Object {n}', { n: r.index + 1 })}
                  </Link>
                </li>
              ))}
            </ul>
            {misses.length > 40 && (
              <p className="mt-2 text-sm text-ink-2">
                {t('The first 40 of {n, plural, one {# miss} other {# misses}}.', { n: misses.length })}
              </p>
            )}
          </Card>
        )}

        <Card>
          <SectionTitle>{t('Accuracy by quarter')}</SectionTitle>
          {s.quarters.every((q) => q === null) ? (
            <p className="text-ink-2">{t('The play was too short to split into quarters.')}</p>
          ) : (
            <Bars
              label={t('Accuracy in each quarter of the play')}
              max={1}
              items={s.quarters.map((q, i) => ({
                label: t('Quarter {n}', { n: i + 1 }),
                value: q ?? 0,
                text: q === null ? t('none') : pct(q, 0),
                color: JUDGMENTS.solid.color,
              }))}
            />
          )}
        </Card>

        {sliders.length > 0 && (
          <Card>
            <SectionTitle aside={t('Share of each slider you stayed on')}>{t('Sliders')}</SectionTitle>
            <Bars
              label={t('Tracked share of each slider')}
              max={1}
              items={sliders.slice(0, 40).map((r, i) => ({
                label: t('Slider {n}', { n: i + 1 }),
                value: r.slider!.trackedFraction,
                text: pct(r.slider!.trackedFraction, 0),
                color: JUDGMENTS[r.judgment].color,
              }))}
            />
            {sliders.length > 40 && (
              <p className="mt-2 text-sm text-ink-2">
                {t('The first 40 of {n, plural, one {# slider} other {# sliders}}.', { n: sliders.length })}
              </p>
            )}
          </Card>
        )}

        {spinners.length > 0 && (
          <Card>
            <SectionTitle>{t('Spinners')}</SectionTitle>
            <ul className="space-y-1 text-sm">
              {spinners.map((r, i) => (
                <li key={r.index} className="flex flex-wrap gap-x-6">
                  <span>{t('Spinner {n}', { n: i + 1 })}</span>
                  <Badge>{JUDGMENTS[r.judgment].label}</Badge>
                  <span className="text-ink-2">
                    {t('{turns} turns, {needed} needed, {average} rpm on average, {peak} at the peak', {
                      turns: formatNumber(r.spinner!.rotations, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                      needed: r.spinner!.rotationsRequired,
                      average: Math.round(r.spinner!.meanRpm),
                      peak: Math.round(r.spinner!.peakRpm),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
