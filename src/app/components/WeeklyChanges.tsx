import { Link } from 'react-router';
import type { WeeklyChange } from '../../analytics/index';
import { Delta, Panel, SectionTitle } from './ui';

/** What moved in the last 7 days, as the sentences `weeklyChanges` writes. */
export function WeeklyChanges({ changes, link = false }: { changes: readonly WeeklyChange[]; link?: boolean }) {
  return (
    <Panel>
      <SectionTitle aside={link ? <Link to="/stats" className="text-accent hover:underline">All stats</Link> : 'Last 7 days against the 4 weeks before'}>
        What changed this week
      </SectionTitle>
      {changes.length === 0 ? (
        <p className="text-ink-2">Nothing has changed clearly yet. A change shows once you have 3 plays this week and 3 before it.</p>
      ) : (
        <ul className="divide-y divide-line">
          {changes.slice(0, 4).map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <span>{c.text}</span>
              <span className="mt-0.5 shrink-0">
                <Delta value={c.improved === null ? 'Changed' : c.improved ? 'Better' : 'Worse'} good={c.improved} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
