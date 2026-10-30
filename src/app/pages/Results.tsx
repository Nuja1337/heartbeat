import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { distinct, drillText, fatigueCurve, OUTCOME_LABEL, playNotes, playVsAverage } from '../../analytics/index';
import type { PlayDelta } from '../../analytics/index';
import type { ContrastUnit } from '../../analytics/contrast';
import { DEFAULT_MODULE_LEVEL, MILESTONES, MODES, PLACEMENT, SKILLS, gradeFor } from '../../shared/catalog';
import { Fatigue } from '../charts/Fatigue';
import { PlayReport } from '../components/PlayReport';
import { SectionStrip } from '../components/SectionStrip';
import { ShareButton, canShare } from '../components/ShareButton';
import { Badge, Button, Delta, GradeBadge, LinkButton, Notice, Panel, SectionTitle, Stat } from '../components/ui';
import { dateTime, int, level, modList, pct, playTitle, widthPct } from '../format';
import { useAnalysis } from '../state/analysis';
import { OLD_GENERATOR_NOTE, isOlderGenerator, useGeneratorVersion } from '../state/generator';
import { setupPath, startWithCurrentLevels } from '../state/launch';
import { finished, patchOnboarding } from '../state/onboarding';
import { getAppState } from '../state/store';
import { usePlay } from '../state/usePlay';

function statusNote(status: 'completed' | 'failed' | 'quit', mods: readonly string[]): string | null {
  if (status === 'quit') return 'You quit before the end.';
  if (status === 'failed') return mods.includes('onelife') ? 'Your first miss ended the play.' : 'You ran out of health before the map ended.';
  return null;
}

/** A key hint on a button. Phones have no keyboard, so it is hidden there. */
function Key({ children }: { children: ReactNode }) {
  return (
    <kbd aria-hidden className="hidden rounded-sm border border-current px-1 font-sans text-[11px] leading-4 opacity-60 sm:inline">
      {children}
    </kbd>
  );
}

const SIGN = (v: number): string => (v > 0 ? '+' : v < 0 ? '-' : '');

interface DeltaView {
  value: string;
  average: string;
  change: string;
  unit: ContrastUnit | null;
}

/** How each delta is shown. Score has no unit for the `distinct` gate, so it needs a 3% gap instead. */
function deltaView(d: PlayDelta): DeltaView {
  switch (d.id) {
    case 'accuracy':
      return { value: pct(d.value), average: pct(d.average), change: `${SIGN(d.diff)}${Math.abs(d.diff * 100).toFixed(1)} points`, unit: 'share' };
    case 'timingSd':
      return { value: `${Math.round(d.value)} ms`, average: `${Math.round(d.average)} ms`, change: `${SIGN(d.diff)}${Math.abs(Math.round(d.diff))} ms`, unit: 'ms' };
    case 'radial':
      return { value: widthPct(d.value), average: widthPct(d.average), change: `${SIGN(d.diff)}${Math.abs(Math.round(d.diff * 50))}%`, unit: 'width' };
    case 'score':
      return { value: int(d.value), average: int(d.average), change: `${SIGN(d.diff)}${int(Math.abs(d.diff))}`, unit: null };
  }
}

const shown = (d: PlayDelta, v: DeltaView): boolean =>
  v.unit ? distinct(d.average, d.value, v.unit) : d.average > 0 && Math.abs(d.diff) / d.average >= 0.03;

