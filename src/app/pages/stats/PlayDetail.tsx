import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { fatigueCurve } from '../../../analytics/index';
import { JUDGMENTS } from '../../../shared/catalog';
import { Bars } from '../../charts/Bars';
import { Fatigue } from '../../charts/Fatigue';
import { Timeline } from '../../charts/Timeline';
import { PlayReport } from '../../components/PlayReport';
import { SectionStrip } from '../../components/SectionStrip';
import { Badge, Button, Card, LinkButton, Notice, PageHeader, SectionTitle } from '../../components/ui';
import { dateTime, modList, pct, playTitle } from '../../format';
import { OLD_GENERATOR_NOTE, isOlderGenerator, useGeneratorVersion } from '../../state/generator';
import { setupPath, startWithCurrentLevels } from '../../state/launch';
import { replayLink } from '../../state/replayMarkers';
import { getAppState } from '../../state/store';
import { usePlay } from '../../state/usePlay';

export function PlayDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { play, missing, error } = usePlay(id);
  const [startError, setStartError] = useState<string | null>(null);
  const generator = useGeneratorVersion();
  const fatigue = useMemo(() => (play?.records ? fatigueCurve(play.records) : []), [play]);

  if (error) return <Notice tone="bad">{error}</Notice>;
  if (missing) {
    return (
      <Card>
        <p>This play isn't saved on this device. It may have been deleted.</p>
        <LinkButton to="/stats/history" className="mt-3">History</LinkButton>
      </Card>
    );
  }
  if (!play) return <p className="text-ink-2">Loading.</p>;
  const { summary: s, records } = play;
  const sliders = (records ?? []).filter((r) => r.slider);
  const spinners = (records ?? []).filter((r) => r.spinner);
  const older = isOlderGenerator(s.generatorVersion, generator);
  const misses = (records ?? []).filter((r) => r.judgment === 'miss');
  const replay = () =>
    startWithCurrentLevels(navigate, s.launch, setupPath(s.launch), getAppState().prefs.fullscreen, false).catch((e: unknown) =>
      setStartError(e instanceof Error ? e.message : 'Could not read your module levels.'),
    );

  return (
    <>
      <PageHeader
        title={playTitle(s)}
        intro={`${dateTime(s.startedAt)}. ${modList(s.mods)}. Seed ${s.seed}.`}
        actions={
          <>
            <Button variant="primary" onClick={replay}>{older ? 'Play with these settings' : 'Play this map again'}</Button>
            {s.hasReplay && <LinkButton to={`/replay/${s.id}`}>Watch replay</LinkButton>}
            <LinkButton to="/stats/history" variant="ghost">History</LinkButton>
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
          <Notice tone="warn">{OLD_GENERATOR_NOTE}</Notice>
        </div>
      )}
      {!records && (
        <div className="mb-4">
          <Notice>The per-object detail for this play was removed by the retention setting. The summary numbers below are still here.</Notice>
        </div>
      )}
      <div className="space-y-6">
        <PlayReport
          summary={s}
          records={records}
          extra={
            s.sections && s.sections.length > 0 ? (
              <Card>
                <SectionTitle aside="Accuracy in each part of the map">Sections</SectionTitle>
                <SectionStrip sections={s.sections} />
              </Card>
            ) : null
          }
        />

        {records && (
          <Card>
            <SectionTitle>Timing through the play</SectionTitle>
            <Timeline records={records} onOpen={s.hasReplay ? (t) => navigate(replayLink(s.id, t)) : undefined} />
          </Card>
        )}

        {records && (
          <Card>
            <SectionTitle>Accuracy through the play</SectionTitle>
            <Fatigue points={fatigue} />
          </Card>
        )}

        {s.hasReplay && misses.length > 0 && (
          <Card>
            <SectionTitle aside="Each link opens the replay 1.5 seconds before the miss">Misses in the replay</SectionTitle>
            <ul className="flex flex-wrap gap-2">
              {misses.slice(0, 40).map((r) => (
                <li key={r.index}>
                  <Link to={replayLink(s.id, r.time)} className="inline-flex h-7 items-center rounded-full border border-line-2 bg-surface-2 px-3 text-sm text-ink-2 transition hover:border-accent hover:text-ink">
                    Object {r.index + 1}
                  </Link>
                </li>
              ))}
            </ul>
            {misses.length > 40 && <p className="mt-2 text-sm text-ink-2">The first 40 of {misses.length} misses.</p>}
          </Card>
        )}

        <Card>
          <SectionTitle>Accuracy by quarter</SectionTitle>
          {s.quarters.every((q) => q === null) ? (
            <p className="text-ink-2">The play was too short to split into quarters.</p>
          ) : (
            <Bars
              label="Accuracy in each quarter of the play"
              max={1}
              items={s.quarters.map((q, i) => ({ label: `Quarter ${i + 1}`, value: q ?? 0, text: q === null ? 'none' : pct(q, 0), color: JUDGMENTS.solid.color }))}
            />
          )}
        </Card>

        {sliders.length > 0 && (
          <Card>
            <SectionTitle aside="Share of each slider you stayed on">Sliders</SectionTitle>
            <Bars
              label="Tracked share of each slider"
              max={1}
              items={sliders.slice(0, 40).map((r, i) => ({
                label: `Slider ${i + 1}`,
                value: r.slider!.trackedFraction,
                text: pct(r.slider!.trackedFraction, 0),
                color: JUDGMENTS[r.judgment].color,
              }))}
            />
            {sliders.length > 40 && <p className="mt-2 text-sm text-ink-2">The first 40 of {sliders.length} sliders.</p>}
          </Card>
        )}

        {spinners.length > 0 && (
          <Card>
            <SectionTitle>Spinners</SectionTitle>
            <ul className="space-y-1 text-sm">
              {spinners.map((r, i) => (
                <li key={r.index} className="flex flex-wrap gap-x-6">
                  <span>Spinner {i + 1}</span>
                  <Badge>{JUDGMENTS[r.judgment].label}</Badge>
                  <span className="text-ink-2">
                    {r.spinner!.rotations.toFixed(1)} turns, {r.spinner!.rotationsRequired} needed, {Math.round(r.spinner!.meanRpm)} rpm on average, {Math.round(r.spinner!.peakRpm)} at the peak
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
