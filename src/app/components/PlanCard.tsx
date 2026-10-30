// Today's plan: the steps with a check on each finished one, and one button for the next step.

import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { DailyPlan } from '../../data/schema';
import { duration } from '../format';
import { planButtonLabel } from '../state/plan';
import type { PlanStatus } from '../state/plan';
import { startWithCurrentLevels } from '../state/launch';
import { getAppState } from '../state/store';
import { IconCheck } from './icons';
import { Button, Notice, Panel, SectionTitle } from './ui';

export function PlanCard({ plan, status }: { plan: DailyPlan; status: PlanStatus }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const label = planButtonLabel(status);
  const start = () => {
    if (!status.next) return;
    startWithCurrentLevels(navigate, status.next.launch, '/', getAppState().prefs.fullscreen, false).catch((e: unknown) =>
      setError(e instanceof Error ? e.message : 'Could not read your module levels.'),
    );
  };

  return (
    <Panel marks className="flex h-full flex-col">
      <SectionTitle aside={`${status.doneCount} of ${plan.steps.length} done`}>Today</SectionTitle>
      <ol className="flex-1 divide-y divide-line">
        {plan.steps.map((s, i) => {
          const done = status.done[i] === true;
          const current = status.next?.step === s.step;
          return (
            <li key={s.step} className="flex items-center gap-3 py-2.5">
              <span
                aria-hidden
                className={`grid size-5 shrink-0 place-items-center overflow-hidden rounded-full border ${done ? 'border-accent bg-accent text-accent-ink' : current ? 'border-accent' : 'border-line-2'}`}
              >
                {done && <IconCheck size={16} />}
              </span>
              <span className={`min-w-0 flex-1 truncate ${done ? 'text-ink-2' : 'text-ink'}`}>
                {s.title}
                <span className="sr-only">{done ? ', done' : current ? ', next' : ''}</span>
              </span>
              <span className="shrink-0 text-sm tabular-nums text-ink-3">{duration(s.launch.lengthSec * 1000)}</span>
            </li>
          );
        })}
      </ol>
      {label ? (
        <Button variant="primary" className="mt-4 w-full" onClick={start}>
          {label}
        </Button>
      ) : (
        <p className="mt-4 text-sm text-ink-2">Today's plan is done. Come back tomorrow for a new one.</p>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
    </Panel>
  );
}