export function Results() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { play, missing, error } = usePlay(id);
  const { data } = useAnalysis();
  const generator = useGeneratorVersion();
  const [startError, setStartError] = useState<string | null>(null);

  const notes = useMemo(() => (play?.records ? playNotes(play.records, play.summary) : []), [play]);
  const fatigue = useMemo(() => (play?.records ? fatigueCurve(play.records) : []), [play]);
  const average = useMemo(() => (play && data ? playVsAverage(play.summary, data.summaries) : null), [play, data]);

  const s = play?.summary;
  const start = (newSeed: boolean) => {
    if (!s) return;
    // Both read the module levels from the store when clicked, so a play never starts from old levels.
    startWithCurrentLevels(navigate, s.launch, setupPath(s.launch), getAppState().prefs.fullscreen, newSeed).catch((e: unknown) =>
      setStartError(e instanceof Error ? e.message : 'Could not read your module levels.'),
    );
  };

  // A finished placement play ends first-run setup, whether it was started from setup or from Train.
  const placedId = s && s.modeId === 'placement' && s.status === 'completed' ? s.id : null;
  useEffect(() => {
    if (placedId) patchOnboarding((o) => finished({ ...o, placed: true }, Date.now())).catch(() => undefined);
  }, [placedId]);

  // The key handler reads the latest closures through a ref, so it is attached once.
  const keys = useRef<{ retry(): void; fresh(): void; watch(): void; leave(): void }>(null);
  keys.current = {
    retry: () => start(false),
    fresh: () => start(true),
    watch: () => s?.hasReplay && navigate(`/replay/${s.id}`),
    leave: () => s && navigate(setupPath(s.launch)),
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const tag = e.target instanceof HTMLElement ? e.target.tagName : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = keys.current;
      if (!k) return;
      if (e.key === 'r' || e.key === 'R') k.retry();
      else if (e.key === 'n' || e.key === 'N') k.fresh();
      else if (e.key === 'w' || e.key === 'W') k.watch();
      else if (e.key === 'Escape') k.leave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (error) return <Notice tone="bad">{error}</Notice>;
  if (missing) {
    return (
      <Panel>
        <p>This play isn't saved on this device.</p>
        <LinkButton to="/" className="mt-3">Home</LinkButton>
      </Panel>
    );
  }
  if (!play || !s) return <p className="text-ink-2">Loading.</p>;

  const { records } = play;
  const back = setupPath(s.launch);
  const grade = gradeFor(s.accuracy, s.counts.miss, s.status);
  const drill = s.drillId ? data?.drills.find((d) => d.drill.id === s.drillId) : undefined;
  const pbs = [
    s.pb.score && 'New best score',
    s.pb.accuracy && 'New best accuracy',
    s.pb.combo && 'New best combo',
    s.pb.level && 'New best level',
  ].filter((x): x is string => Boolean(x));
  const note = statusNote(s.status, s.mods);
  const older = isOlderGenerator(s.generatorVersion, generator);
  const rows = average ? average.deltas.map((d) => ({ d, v: deltaView(d) })).filter(({ d, v }) => shown(d, v)) : [];

  return (
    <>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
          {grade ? <GradeBadge grade={grade} size="lg" /> : <Badge tone="warn">{s.status === 'failed' ? 'Failed' : 'Quit'}</Badge>}
          <div className="min-w-0">
            <h1 className="text-2xl">{playTitle(s)}</h1>
            <p className="mt-1 text-ink-2">
              {dateTime(s.startedAt)}. {modList(s.mods)}.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => start(false)} aria-keyshortcuts="R">
            Retry <Key>R</Key>
          </Button>
          <Button onClick={() => start(true)} aria-keyshortcuts="N">
            New map <Key>N</Key>
          </Button>
          {s.hasReplay && (
            <LinkButton to={`/replay/${s.id}`} aria-keyshortcuts="W">
              Watch replay <Key>W</Key>
            </LinkButton>
          )}
          {canShare(s.modeId) && <ShareButton launch={s.launch} />}
          <LinkButton to={back} variant="ghost" aria-keyshortcuts="Escape">
            Back <Key>Esc</Key>
          </LinkButton>
        </div>
      </header>

      {startError && (
        <div className="mb-4">
          <Notice tone="bad">{startError}</Notice>
        </div>
      )}

      {older && (
        <div className="mb-4">
          <Notice tone="warn">{OLD_GENERATOR_NOTE}</Notice>
        </div>
      )}

      {(note || pbs.length > 0 || s.tiers.length > 0 || s.milestones.length > 0) && (
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
          {s.milestones.map((m) => (
            <Badge key={m} tone="accent">
              {MILESTONES[m]?.label ?? m}
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

      <PlayReport
        summary={s}
        records={records}
        hideLevels={s.modeId === 'placement'}
        extra={
          <>
            {s.modeId === 'placement' && (
              <Panel marks>
                <SectionTitle aside={s.status === 'completed' ? 'Where each module starts now' : 'The test ended early, so these are less certain'}>Starting levels</SectionTitle>
                <ul className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
                  {PLACEMENT.modules.map((m) => (
                    <li key={m}>
                      <Stat
                        label={MODES[m].label}
                        value={s.finalLevels[m] === undefined ? 'Unchanged' : level(s.finalLevels[m])}
                        sub={`The test began at ${level(s.launch.levels[m] ?? DEFAULT_MODULE_LEVEL)}`}
                        size="xl"
                      />
                    </li>
                  ))}
                </ul>
                <LinkButton to="/train" variant="primary" className="mt-6">Go to Train</LinkButton>
              </Panel>
            )}
            {s.sections && s.sections.length > 0 && (
              <Panel>
                <SectionTitle aside="Accuracy in each part of the map">Sections</SectionTitle>
                <SectionStrip sections={s.sections} />
              </Panel>
            )}

            <div className="grid gap-6 md:grid-cols-2">
              <Panel>
                <SectionTitle aside={average?.text}>Against your average</SectionTitle>
                {!data ? (
                  <p className="text-ink-2">Loading.</p>
                ) : !average ? (
                  <p className="text-ink-2">This needs 3 finished plays of the same kind in the 30 days before this one.</p>
                ) : rows.length === 0 ? (
                  <p className="text-ink-2">This play was close to your average on every measure.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {rows.map(({ d, v }) => (
                      <li key={d.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                        <span className="min-w-0">
                          <span className="block">{d.label}</span>
                          <span className="block text-sm text-ink-3">average {v.average}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-3">
                          <span className="font-display text-lg tabular-nums">{v.value}</span>
                          <Delta value={v.change} good={d.better} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel>
                <SectionTitle>Over the play</SectionTitle>
                {records ? <Fatigue points={fatigue} compact /> : <p className="text-ink-2">This needs the per-object detail, which has been removed for this play.</p>}
              </Panel>
            </div>

            {notes.length > 0 && (
              <Panel>
                <SectionTitle>Notes on this play</SectionTitle>
                <ul className="space-y-3">
                  {notes.map((n) => (
                    <li key={n.key}>
                      <p>{n.text}</p>
                      <p className="text-sm text-ink-2">{n.basis}</p>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </>
        }
      />

      <div className="mt-6 flex flex-wrap gap-4 text-sm">
        <Link to={`/stats/play/${s.id}`} className="text-accent hover:underline">Full details for this play</Link>
        <Link to="/stats" className="text-accent hover:underline">Your stats</Link>
      </div>
    </>
  );
}
