import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { getReplay, getReplayRow, setReplayKeep, ReplayFormatError } from '../../data/replays';
import type { PlaySummary } from '../../data/schema';
import { gradeFor } from '../../shared/catalog';
import type { HitRecord, MissReason, PlaybackHandle, ReplayData } from '../../shared/types';
import { Badge, Button, GradeBadge, LinkButton, Notice, PageHeader, Panel, Segmented, SectionTitle, Toggle } from '../components/ui';
import { INTRO } from '../copy';
import { dateTime, duration, modList, playTitle } from '../format';
import { msg, t } from '../i18n';
import { useGame } from '../state/engine';
import type { GameModule } from '../state/engine';
import { FRAME_STEP_MS, SEEK_STEP_MS, clampTime, nextMissTarget, replayMarkers, seekTarget } from '../state/replayMarkers';
import type { ReplayMarker } from '../state/replayMarkers';
import { getAppState, updatePrefs, useSettings } from '../state/store';
import { usePlay } from '../state/usePlay';

const SPEEDS = [0.25, 0.5, 1, 1.5, 2] as const;
const SPEED_OPTIONS = SPEEDS.map((v) => ({ value: v, label: `${v}x` }));

// Both tables are shown in the middle of a line, so the words start in lower case.
const REASON: Record<MissReason, string> = {
  none: msg('missed'),
  aim: msg('missed the target'),
  early: msg('pressed too early'),
  skipped: msg('no press'),
  tracking: msg('lost the slider'),
  spin: msg('did not finish the spinner'),
};
const KIND_LABEL = { circle: msg('circle'), slider: msg('slider'), spinner: msg('spinner') } as const;

const nearestSpeed = (v: number): number =>
  SPEEDS.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), SPEEDS[2] as number);

type Loaded =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'error'; kind: 'damaged' | 'newer' | 'read'; message: string }
  | { status: 'ready'; replay: ReplayData; keep: boolean };

