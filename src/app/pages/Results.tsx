import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { drillText, OUTCOME_LABEL } from '../../analytics/insightCopy';
import { playNotes } from '../../analytics/insights';
import { SKILLS } from '../../shared/catalog';
import { PlayReport } from '../components/PlayReport';
import { Badge, Button, Card, LinkButton, Notice, PageHeader, SectionTitle } from '../components/ui';
import { dateTime, modList, playTitle } from '../format';
import { useAnalysis } from '../state/analysis';
import { setupPath, startWithCurrentLevels } from '../state/launch';
import { getAppState } from '../state/store';
import { usePlay } from '../state/usePlay';

function statusNote(status: 'completed' | 'failed' | 'quit', mods: readonly string[]): string | null {
  if (status === 'quit') return 'You quit before the end.';
  if (status === 'failed') return mods.includes('onelife') ? 'Your first miss ended the play.' : 'You ran out of health before the map ended.';
  return null;
}

export function Results() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { play, missing, error } = usePlay(id);
  const { data } = useAnalysis();
  const [startError, setStartError] = useState<string | null>(null);

  const notes = useMemo(() => (play?.records ? playNotes(play.records, play.summary) : []), [play]);

  if (error) return <Notice tone="bad">{error}</Notice>;
  if (missing) {
    return (
      <Card>
        <p>This play isn't saved on this device.</p>
        <LinkButton to="/" className="mt-3">Home</LinkButton>
      </Card>
    );
  }
  if (!play) return <p className="text-ink-2">Loading.</p>;

  const { summary: s, records } = play;
  const fullscreen = getAppState().prefs.fullscreen;
  const back = setupPath(s.launch);
  const drill = s.drillId ? data?.drills.find((d) => d.drill.id === s.drillId) : undefined;
  const pbs = [
    s.pb.score && 'New best score',
    s.pb.accuracy && 'New best accuracy',
    s.pb.combo && 'New best combo',
    s.pb.level && 'New best level',
  ].filter((x): x is string => Boolean(x));

  // Both read the module levels from the store when clicked, so a play never starts from old levels.
  const start = (newSeed: boolean) =>
    startWithCurrentLevels(navigate, s.launch, back, fullscreen, newSeed).catch((e: unknown) =>
      setStartError(e instanceof Error ? e.message : 'Could not read your module levels.'),
    );
  const note = statusNote(s.status, s.mods);

  return (
    <>
      <PageHeader
        title={playTitle(s)}
        intro={`${dateTime(s.startedAt)}. ${modList(s.mods)}.`}
        actions={
          <>
            <Button variant="primary" onClick={() => void start(false)}>Retry</Button>
            <Button onClick={() => void start(true)}>New map</Button>
            <LinkButton to={back} variant="ghost">Back</LinkButton>
          </>
        }
      />

      {startError && (
        <div className="mb-4">
          <Notice tone="bad">{startError}</Notice>
        </div>
      )}

      {(note || pbs.length > 0 || s.tiers.length > 0) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {note && <Badge tone="warn" sentence>{note}</Badge>}
          {pbs.map((p) => (
            <Badge key={p} tone="good">{p}</Badge>
          ))}
          {s.tiers.map((t) => (
            <Badge key={t.skill} tone="accent">
              {SKILLS[t.skill].label} reached tier {t.tier}
            </Badge>
          ))}
        </div>
      )}

      {drill && (
        <div className="mb-4">
          <Notice tone={drill.eval.outcome === 'better' ? 'good' : drill.eval.outcome === 'worse' ? 'warn' : 'neutral'}>
            <span className="font-medium">{drill.drill.title}, {OUTCOME_LABEL[drill.eval.outcome].toLowerCase()}.</span>{' '}
            {drillText({ ruleId: drill.drill.ruleId, variant: drill.drill.variant, createdAt: drill.drill.createdAt, eval: drill.eval })}
          </Notice>
        </div>
      )}

      {notes.length > 0 && (
        <Card className="mb-6">
          <SectionTitle>Notes on this play</SectionTitle>
          <ul className="space-y-3">
            {notes.map((n) => (
              <li key={n.key}>
                <p>{n.text}</p>
                <p className="text-sm text-ink-2">{n.basis}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <PlayReport summary={s} records={records} />

      <div className="mt-6 flex flex-wrap gap-3 text-sm">
        <Link to={`/stats/play/${s.id}`} className="text-accent hover:underline">Full details for this play</Link>
        <Link to="/stats" className="text-accent hover:underline">Your stats</Link>
      </div>
    </>
  );
}
