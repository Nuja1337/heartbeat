// The play streak and the weekly goal ring.

import { Link } from 'react-router';
import type { StreakInfo, WeeklyGoal } from '../../analytics/index';
import { count, t } from '../i18n';
import { Count } from './Count';
import { Panel, SectionTitle } from './ui';

const R = 40;
const CIRC = 2 * Math.PI * R;

export function GoalRing({ minutes, goalMinutes }: { minutes: number; goalMinutes: number }) {
  const fraction = goalMinutes > 0 ? Math.min(1, minutes / goalMinutes) : 0;
  return (
    <div
      className="relative size-28 shrink-0"
      role="img"
      aria-label={
        goalMinutes > 0
          ? t('{minutes} of {goal} minutes this week', { minutes: Math.floor(minutes), goal: goalMinutes })
          : t('{minutes} minutes this week, no goal set', { minutes: Math.floor(minutes) })
      }
    >
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx={50} cy={50} r={R} fill="none" stroke="var(--color-line)" strokeWidth={8} />
        {goalMinutes > 0 && (
          <circle
            cx={50}
            cy={50}
            r={R}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - fraction)}
            style={{ transition: 'stroke-dashoffset var(--dur-count) var(--ease-out)' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center leading-tight">
        <span className="font-display text-2xl tabular-nums">
          <Count value={Math.floor(minutes)} format={(v) => String(Math.round(v))} />
        </span>
        <span className="text-xs text-ink-3">{goalMinutes > 0 ? t('of {goal} min', { goal: goalMinutes }) : t('min')}</span>
      </div>
    </div>
  );
}

export function StreakCard({ streak, week, goalMinutes }: { streak: StreakInfo; week: WeeklyGoal; goalMinutes: number }) {
  const reached = goalMinutes > 0 && week.minutes >= goalMinutes;
  return (
    <Panel marks className="flex h-full flex-col">
      <SectionTitle aside={t('{n, plural, one {# day} other {# days}} left', { n: week.daysLeft })}>{t('This week')}</SectionTitle>
      <div className="flex flex-1 items-center gap-5">
        <GoalRing minutes={week.minutes} goalMinutes={goalMinutes} />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-3xl tabular-nums">{streak.current}</span>
            <span className="text-ink-2">{t('{n, plural, one {day in a row} other {days in a row}}', { n: streak.current })}</span>
          </div>
          <p className="mt-1 text-sm text-ink-2">
            {streak.current === 0
              ? t('Play for a minute to start a streak.')
              : streak.atRisk
                ? t('Play today to keep it going.')
                : t('Your longest streak is {days}.', { days: count(streak.longest, 'day') })}
          </p>
          <p className="mt-2 text-sm text-ink-2">
            {goalMinutes === 0 ? (
              <Link to="/settings" className="text-accent hover:underline">
                {t('Set a weekly goal')}
              </Link>
            ) : reached ? (
              t('You reached your weekly goal.')
            ) : (
              t('{n} min to your weekly goal.', { n: Math.ceil(goalMinutes - week.minutes) })
            )}
          </p>
        </div>
      </div>
    </Panel>
  );
}
