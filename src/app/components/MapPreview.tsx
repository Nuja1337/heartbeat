// The map panel on the Play screen: the difficulty graph, a few counts, "Watch this map" and "Share map".
// The map is built a moment after the settings stop changing, so a slider drag never waits for the generator.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { demandTimeline } from '../../analytics/index';
import type { DemandTimeline } from '../../analytics/index';
import { itemsFromMap, mapDemand, PREVIEW_MIN_N } from '../../analytics/demand';
import type { SkillDemand } from '../../analytics/demand';
import type { LaunchRequest, PlaybackHandle, SkillId } from '../../shared/types';
import { duration } from '../format';
import type { GameModule } from '../state/engine';
import { useGame } from '../state/engine';
import { mapStats } from '../state/launch';
import type { MapStats } from '../state/launch';
import { useSettings } from '../state/store';
import { DifficultyGraph } from './DifficultyGraph';
import { ShareButton } from './ShareButton';
import { Button, Notice, SectionTitle } from './ui';

/** Time bins of the graph, in ms. */
export const GRAPH_BIN_MS = 2000;
/** How long the settings must stay still before the map is built again. */
export const PREVIEW_DELAY_MS = 250;

export interface MapPreviewData {
  timeline: DemandTimeline;
  stats: MapStats;
  demand: Partial<Record<SkillId, Pick<SkillDemand, 'level'>>>;
}

/** Everything the panel shows for a launch. Throws when the launch can't be built. */
export function buildPreview(game: Pick<GameModule, 'previewLaunch'>, launch: LaunchRequest): MapPreviewData {
  const p = game.previewLaunch(launch);
  return {
    timeline: demandTimeline(p.map, p.features, GRAPH_BIN_MS),
    stats: mapStats(p.map, p.features),
    demand: mapDemand(itemsFromMap(p.map, p.features), launch.mods, PREVIEW_MIN_N),
  };
}

/**
 * The preview of a launch, built after the launch has stopped changing. The first one is built at once.
 * The last result stays while the next one is pending.
 */
export function useMapPreview(launch: LaunchRequest, game: GameModule | null): { data: MapPreviewData | null; pending: boolean; failed: boolean } {
  const [state, setState] = useState<{ data: MapPreviewData | null; failed: boolean; done: LaunchRequest | null }>({ data: null, failed: false, done: null });
  const first = useRef(true);

  useEffect(() => {
    if (!game) return;
    const wait = first.current ? 0 : PREVIEW_DELAY_MS;
    const timer = window.setTimeout(() => {
      first.current = false;
      try {
        setState({ data: buildPreview(game, launch), failed: false, done: launch });
      } catch {
        setState((s) => ({ data: s.data, failed: true, done: launch }));
      }
    }, wait);
    return () => window.clearTimeout(timer);
  }, [game, launch]);

  return { data: state.data, failed: state.failed, pending: game !== null && state.done !== launch };
}

const DASH = '–';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-micro uppercase text-ink-3">{label}</dt>
      <dd className="font-display text-xl leading-tight">{value}</dd>
    </div>
  );
}

