import { Link } from 'react-router';
import { gradeFor } from '../../shared/catalog';
import type { PlaySummary } from '../../data/schema';
import { AnalysisError } from '../components/AnalysisError';
import { DailyCard } from '../components/DailyCard';
import { InsightCard } from '../components/InsightCard';
import { PlanCard } from '../components/PlanCard';
import { Radar } from '../components/Radar';
import { StreakCard } from '../components/StreakCard';
import { WeeklyChanges } from '../components/WeeklyChanges';
import { Badge, GradeBadge, LinkButton, Notice, PageHeader, Panel, SectionTitle } from '../components/ui';
import { INTRO } from '../copy';
import { ago, pct, playTitle } from '../format';
import { t } from '../i18n';
import { useAnalysis } from '../state/analysis';
import { useOnboarding } from '../state/onboarding';
import { useSettings } from '../state/store';

function PlayRow({ s }: { s: PlaySummary }) {
  const grade = gradeFor(s.accuracy, s.counts.miss, s.status);
  return (
    <li className="flex flex-1">
      <Link
        to={`/results/${s.id}`}
        className="flex flex-1 items-center gap-3 rounded-md py-2.5 transition hover:bg-surface-2 sm:-mx-2 sm:px-2"
      >
        <span className="w-24 shrink-0">
          {grade ? <GradeBadge grade={grade} size="chip" /> : <Badge tone="warn">{s.status === 'failed' ? t('Failed') : t('Quit')}</Badge>}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{playTitle(s)}</span>
          <span className="block text-sm text-ink-3">{ago(s.endedAt)}</span>
        </span>
        <span className="shrink-0 font-display tabular-nums">{pct(s.accuracy)}</span>
      </Link>
    </li>
  );
}

function Loading() {
  return (
    <div role="status" aria-busy="true" className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="hb-skeleton h-72" />
        <div className="hb-skeleton h-72" />
        <div className="hb-skeleton h-72" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="hb-skeleton h-72" />
        <div className="hb-skeleton h-72" />
        <div className="hb-skeleton h-72" />
      </div>
      <span className="sr-only">{t('Loading.')}</span>
    </div>
  );
}

/** Shown until the first play is saved. It says what Heartbeat is and where to begin. */
function Welcome({ setupDone }: { setupDone: boolean }) {
  return (
    <Panel marks>
      <span className="hb-kicker">{t('Welcome')}</span>
      <h2 className="mt-3 max-w-2xl text-xl">
        {t('Heartbeat is an aim trainer. You click targets in time with a beat, and every click is saved with where it landed and when.')}
      </h2>
      <p className="mt-2 max-w-2xl text-ink-2">
        {t(
          'The stats turn those clicks into skill ratings, insights about where you lose accuracy and drills to work on them. There is no account, and nothing leaves this browser.',
        )}
      </p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-3">
        <li>
          <h3 className="text-lg">{t('Play')}</h3>
          <p className="mt-1 text-sm text-ink-2">
            {t('Play generated maps at eight levels, or set every part of the difficulty yourself.')}
          </p>
        </li>
        <li>
          <h3 className="text-lg">{t('Train')}</h3>
          <p className="mt-1 text-sm text-ink-2">
            {t('Short modules train jumps, streams, tracking and more, and each one adjusts its level to you.')}
          </p>
        </li>
        <li>
          <h3 className="text-lg">{t('Review')}</h3>
          <p className="mt-1 text-sm text-ink-2">{t('Watch replays, read the insights and see which drills changed your numbers.')}</p>
        </li>
      </ul>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {setupDone ? (
          <LinkButton to="/play" variant="primary">
            {t('Play a map')}
          </LinkButton>
        ) : (
          <>
            <LinkButton to="/welcome" variant="primary">
              {t('Start setup')}
            </LinkButton>
            <LinkButton to="/play">{t('Play a map')}</LinkButton>
          </>
        )}
        <LinkButton to="/guide" variant="ghost">
          {t('Read the guide')}
        </LinkButton>
      </div>
      {!setupDone && (
        <p className="mt-3 text-sm text-ink-3">
          {t(
            "Setup takes a few minutes. You choose your input, it measures your display's delay, and a short test finds your starting levels.",
          )}
        </p>
      )}
    </Panel>
  );
}

export function Home() {
  const { data, error, reload } = useAnalysis();
  const [settings] = useSettings();
  const { state: onboarding } = useOnboarding();
  const top = data?.insights[0];
  const firstRun = data !== null && data !== undefined && data.summaries.length === 0;

  return (
    <>
      <PageHeader
        title="Heartbeat"
        intro={firstRun ? undefined : INTRO.home}
        actions={
          <>
            <LinkButton to="/play" variant="primary">
              {t('Play')}
            </LinkButton>
            <LinkButton to="/train">{t('Train')}</LinkButton>
          </>
        }
      />

      {error && (
        <div className="mb-6">
          <AnalysisError message={error} onRetry={reload} />
        </div>
      )}

      {!data ? (
        !error && <Loading />
      ) : firstRun ? (
        <div className="space-y-6">
          {/* The setup state is read from the database. Until it is in, the panel would show the wrong button. */}
          {onboarding !== null && <Welcome setupDone={onboarding.done} />}
          <div className="grid gap-6 lg:grid-cols-2">
            {data.plan ? (
              <PlanCard plan={data.plan.plan} status={data.plan} />
            ) : (
              <Notice tone="warn">{t("Today's plan could not be loaded.")}</Notice>
            )}
            <DailyCard data={data} />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            {data.plan ? (
              <PlanCard plan={data.plan.plan} status={data.plan} />
            ) : (
              <Notice tone="warn">{t("Today's plan could not be loaded.")}</Notice>
            )}
            <DailyCard data={data} />
            <StreakCard streak={data.streak} week={data.week} goalMinutes={settings.goals.weeklyMinutes} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Panel className="flex flex-col">
              <SectionTitle
                aside={
                  <Link to="/stats" className="text-accent hover:underline">
                    {t('Ratings')}
                  </Link>
                }
              >
                {t('Your skills')}
              </SectionTitle>
              <div className="flex flex-1 items-center">
                <Radar axes={data.radar} max={data.radarMax} />
              </div>
            </Panel>

            <div className="flex flex-col gap-6">
              {top ? (
                <InsightCard insight={top} />
              ) : (
                <Panel>
                  <SectionTitle>{t('Top insight')}</SectionTitle>
                  <p className="text-ink-2">
                    {t(
                      'Insights need at least 3 plays in the last 30 days and enough clicks to see a pattern. Keep playing and the first one will show up here.',
                    )}
                  </p>
                </Panel>
              )}
              <WeeklyChanges changes={data.changes} link className="flex-1" />
            </div>

            <Panel className="flex flex-col">
              <SectionTitle
                aside={
                  <Link to="/stats/history" className="text-accent hover:underline">
                    {t('History')}
                  </Link>
                }
              >
                {t('Recent plays')}
              </SectionTitle>
              <ul className="flex flex-1 flex-col divide-y divide-line">
                {data.summaries.slice(0, 5).map((s) => (
                  <PlayRow key={s.id} s={s} />
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
