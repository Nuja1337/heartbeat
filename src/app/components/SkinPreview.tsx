// A 480 by 300 autoplay of a fixed Dynamic map. It follows the skin settings live and stops while off screen.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlaybackHandle, Settings } from '../../shared/types';
import { useGame } from '../state/engine';
import { skinPreviewLaunch } from '../state/launch';

/** The preview makes no sound. The Sound section has its own test buttons. */
export function silent(settings: Settings): Settings {
  return { ...settings, audio: { ...settings.audio, muted: true } };
}

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
  const launch = useMemo(skinPreviewLaunch, []);

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
          if (visible.current) h.play();
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
  }, [game, launch]);

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
      if (!ready.current) return;
      if (on) handle.current?.play();
      else handle.current?.pause();
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const message = failed ? 'The preview could not load.' : error;
  return (
    <div className="relative aspect-[8/5] w-full max-w-[480px] overflow-hidden rounded-md border border-line bg-bg-2">
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
  );
}
