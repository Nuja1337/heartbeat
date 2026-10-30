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
import { useAnalysis } from '../state/analysis';
import { useOnboarding } from '../state/onboarding';
import { useSettings } from '../state/store';

function PlayRow({ s }: { s: PlaySummary }) {
  const grade = gradeFor(s.accuracy, s.counts.miss, s.status);
  return (
    <li className="flex flex-1">
      <Link to={`/results/${s.id}`} className="flex flex-1 items-center gap-3 rounded-md py-2.5 transition hover:bg-surface-2 sm:-mx-2 sm:px-2">
        <span className="w-24 shrink-0">
          {grade ? <GradeBadge grade={grade} size="chip" /> : <Badge tone="warn">{s.status === 'failed' ? 'Failed' : 'Quit'}</Badge>}
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
        <div className="fw-skeleton h-72" />
        <div className="fw-skeleton h-72" />
        <div className="fw-skeleton h-72" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="fw-skeleton h-72" />
        <div className="fw-skeleton h-72" />
        <div className="fw-skeleton h-72" />
      </div>
      <span className="sr-only">Loading.</span>
    </div>
  );
}

export function Home() {
  const { data, error, reload } = useAnalysis();
  const [settings] = useSettings();
  const { state: onboarding } = useOnboarding();
  const top = data?.insights[0];

  return (
    <>
      <PageHeader
        title="Heartbeat"
        intro={INTRO.home}
        actions={
          <>
            <LinkButton to="/play" variant="primary">Play</LinkButton>
            <LinkButton to="/train">Train</LinkButton>
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
      ) : (
        <div className="space-y-6">
          {data.summaries.length === 0 && onboarding !== null && !onboarding.done && (
            <Panel marks className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-xl">Set up Heartbeat</h2>
                <p className="mt-1 text-ink-2">Choose your input, calibrate your timing and find your starting levels.</p>
              </div>
              <LinkButton to="/welcome" variant="primary">Set up Heartbeat</LinkButton>
              <p className="basis-full text-sm text-ink-2">
                Played Flickwise before? <Link to="/settings#settings-data" className="text-accent hover:underline">Import your export file in Settings.</Link>
              </p>
            </Panel>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            {data.plan ? <PlanCard plan={data.plan.plan} status={data.plan} /> : <Notice tone="warn">Today's plan could not be loaded.</Notice>}
            <DailyCard data={data} />
            <StreakCard streak={data.streak} week={data.week} goalMinutes={settings.goals.weeklyMinutes} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Panel className="flex flex-col">
              <SectionTitle aside={<Link to="/stats" className="text-accent hover:underline">Ratings</Link>}>Your skills</SectionTitle>
              <div className="flex flex-1 items-center">
                <Radar axes={data.radar} max={data.radarMax} />
              </div>
            </Panel>

            <div className="flex flex-col gap-6">
              {top ? (
                <InsightCard insight={top} />
              ) : (
                <Panel>
                  <SectionTitle>Top insight</SectionTitle>
                  <p className="text-ink-2">
                    {data.summaries.length > 0
                      ? 'Insights need at least 3 plays in the last 30 days and enough clicks to see a pattern. Keep playing and the first one will show up here.'
                      : 'Play a few maps and Heartbeat will point out where you lose accuracy and suggest a module for it.'}
                  </p>
                </Panel>
              )}
              <WeeklyChanges changes={data.changes} link className="flex-1" />
            </div>

            <Panel className="flex flex-col">
              <SectionTitle aside={<Link to="/stats/history" className="text-accent hover:underline">History</Link>}>Recent plays</SectionTitle>
              {data.summaries.length === 0 ? (
                <p className="text-ink-2">No plays yet.</p>
              ) : (
                <ul className="flex flex-1 flex-col divide-y divide-line">
                  {data.summaries.slice(0, 5).map((s) => (
                    <PlayRow key={s.id} s={s} />
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