/** Reads the replay and its keep flag. A damaged or newer replay is a result, not a crash. */
function useReplay(id: string | undefined): Loaded {
  const [state, setState] = useState<{ id: string | undefined; value: Loaded }>({ id, value: { status: 'loading' } });
  useEffect(() => {
    let alive = true;
    if (!id) return;
    (async () => {
      try {
        const [replay, row] = await Promise.all([getReplay(id), getReplayRow(id)]);
        if (alive) setState({ id, value: replay ? { status: 'ready', replay, keep: row?.keep === 1 } : { status: 'none' } });
      } catch (e) {
        if (!alive) return;
        if (e instanceof ReplayFormatError) setState({ id, value: { status: 'error', kind: e.kind, message: e.message } });
        else
          setState({
            id,
            value: { status: 'error', kind: 'read', message: e instanceof Error ? e.message : t('Could not read this replay.') },
          });
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);
  return state.id === id ? state.value : { status: 'loading' };
}

export function Replay() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { play, missing, error } = usePlay(id);
  const loaded = useReplay(id);
  const { game, failed } = useGame();
  const from = Number(search.get('t'));
  const startAt = Number.isFinite(from) && from > 0 ? from : 0;

  const back = id ? (
    <LinkButton to={`/results/${id}`} variant="ghost">
      {t('Results')}
    </LinkButton>
  ) : null;
  const intro = play ? t('{date}. {mods}.', { date: dateTime(play.summary.startedAt), mods: modList(play.summary.mods) }) : INTRO.replay;

  let body;
  if (error) body = <Notice tone="bad">{error}</Notice>;
  else if (missing) body = <Notice>{t("This play isn't saved on this device, so its replay is gone too.")}</Notice>;
  else if (loaded.status === 'error')
    body = (
      <Notice tone={loaded.kind === 'read' ? 'bad' : 'warn'}>
        {loaded.kind === 'damaged' ? t('This replay is damaged and cannot be played.') : loaded.message}
      </Notice>
    );
  else if (loaded.status === 'none')
    body = (
      <Notice>
        {t('This play has no replay. Heartbeat keeps replays of your newest plays and your bests, plus any you chose to keep.')}
      </Notice>
    );
  else if (failed) body = <Notice tone="bad">{t('The game could not load, so the replay cannot play.')}</Notice>;
  else if (loaded.status === 'loading' || !play || !game)
    body = (
      <div role="status" aria-busy="true" className="grid gap-6 lg:grid-cols-3">
        <div className="hb-skeleton aspect-[16/10] lg:col-span-2" />
        <div className="hb-skeleton h-64" />
        <span className="sr-only">{t('Loading.')}</span>
      </div>
    );
  else
    body = (
      <Viewer
        key={id}
        id={id!}
        replay={loaded.replay}
        keep={loaded.keep}
        summary={play.summary}
        records={play.records}
        startAt={startAt}
        game={game}
      />
    );

  return (
    <>
      <PageHeader title={play ? t('Replay, {title}', { title: playTitle(play.summary) }) : t('Replay')} intro={intro} actions={back} />
      {body}
    </>
  );
}

function Viewer({
  id,
  replay,
  keep: initialKeep,
  summary,
  records,
  startAt,
  game,
}: {
  id: string;
  replay: ReplayData;
  keep: boolean;
  summary: PlaySummary;
  records: HitRecord[] | null;
  startAt: number;
  game: GameModule;
}) {
  const [settings] = useSettings();
  const canvas = useRef<HTMLCanvasElement>(null);
  const handle = useRef<PlaybackHandle | null>(null);
  const [info, setInfo] = useState<{ durationMs: number; mismatches: number } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(() => nearestSpeed(getAppState().prefs.playback.speed));
  const [keep, setKeep] = useState(initialKeep);
  const [keepError, setKeepError] = useState<string | null>(null);
  // Mirrors of state for the key handler and the callbacks, which must not be recreated on every tick.
  const live = useRef({ time: 0, playing: false, speed, durationMs: 0 });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const startRef = useRef(startAt);

  const markers = useMemo(() => replayMarkers(records, replay), [records, replay]);
  const misses = markers.filter((m) => m.kind === 'miss').length;
  const breaks = markers.length - misses;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let alive = true;
    let h: PlaybackHandle | null = null;
    try {
      h = game.createPlayback(el, { kind: 'replay', replay }, settingsRef.current, {
        onReady: (i) => {
          if (!alive || !h) return;
          live.current.durationMs = i.durationMs;
          setInfo(i);
          h.setSpeed(live.current.speed);
          const from = clampTime(startRef.current, i.durationMs);
          if (from > 0) {
            h.seek(from);
            live.current.time = from;
            setTime(from);
          }
          h.play();
          live.current.playing = true;
          setPlaying(true);
        },
        onTime: (now) => {
          if (!alive) return;
          live.current.time = now;
          setTime(now);
        },
        onEnd: () => {
          if (!alive) return;
          live.current.playing = false;
          setPlaying(false);
        },
        onError: (message) => alive && setFailure(message),
      });
      handle.current = h;
    } catch (e) {
      setFailure(e instanceof Error ? e.message : t('The replay could not start.'));
    }
    return () => {
      alive = false;
      h?.destroy();
      handle.current = null;
    };
  }, [game, replay]);

  // A palette or sound change in another tab reaches the viewer through the settings.
  useEffect(() => {
    handle.current?.setSettings(settings);
  }, [settings]);

  const seekTo = useCallback((ms: number) => {
    const to = clampTime(ms, live.current.durationMs);
    handle.current?.seek(to);
    live.current.time = to;
    setTime(to);
  }, []);

  const pause = useCallback(() => {
    handle.current?.pause();
    live.current.playing = false;
    setPlaying(false);
  }, []);

  const resume = useCallback(() => {
    const l = live.current;
    // At the end, play starts over.
    if (l.durationMs > 0 && l.time >= l.durationMs - 50) seekTo(0);
    handle.current?.play();
    l.playing = true;
    setPlaying(true);
  }, [seekTo]);

  const toggle = useCallback(() => (live.current.playing ? pause() : resume()), [pause, resume]);

  const setSpeed = useCallback((v: number) => {
    handle.current?.setSpeed(v);
    live.current.speed = v;
    setSpeedState(v);
    updatePrefs((p) => ({ ...p, playback: { speed: v } }));
  }, []);

  /** Starts playing from a moment, for the Watch buttons and the markers. */
  const watch = useCallback(
    (ms: number) => {
      seekTo(ms);
      resume();
    },
    [seekTo, resume],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.repeat && (e.key === 'm' || e.key === 'M' || e.key === ' ')) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      const tag = el?.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (tag === 'INPUT' && (el as HTMLInputElement).type !== 'range' && (el as HTMLInputElement).type !== 'checkbox') return;
      const l = live.current;
      switch (e.key) {
        case ' ':
          // A focused button handles Space itself.
          if (tag === 'BUTTON' || tag === 'A' || (tag === 'INPUT' && (el as HTMLInputElement).type === 'checkbox')) return;
          e.preventDefault();
          toggle();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekTo(l.time - SEEK_STEP_MS);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekTo(l.time + SEEK_STEP_MS);
          break;
        case ',':
        case '.':
          e.preventDefault();
          if (l.playing) pause();
          seekTo(l.time + (e.key === '.' ? FRAME_STEP_MS : -FRAME_STEP_MS));
          break;
        case '[':
        case ']': {
          const i = SPEEDS.indexOf(l.speed as (typeof SPEEDS)[number]);
          const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + (e.key === ']' ? 1 : -1)))]!;
          setSpeed(next);
          break;
        }
        case 'm':
        case 'M': {
          const target = nextMissTarget(markers, l.time);
          if (target !== null) watch(target);
          break;
        }
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, seekTo, pause, setSpeed, watch, markers]);

  const changeKeep = (next: boolean) => {
    setKeep(next);
    setKeepError(null);
    setReplayKeep(id, next).catch((e: unknown) => {
      setKeep(!next);
      setKeepError(e instanceof Error ? e.message : t('Could not change this.'));
    });
  };

  const duration_ = info?.durationMs ?? 0;
  const grade = gradeFor(summary.accuracy, summary.counts.miss, summary.status);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="min-w-0 space-y-4 lg:col-span-2">
        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-lg border border-line bg-bg-2">
          <canvas
            ref={canvas}
            className="block size-full cursor-pointer select-none"
            aria-label={t('Replay of the play')}
            onClick={toggle}
          />
          {!info && !failure && (
            <div role="status" className="absolute inset-0 grid place-items-center bg-bg-2">
              <span className="hb-kicker">{t('Loading the replay.')}</span>
            </div>
          )}
        </div>

        {failure && <Notice tone="warn">{failure}</Notice>}
        {info && info.mismatches > 0 && (
          <Notice>
            {t('This replay runs a little differently from the saved result on {n, plural, one {# object} other {# objects}}.', {
              n: info.mismatches,
            })}
          </Notice>
        )}

        <Panel className="space-y-3 p-4 sm:p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={toggle} disabled={!info} aria-keyshortcuts="Space" className="w-24">
              {playing ? t('Pause', undefined, 'playback') : t('Play', undefined, 'playback')}
            </Button>
            <span className="font-display tabular-nums text-ink" aria-live="off">
              {duration(time)} <span className="text-ink-3">/ {duration(duration_)}</span>
            </span>
            <div className="ml-auto">
              <Segmented legend={t('Speed')} value={speed} options={SPEED_OPTIONS} onChange={setSpeed} />
            </div>
          </div>

          <Scrubber time={time} durationMs={duration_} markers={markers} disabled={!info} onSeek={seekTo} onWatch={watch} />

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-2">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-3 w-0.5" style={{ background: 'var(--color-miss)' }} /> {t('Miss')}
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-3 w-0.5" style={{ background: 'var(--color-rough)' }} /> {t('Slider break')}
            </span>
            <span className="text-ink-3">
              {t(
                'Space plays and pauses. The left and right arrow keys move 2 seconds, comma and period step one frame, [ and ] change the speed, and M goes to the next miss.',
              )}
            </span>
          </div>
        </Panel>

        <Panel className="p-4 sm:p-4">
          <Toggle
            label={t('Keep this replay')}
            help={t('A kept replay is never removed to make room for newer ones.')}
            checked={keep}
            onChange={changeKeep}
          />
          {keepError && <Notice tone="bad">{keepError}</Notice>}
        </Panel>
      </div>

      <Panel className="min-w-0 lg:self-start">
        <SectionTitle aside={grade ? <GradeBadge grade={grade} size="chip" /> : undefined}>{t('Misses')}</SectionTitle>
        <p className="mb-3 text-sm text-ink-2">
          {markers.length === 0
            ? t('There are no misses in this play.')
            : breaks > 0
              ? t(
                  '{misses, plural, one {# miss} other {# misses}} and {breaks, plural, one {# slider break} other {# slider breaks}}. Watch starts 1.5 seconds before each one.',
                  { misses, breaks },
                )
              : t('{misses, plural, one {# miss} other {# misses}}. Watch starts 1.5 seconds before each one.', { misses })}
        </p>
        {markers.length > 0 && (
          <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto pr-1">
            {markers.map((m) => (
              <MissRow key={`${m.kind}-${m.index}-${m.time}`} m={m} onWatch={() => watch(seekTarget(m.time))} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function MissRow({ m, onWatch }: { m: ReplayMarker; onWatch(): void }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate">{t('Object {n}, {kind}', { n: m.index + 1, kind: t(KIND_LABEL[m.objectKind]) })}</span>
        <span className="block text-sm text-ink-3">
          {m.kind === 'break'
            ? t('{time}, slider break', { time: duration(m.time) })
            : m.reason
              ? t('{time}, {reason}', { time: duration(m.time), reason: t(REASON[m.reason]) })
              : duration(m.time)}
        </span>
      </span>
      {m.kind === 'break' && <Badge tone="warn">{t('Break')}</Badge>}
      <Button size="sm" onClick={onWatch} aria-label={t('Watch object {n} at {time}', { n: m.index + 1, time: duration(m.time) })}>
        {t('Watch')}
      </Button>
    </li>
  );
}

/** The seek bar with a tick for every miss and slider break. A tick starts playing a moment before it. */
function Scrubber({
  time,
  durationMs,
  markers,
  disabled,
  onSeek,
  onWatch,
}: {
  time: number;
  durationMs: number;
  markers: readonly ReplayMarker[];
  disabled: boolean;
  onSeek(t: number): void;
  onWatch(t: number): void;
}) {
  const fill = durationMs > 0 ? Math.min(100, (time / durationMs) * 100) : 0;
  return (
    <div>
      <input
        type="range"
        aria-label={t('Position in the replay')}
        aria-valuetext={t('{time} of {total}', { time: duration(time), total: duration(durationMs) })}
        min={0}
        max={Math.max(1, Math.round(durationMs))}
        step={1}
        value={Math.round(time)}
        disabled={disabled}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(e) => onSeek(Number(e.target.value))}
      />
      <div className="relative mx-[7px] h-4" aria-label={t('Misses and slider breaks')}>
        {durationMs > 0 &&
          markers.map((m) => (
            <button
              key={`${m.kind}-${m.index}-${m.time}`}
              type="button"
              tabIndex={-1}
              title={t('{kind, select, miss {Miss at {time}} other {Slider break at {time}}}', { kind: m.kind, time: duration(m.time) })}
              aria-label={t('{kind, select, miss {Miss at {time}, watch} other {Slider break at {time}, watch}}', {
                kind: m.kind,
                time: duration(m.time),
              })}
              onClick={() => onWatch(seekTarget(m.time))}
              className="group absolute top-0 h-4 w-3 -translate-x-1/2 cursor-pointer"
              style={{ left: `${Math.min(100, (m.time / durationMs) * 100)}%` }}
            >
              <span
                className="absolute left-1/2 top-0.5 h-3 w-0.5 -translate-x-1/2 rounded-full transition group-hover:h-3.5"
                style={{ background: m.kind === 'miss' ? 'var(--color-miss)' : 'var(--color-rough)' }}
              />
            </button>
          ))}
      </div>
    </div>
  );
}