export function MapPreview({ launch, data, pending, failed }: { launch: LaunchRequest; data: MapPreviewData | null; pending: boolean; failed: boolean }) {
  const [watching, setWatching] = useState(false);
  const s = data?.stats;
  return (
    <section className="hb-panel p-4 sm:p-6" aria-label="Map">
      <SectionTitle aside={pending && data ? 'Updating' : undefined}>Map</SectionTitle>
      <div className={`transition-opacity ${pending && data ? 'opacity-60' : ''}`} aria-busy={pending}>
        {data ? (
          <DifficultyGraph timeline={data.timeline} />
        ) : failed ? (
          <Notice>The map could not be built for these settings.</Notice>
        ) : (
          <div className="grid h-40 place-items-center rounded-md border border-line bg-bg-2">
            <span className="hb-kicker">Building the map.</span>
          </div>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
          <Stat label="Objects a minute" value={s ? String(s.perMinute) : DASH} />
          <Stat label="Longest stream" value={s ? (s.longestStream > 0 ? `${s.longestStream} taps` : 'None') : DASH} />
          <Stat label="Objects" value={s ? String(s.objects) : DASH} />
          <Stat label="Sliders" value={s ? String(s.sliders) : DASH} />
          <Stat label="Spinners" value={s ? String(s.spinners) : DASH} />
        </dl>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button onClick={() => setWatching(true)} disabled={!data}>
          Watch this map
        </Button>
        <ShareButton launch={launch} />
      </div>
      {watching && <WatchMap launch={launch} onClose={() => setWatching(false)} />}
    </section>
  );
}

/** A modal that plays the map with a simulated player, with a play button and a scrubber. */
export function WatchMap({ launch, onClose }: { launch: LaunchRequest; onClose(): void }) {
  const { game, failed: loadFailed } = useGame();
  const [settings] = useSettings();
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const handle = useRef<PlaybackHandle | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const live = useRef({ playing: false, durationMs: 0 });
  const [info, setInfo] = useState<number | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!game || !el) return;
    let alive = true;
    let h: PlaybackHandle | null = null;
    try {
      h = game.createPlayback(el, { kind: 'autoplay', launch, loop: false }, settingsRef.current, {
        onReady: (i) => {
          if (!alive || !h) return;
          live.current.durationMs = i.durationMs;
          setInfo(i.durationMs);
          h.play();
          live.current.playing = true;
          setPlaying(true);
        },
        onTime: (t) => alive && setTime(t),
        onEnd: () => {
          if (!alive) return;
          live.current.playing = false;
          setPlaying(false);
        },
        onError: (message) => alive && setError(message),
      });
      handle.current = h;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The map could not be played.');
    }
    return () => {
      alive = false;
      h?.destroy();
      handle.current = null;
    };
  }, [game, launch]);

  const seek = (t: number) => {
    handle.current?.seek(t);
    setTime(t);
  };
  const toggle = () => {
    const h = handle.current;
    if (!h) return;
    if (live.current.playing) {
      h.pause();
      live.current.playing = false;
      setPlaying(false);
      return;
    }
    if (live.current.durationMs > 0 && time >= live.current.durationMs - 50) seek(0);
    h.play();
    live.current.playing = true;
    setPlaying(true);
  };

  const total = info ?? 0;
  const fill = total > 0 ? Math.min(100, (time / total) * 100) : 0;
  const message = loadFailed ? 'The game could not load.' : error;

  return (
    <dialog
      ref={dialog}
      aria-label="Watch this map"
      className="m-auto w-[min(56rem,calc(100vw-1.5rem))] max-w-none rounded-lg border border-line-2 bg-surface p-4 text-ink backdrop:bg-black/70 sm:p-5"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) dialog.current?.close();
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="hb-kicker">Watch this map</h2>
        <Button size="sm" variant="ghost" onClick={() => dialog.current?.close()}>
          Close
        </Button>
      </div>
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-lg border border-line bg-bg-2">
        <canvas ref={canvas} className="block size-full cursor-pointer select-none" aria-label="The map played by a simulated player" onClick={toggle} />
        {!info && !message && (
          <div role="status" className="absolute inset-0 grid place-items-center bg-bg-2">
            <span className="hb-kicker">Loading the map.</span>
          </div>
        )}
      </div>
      {message && (
        <div className="mt-3">
          <Notice tone="warn">{message}</Notice>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={toggle} disabled={!info} className="w-24">
          {playing ? 'Pause' : 'Play'}
        </Button>
        <span className="font-display tabular-nums">
          {duration(time)} <span className="text-ink-3">/ {duration(total)}</span>
        </span>
      </div>
      <input
        type="range"
        className="mt-2"
        aria-label="Position in the map"
        aria-valuetext={`${duration(time)} of ${duration(total)}`}
        min={0}
        max={Math.max(1, Math.round(total))}
        step={1}
        value={Math.round(time)}
        disabled={!info}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(e) => seek(Number(e.target.value))}
      />
    </dialog>
  );
}
