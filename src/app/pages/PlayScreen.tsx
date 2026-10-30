import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { savePlay, shouldSave } from '../../data/plays';
import type { GameHandle, LaunchRequest, PlayResult } from '../../shared/types';
import { Button } from '../components/ui';
import { pickCreateGame } from '../play/mode';
import { invalidateAnalysis } from '../state/analysis';
import type { SessionState } from '../state/launch';
import { getSettings } from '../state/store';

export function PlayScreen() {
  const state = useLocation().state as Partial<SessionState> | null;
  const [run, setRun] = useState(0);
  if (!state?.launch) return <Navigate to="/" replace />;
  return <Session key={run} launch={state.launch} from={state.from ?? '/'} onRestart={() => setRun((r) => r + 1)} />;
}

/**
 * One run of the game. React state changes only on pause, finish and errors, never while playing.
 * The engine owns the canvas from createGame until destroy.
 */
function Session({ launch, from, onRestart }: { launch: LaunchRequest; from: string; onRestart(): void }) {
  const navigate = useNavigate();
  const canvas = useRef<HTMLCanvasElement>(null);
  const handle = useRef<GameHandle | null>(null);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const resumeButton = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  // The restart handler is read through a ref so a new closure never restarts the engine.
  const restart = useRef(onRestart);
  restart.current = onRestart;
  // The finished play, kept so a failed save can be tried again.
  const pending = useRef<PlayResult | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const save = useCallback(
    (result: PlayResult) => {
      pending.current = result;
      setError(null);
      setSaving(true);
      savePlay(result).then(
        (saved) => {
          invalidateAnalysis();
          pending.current = null;
          if (mounted.current) navigate(saved ? `/results/${saved.summary.id}` : from, { replace: true });
        },
        (e: unknown) => {
          if (!mounted.current) return;
          setSaving(false);
          setError(`The play finished, but it could not be saved. ${e instanceof Error ? e.message : ''}`.trim());
        },
      );
    },
    [navigate, from],
  );

  /** Saves a play that ended by quick retry, then starts the same launch again without leaving /session. */
  const saveAndRestart = useCallback((result: PlayResult) => {
    if (!shouldSave(result)) {
      restart.current();
      return;
    }
    pending.current = result;
    // The saving state also hides the pause dialog, so Resume, Restart and Quit can't be used mid-save.
    setError(null);
    setSaving(true);
    savePlay(result).then(
      () => {
        invalidateAnalysis();
        pending.current = null;
        if (mounted.current) restart.current();
      },
      (e: unknown) => {
        if (!mounted.current) return;
        setSaving(false);
        setError(`The play finished, but it could not be saved. ${e instanceof Error ? e.message : ''}`.trim());
      },
    );
  }, []);

  const leave = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
    navigate(from, { replace: true });
  }, [navigate, from]);

  useEffect(() => {
    let alive = true;
    const el = canvas.current;
    if (!el) return;
    document.body.style.overflow = 'hidden';

    const finish = (result: PlayResult) => {
      if (!alive) return;
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
      if (!shouldSave(result)) {
        navigate(from, { replace: true });
        return;
      }
      save(result);
    };

    pickCreateGame()
      .then((create) => {
        if (!alive) return;
        try {
          handle.current = create(el, launch, getSettings(), {
            onPause: (p) => alive && setPaused(p),
            onFinish: finish,
            onRetry: (result) => alive && saveAndRestart(result),
            onError: (message) => alive && setError(message),
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : 'The game could not start.');
        }
      })
      .catch(() => alive && setError('The game could not start.'));

    return () => {
      alive = false;
      document.body.style.overflow = '';
      handle.current?.destroy();
      handle.current = null;
    };
  }, [launch, from, navigate, save, saveAndRestart]);

  useEffect(() => {
    if (paused) resumeButton.current?.focus();
  }, [paused]);

  const resume = () => {
    // Raw input needs this click to lock the pointer again.
    handle.current?.resume();
    setPaused(false);
  };

  return (
    <div className="fixed inset-0 bg-bg">
      <canvas ref={canvas} className="block h-full w-full select-none" style={{ touchAction: 'none' }} onContextMenu={(e) => e.preventDefault()} />

      {paused && !error && !saving && (
        <div role="dialog" aria-modal="true" aria-label="Paused" className="hb-enter-small absolute inset-0 flex items-center justify-center bg-bg/80 backdrop-blur-sm">
          <div className="hb-panel hb-marks w-72 p-6">
            <h2 className="hb-kicker mb-5">Paused</h2>
            <div className="flex flex-col gap-2">
              <Button ref={resumeButton} variant="primary" onClick={resume}>
                Resume
              </Button>
              <Button onClick={onRestart}>Restart</Button>
              <Button variant="danger" onClick={() => handle.current?.quit()}>
                Quit
              </Button>
            </div>
          </div>
        </div>
      )}

      {saving && (
        <div role="status" className="absolute inset-0 flex items-center justify-center bg-bg/80 backdrop-blur-sm">
          <span className="hb-kicker">Saving your play.</span>
        </div>
      )}

      {error && (
        <div role="alertdialog" aria-label="Error" className="hb-enter-small absolute inset-0 flex items-center justify-center bg-bg/90">
          <div className="hb-panel hb-marks w-96 max-w-[90vw] border-danger/40 p-6">
            <h2 className="mb-2 text-lg">Something went wrong</h2>
            <p className="mb-6 text-ink-2">{error}</p>
            <div className="flex flex-wrap gap-2">
              {pending.current && (
                <Button variant="primary" onClick={() => save(pending.current!)}>
                  Try saving again
                </Button>
              )}
              <Button variant={pending.current ? 'secondary' : 'primary'} onClick={onRestart}>
                Play again
              </Button>
              <Button variant="ghost" onClick={leave}>
                Back
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
