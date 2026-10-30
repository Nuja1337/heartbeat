// The play streak and the weekly goal ring.

import { Link } from 'react-router';
import type { StreakInfo, WeeklyGoal } from '../../analytics/index';
import { count } from '../format';
import { Count } from './Count';
import { Panel, SectionTitle } from './ui';

const R = 40;
const CIRC = 2 * Math.PI * R;

export function GoalRing({ minutes, goalMinutes }: { minutes: number; goalMinutes: number }) {
  const fraction = goalMinutes > 0 ? Math.min(1, minutes / goalMinutes) : 0;
  return (
    <div className="relative size-28 shrink-0" role="img" aria-label={goalMinutes > 0 ? `${Math.floor(minutes)} of ${goalMinutes} minutes this week` : `${Math.floor(minutes)} minutes this week, no goal set`}>
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
        <span className="text-xs text-ink-3">{goalMinutes > 0 ? `of ${goalMinutes} min` : 'min'}</span>
      </div>
    </div>
  );
}

export function StreakCard({ streak, week, goalMinutes }: { streak: StreakInfo; week: WeeklyGoal; goalMinutes: number }) {
  const reached = goalMinutes > 0 && week.minutes >= goalMinutes;
  return (
    <Panel marks className="flex h-full flex-col">
      <SectionTitle aside={`${week.daysLeft} ${week.daysLeft === 1 ? 'day' : 'days'} left`}>This week</SectionTitle>
      <div className="flex flex-1 items-center gap-5">
        <GoalRing minutes={week.minutes} goalMinutes={goalMinutes} />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-3xl tabular-nums">{streak.current}</span>
            <span className="text-ink-2">{streak.current === 1 ? 'day in a row' : 'days in a row'}</span>
          </div>
          <p className="mt-1 text-sm text-ink-2">
            {streak.current === 0
              ? 'Play for a minute to start a streak.'
              : streak.atRisk
                ? 'Play today to keep it going.'
                : `Your longest streak is ${count(streak.longest, 'day')}.`}
          </p>
          <p className="mt-2 text-sm text-ink-2">
            {goalMinutes === 0 ? (
              <Link to="/settings" className="text-accent hover:underline">Set a weekly goal</Link>
            ) : reached ? (
              'You reached your weekly goal.'
            ) : (
              `${Math.ceil(goalMinutes - week.minutes)} min to your weekly goal.`
            )}
          </p>
        </div>
      </div>
    </Panel>
  );
}
