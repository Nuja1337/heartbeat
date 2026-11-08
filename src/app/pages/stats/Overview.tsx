import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ratingHistory } from '../../../analytics/index';
import { drillText, OUTCOME_LABEL, ruleTitle } from '../../../analytics/insightCopy';
import { weekCompare } from '../../../analytics/sessions';
import { saveDrill } from '../../../data/drills';
import type { Drill, DrillEval } from '../../../data/schema';
import { RatingHistory } from '../../charts/RatingHistory';
import { InsightCard } from '../../components/InsightCard';
import { Radar } from '../../components/Radar';
import { Ratings } from '../../components/Ratings';
import { WeeklyChanges } from '../../components/WeeklyChanges';
import { Badge, Button, Card, Field, PageHeader, SectionTitle, Stat } from '../../components/ui';
import { EMPTY_STATS, INTRO, TIER_NOTE } from '../../copy';
import { SKILLS } from '../../../shared/catalog';
import type { SkillId } from '../../../shared/types';
import { dateOf, int, pct } from '../../format';
import { invalidateAnalysis, useAnalysis } from '../../state/analysis';
import { t } from '../../i18n';

const TONE = { collecting: 'neutral', better: 'good', unclear: 'neutral', worse: 'warn' } as const;

function DrillRow({ drill, ev, onStop }: { drill: Drill; ev: DrillEval; onStop?: () => void }) {
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{ruleTitle(drill.ruleId, drill.variant)}</span>
        <span className="flex items-center gap-2">
          <Badge tone={TONE[ev.outcome]}>{OUTCOME_LABEL[ev.outcome]}</Badge>
          {onStop && (
            <Button size="sm" variant="ghost" onClick={onStop}>
              {t('Stop tracking')}
            </Button>
          )}
        </span>
      </div>
      <p className="text-sm text-ink-2">
        {drillText({ ruleId: drill.ruleId, variant: drill.variant, createdAt: drill.createdAt, eval: ev })}
      </p>
      <p className="text-xs text-ink-3">
        {t('Started {date}. {n, plural, one {# drill session} other {# drill sessions}} so far.', {
          date: dateOf(drill.createdAt),
          n: ev.sessions,
        })}
      </p>
    </li>
  );
}

const HISTORY_DAYS = 90;

/** One skill's rating over the last 90 days, with a picker for the skill. */
function History({ summaries, now }: { summaries: Parameters<typeof ratingHistory>[0]; now: number }) {
  const [skill, setSkill] = useState<SkillId>('aim');
  const series = useMemo(() => ratingHistory(summaries, HISTORY_DAYS, now), [summaries, now]);
  const line = series.find((l) => l.skill === skill) ?? series[0]!;
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-4">
        <Field label={t('Skill')}>
          <select aria-label={t('Skill')} value={skill} onChange={(e) => setSkill(e.target.value as SkillId)}>
            {series.map((l) => (
              <option key={l.skill} value={l.skill}>
                {SKILLS[l.skill].label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <RatingHistory points={line.points} label={SKILLS[line.skill].label} />
    </Card>
  );
}

export function Overview() {
  const { data } = useAnalysis();
  if (!data) return <p className="text-ink-2">{t('Loading.')}</p>;
  const week = weekCompare(data.summaries, data.now);
  const active = data.drills.filter((d) => d.drill.status === 'active' && !d.drill.final);
  const finished = data.drills.filter((d) => d.drill.final || d.drill.status === 'archived');
  const stop = async (d: Drill, ev: DrillEval) => {
    await saveDrill({ ...d, status: 'archived', final: ev }).catch(() => undefined);
    invalidateAnalysis();
  };

  return (
    <>
      <PageHeader title={t('Stats')} intro={INTRO.overview} />
      {data.summaries.length === 0 ? (
        <Card>
          <p className="text-ink-2">{t(EMPTY_STATS)}</p>
        </Card>
      ) : (
        <div className="space-y-8">
          <section>
            <SectionTitle>{t('Ratings')}</SectionTitle>
            <div className="grid items-start gap-6 lg:grid-cols-5">
              <div className="lg:col-span-3">
                <Ratings ratings={data.ratings} />
              </div>
              <Card className="lg:col-span-2">
                <Radar axes={data.radar} max={data.radarMax} />
              </Card>
            </div>
            <p className="mt-2 text-sm text-ink-2">{t(TIER_NOTE)}</p>
          </section>

          <section>
            <SectionTitle aside={t('Last 90 days')}>{t('Rating history')}</SectionTitle>
            <History summaries={data.summaries} now={data.now} />
          </section>

          <WeeklyChanges changes={data.changes} />

          <section>
            <SectionTitle>{t('What to work on')}</SectionTitle>
            {data.insights.length === 0 ? (
              <Card>
                <p className="text-ink-2">
                  {t('No pattern stands out yet. Insights need 3 plays in the last 30 days and enough clicks to be sure of a pattern.')}
                </p>
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
              <SectionTitle>{t('Active drills')}</SectionTitle>
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
              <SectionTitle>{t('Finished drills')}</SectionTitle>
              <Card>
                <ul className="divide-y divide-line">
                  {[...finished]
                    .sort(
                      (a, b) =>
                        ['better', 'unclear', 'collecting', 'worse'].indexOf(a.eval.outcome) -
                        ['better', 'unclear', 'collecting', 'worse'].indexOf(b.eval.outcome),
                    )
                    .map((d) => (
                      <DrillRow key={d.drill.id} drill={d.drill} ev={d.eval} />
                    ))}
                </ul>
              </Card>
            </section>
          )}

          <section>
            <SectionTitle aside={t('Last 7 days against the 7 before')}>{t('This week')}</SectionTitle>
            <Card>
              <div className="flex flex-wrap gap-x-12 gap-y-4">
                <Stat label={t('Plays')} value={week.thisWeek.plays} sub={t('{n} last week', { n: week.lastWeek.plays })} />
                <Stat label={t('Minutes')} value={int(week.thisWeek.minutes)} sub={t('{n} last week', { n: int(week.lastWeek.minutes) })} />
                <Stat
                  label={t('Accuracy')}
                  value={week.thisWeek.accuracy === null ? t('none') : pct(week.thisWeek.accuracy)}
                  sub={week.lastWeek.accuracy === null ? t('no plays last week') : t('{n} last week', { n: pct(week.lastWeek.accuracy) })}
                />
              </div>
              <p className="mt-3 text-sm">
                <Link to="/stats/trends" className="text-accent hover:underline">
                  {t('See trends')}
                </Link>
              </p>
            </Card>
          </section>
        </div>
      )}
    </>
  );
}
