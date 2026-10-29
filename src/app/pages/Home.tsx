import { Link } from 'react-router';
import { AnalysisError } from '../components/AnalysisError';
import { InsightCard } from '../components/InsightCard';
import { Ratings } from '../components/Ratings';
import { Card, LinkButton, PageHeader, SectionTitle, Stat } from '../components/ui';
import { INTRO } from '../copy';
import { ago, int, pct, playTitle } from '../format';
import { useAnalysis } from '../state/analysis';

export function Home() {
  const { data, error, reload } = useAnalysis();
  const last = data?.summaries[0];
  const top = data?.insights[0];

  return (
    <>
      <PageHeader title="Flickwise" intro={INTRO.home} />
      <div className="mb-8 flex flex-wrap gap-3">
        <LinkButton to="/play" variant="primary" size="lg">
          Play
        </LinkButton>
        <LinkButton to="/train" size="lg">
          Train
        </LinkButton>
      </div>

      {error && <AnalysisError message={error} onRetry={reload} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <section>
            <SectionTitle>Top insight</SectionTitle>
            {top ? (
              <InsightCard insight={top} />
            ) : (
              <Card>
                <p className="text-ink-2">
                  {data && data.summaries.length > 0
                    ? 'Insights need at least 3 plays in the last 30 days and enough clicks to see a pattern. Keep playing and the first one will show up here.'
                    : 'Play a few maps and Flickwise will point out where you lose accuracy and suggest a module for it.'}
                </p>
              </Card>
            )}
          </section>

          <section>
            <SectionTitle>Last play</SectionTitle>
            {last ? (
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="font-medium">{playTitle(last)}</div>
                    <div className="text-sm text-ink-2">{ago(last.endedAt)}</div>
                  </div>
                  <div className="flex gap-8">
                    {last.modeId === 'dynamic' && <Stat label="Score" value={int(last.score)} />}
                    <Stat label="Accuracy" value={pct(last.accuracy)} />
                    <Stat label="Combo" value={int(last.maxCombo)} />
                  </div>
                </div>
                <div className="mt-3">
                  <Link to={`/results/${last.id}`} className="text-sm text-accent hover:underline">
                    See the results
                  </Link>
                </div>
              </Card>
            ) : (
              <Card>
                <p className="text-ink-2">No plays yet.</p>
              </Card>
            )}
          </section>
        </div>

        <section>
          <SectionTitle aside={<Link to="/stats" className="text-accent hover:underline">All stats</Link>}>Ratings</SectionTitle>
          {data ? <Ratings ratings={data.ratings} compact /> : <p className="text-ink-2">Loading.</p>}
        </section>
      </div>
    </>
  );
}
