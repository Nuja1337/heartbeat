import { Link } from 'react-router';
import { OUTCOME_LABEL, drillText } from '../../../analytics/insightCopy';
import { weekCompare } from '../../../analytics/sessions';
import { saveDrill } from '../../../data/drills';
import type { Drill, DrillEval } from '../../../data/schema';
import { InsightCard } from '../../components/InsightCard';
import { Ratings } from '../../components/Ratings';
import { Badge, Button, Card, PageHeader, SectionTitle, Stat } from '../../components/ui';
import { EMPTY_STATS, INTRO, TIER_NOTE } from '../../copy';
import { dateOf, int, pct } from '../../format';
import { invalidateAnalysis, useAnalysis } from '../../state/analysis';

const TONE = { collecting: 'neutral', better: 'good', unclear: 'neutral', worse: 'warn' } as const;

function DrillRow({ drill, ev, onStop }: { drill: Drill; ev: DrillEval; onStop?: () => void }) {
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{drill.title}</span>
        <span className="flex items-center gap-2">
          <Badge tone={TONE[ev.outcome]}>{OUTCOME_LABEL[ev.outcome]}</Badge>
          {onStop && (
            <Button size="sm" variant="ghost" onClick={onStop}>
              Stop tracking
            </Button>
          )}
        </span>
      </div>
      <p className="text-sm text-ink-2">{drillText({ ruleId: drill.ruleId, variant: drill.variant, createdAt: drill.createdAt, eval: ev })}</p>
      <p className="text-xs text-ink-3">Started {dateOf(drill.createdAt)}. {ev.sessions} drill {ev.sessions === 1 ? 'session' : 'sessions'} so far.</p>
    </li>
  );
}

export function Overview() {
  const { data } = useAnalysis();
  if (!data) return <p className="text-ink-2">Loading.</p>;
  const week = weekCompare(data.summaries, data.now);
  const active = data.drills.filter((d) => d.drill.status === 'active' && !d.drill.final);
  const finished = data.drills.filter((d) => d.drill.final || d.drill.status === 'archived');
  const stop = async (d: Drill, ev: DrillEval) => {
    await saveDrill({ ...d, status: 'archived', final: ev }).catch(() => undefined);
    invalidateAnalysis();
  };

  return (
    <>
      <PageHeader title="Stats" intro={INTRO.overview} />
      {data.summaries.length === 0 ? (
        <Card>
          <p className="text-ink-2">{EMPTY_STATS}</p>
        </Card>
      ) : (
        <div className="space-y-8">
          <section>
            <SectionTitle>Ratings</SectionTitle>
            <Ratings ratings={data.ratings} />
            <p className="mt-2 text-sm text-ink-2">{TIER_NOTE}</p>
          </section>

          <section>
            <SectionTitle>What to work on</SectionTitle>
            {data.insights.length === 0 ? (
              <Card>
                <p className="text-ink-2">No pattern stands out yet. Insights need 3 plays in the last 30 days and enough clicks to be sure of a pattern.</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {data.insights.slice(0, 3).map((i) => (
                  <InsightCard key={i.key} insight={i} compact />
                ))}
              </div>
            )}
          </section>

          {active.length > 0 && (
            <section>
              <SectionTitle>Active drills</SectionTitle>
              <Card>
                <ul className="divide-y divide-line">
                  {active.map((d) => (
                    <DrillRow key={d.drill.id} drill={d.drill} ev={d.eval} onStop={() => void stop(d.drill, d.eval)} />
                  ))}
                </ul>
              </Card>
            </section>
          )}

          {finished.length > 0 && (
            <section>
              <SectionTitle>Finished drills</SectionTitle>
              <Card>
                <ul className="divide-y divide-line">
                  {[...finished]
                    .sort((a, b) => ['better', 'unclear', 'collecting', 'worse'].indexOf(a.eval.outcome) - ['better', 'unclear', 'collecting', 'worse'].indexOf(b.eval.outcome))
                    .map((d) => (
                      <DrillRow key={d.drill.id} drill={d.drill} ev={d.eval} />
                    ))}
                </ul>
              </Card>
            </section>
          )}

          <section>
            <SectionTitle aside="Last 7 days against the 7 before">This week</SectionTitle>
            <Card>
              <div className="flex flex-wrap gap-x-12 gap-y-4">
                <Stat label="Plays" value={week.thisWeek.plays} sub={`${week.lastWeek.plays} last week`} />
                <Stat label="Minutes" value={int(week.thisWeek.minutes)} sub={`${int(week.lastWeek.minutes)} last week`} />
                <Stat
                  label="Accuracy"
                  value={week.thisWeek.accuracy === null ? 'none' : pct(week.thisWeek.accuracy)}
                  sub={week.lastWeek.accuracy === null ? 'no plays last week' : `${pct(week.lastWeek.accuracy)} last week`}
                />
              </div>
              <p className="mt-3 text-sm">
                <Link to="/stats/trends" className="text-accent hover:underline">See trends</Link>
              </p>
            </Card>
          </section>
        </div>
      )}
    </>
  );
}
