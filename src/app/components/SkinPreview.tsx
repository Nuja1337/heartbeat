// A 480 by 300 autoplay of a fixed Dynamic map. It follows the skin settings live, stops while off screen and has a
// pause button. With reduced motion it starts paused and stays paused until the player presses play.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlaybackHandle, Settings } from '../../shared/types';
import { motionReduced } from '../state/appearance';
import { useGame } from '../state/engine';
import { skinPreviewLaunch } from '../state/launch';
import { Button } from './ui';

/** The preview makes no sound. The Sound section has its own test buttons. */
export function silent(settings: Settings): Settings {
  return { ...settings, audio: { ...settings.audio, muted: true } };
}

/** Whether the preview is meant to move. A press on the button wins, and reduced motion otherwise keeps it still. */
export const previewRunning = (userChoice: boolean | null, reduced: boolean): boolean => userChoice ?? !reduced;

export function SkinPreview({ settings }: { settings: Settings }) {
  const { game, failed } = useGame();
  const canvas = useRef<HTMLCanvasElement>(null);
  const handle = useRef<PlaybackHandle | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const visible = useRef(true);
  const ready = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // true or false once the player pressed the button. null follows the motion setting.
  const [userRun, setUserRun] = useState<boolean | null>(null);
  const reduced = settings.display.reduceMotion || (typeof document !== 'undefined' && motionReduced());
  const running = previewRunning(userRun, reduced);
  const runningRef = useRef(running);
  runningRef.current = running;
  const launch = useMemo(skinPreviewLaunch, []);

  /** Plays only while the preview is ready, on screen and not paused. */
  const sync = useCallback(() => {
    const h = handle.current;
    if (!h || !ready.current) return;
    if (visible.current && runningRef.current) h.play();
    else h.pause();
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!game || !el) return;
    let alive = true;
    let h: PlaybackHandle | null = null;
    ready.current = false;
    try {
      h = game.createPlayback(el, { kind: 'autoplay', launch, loop: true }, silent(settingsRef.current), {
        onReady: () => {
          if (!alive || !h) return;
          ready.current = true;
          setLoading(false);
          sync();
        },
        onTime: () => undefined,
        onEnd: () => undefined,
        onError: (message) => alive && setError(message),
      });
      handle.current = h;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The preview could not start.');
    }
    return () => {
      alive = false;
      h?.destroy();
      handle.current = null;
    };
  }, [game, launch, sync]);

  useEffect(() => {
    handle.current?.setSettings(silent(settings));
  }, [settings]);

  // Pause while the preview is scrolled out of view.
  useEffect(() => {
    const el = canvas.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      const on = entries.some((e) => e.isIntersecting);
      visible.current = on;
      sync();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [sync]);

  useEffect(sync, [running, sync]);

  const message = failed ? 'The preview could not load.' : error;
  return (
    <div className="w-full max-w-[480px]">
      <div className="relative aspect-[8/5] w-full overflow-hidden rounded-md border border-line bg-bg-2">
        <canvas ref={canvas} className="block size-full" width={480} height={300} role="img" aria-label="A preview of the map with your look settings" />
        {message ? (
          <p role="status" className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-ink-2">
            {message}
          </p>
        ) : (
          loading && (
            <span role="status" className="fw-kicker absolute inset-0 grid place-items-center bg-bg-2">
              Loading the preview.
            </span>
          )
        )}
      </div>
      <Button size="sm" variant="ghost" className="mt-2" disabled={!game || Boolean(message)} onClick={() => setUserRun(!running)}>
        {running ? 'Pause the preview' : 'Play the preview'}
      </Button>
    </div>
  );
}
