import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { CalibrationHandle, CalibrationKind, CalibrationResult } from '../../shared/types';
import { Button, LinkButton, Notice, PageHeader, Panel, Stat } from '../components/ui';
import { msg, t } from '../i18n';
import { useGame } from '../state/engine';
import { UNEVEN_NOTE, UNEVEN_SD_MS, offsetToApply, offsetWords, patchOnboarding } from '../state/onboarding';
import { getSettings, updateSettings } from '../state/store';

const COPY: Record<CalibrationKind, { title: string; intro: string }> = {
  visual: {
    title: msg('Visual calibration'),
    intro: msg('Tap as the ring closes on the target, and Heartbeat sets how early targets are drawn.'),
  },
  audio: {
    title: msg('Audio calibration'),
    intro: msg('Tap with the metronome clicks, and Heartbeat sets how early the clicks play.'),
  },
};

/** The calibration page. `?kind=visual|audio` picks the screen and `?from=welcome` sends the player back to setup. */
export function Calibrate() {
  const [params] = useSearchParams();
  const kind: CalibrationKind = params.get('kind') === 'audio' ? 'audio' : 'visual';
  const fromWelcome = params.get('from') === 'welcome';
  const back = fromWelcome ? '/welcome' : '/settings';
  const backLabel = fromWelcome ? t('Back to setup') : t('Back to settings');
  const navigate = useNavigate();
  const { game, failed } = useGame();
  const canvas = useRef<HTMLCanvasElement>(null);
  const handle = useRef<CalibrationHandle | null>(null);
  const [taps, setTaps] = useState<{ taps: number; needed: number } | null>(null);
  const [result, setResult] = useState<CalibrationResult | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!game || !el) return;
    setResult(null);
    setApplied(null);
    setTaps(null);
    handle.current = game.createCalibration(el, kind, getSettings(), {
      onTap: (n, needed) => {
        setTaps({ taps: n, needed });
        // A restart clears the result, whether the player or a lost focus did it.
        if (n === 0) {
          setResult(null);
          setApplied(null);
        }
      },
      onDone: (r) => setResult(r),
      onError: (message) => setError(message),
    });
    return () => {
      handle.current?.destroy();
      handle.current = null;
    };
  }, [game, kind]);

  const apply = () => {
    if (!result) return;
    const value = offsetToApply(kind, result.offsetMs);
    updateSettings((s) =>
      kind === 'visual' ? { ...s, display: { ...s.display, visualOffsetMs: value } } : { ...s, audio: { ...s.audio, offsetMs: value } },
    );
    setApplied(value);
    // The visual calibration is the one that counts for setup. The audio one is optional.
    if (kind === 'visual') patchOnboarding((o) => ({ ...o, calibrated: true })).catch(() => undefined);
  };

  const again = () => {
    setResult(null);
    setApplied(null);
    handle.current?.restart();
  };

  const uneven = result !== null && result.sdMs > UNEVEN_SD_MS;
  const copy = COPY[kind];

  return (
    <>
      <PageHeader
        title={t(copy.title)}
        intro={t(copy.intro)}
        actions={
          <>
            {kind === 'visual' ? (
              <LinkButton to={`/calibrate?kind=audio${fromWelcome ? '&from=welcome' : ''}`} variant="ghost">
                {t('Audio calibration')}
              </LinkButton>
            ) : (
              <LinkButton to={`/calibrate?kind=visual${fromWelcome ? '&from=welcome' : ''}`} variant="ghost">
                {t('Visual calibration')}
              </LinkButton>
            )}
            <LinkButton to={back} variant="ghost">
              {backLabel}
            </LinkButton>
          </>
        }
      />

      {(failed || error) && (
        <div className="mb-4">
          <Notice tone="bad">{error ?? t('The game could not load, so the calibration cannot start.')}</Notice>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel marks className="p-2 sm:p-3">
            <canvas
              ref={canvas}
              aria-label={t('{kind, select, visual {Visual calibration canvas} other {Audio calibration canvas}}', { kind })}
              className="block h-80 w-full sm:h-[min(62vh,520px)] select-none rounded-md bg-bg"
              style={{ touchAction: 'none' }}
              onContextMenu={(e) => e.preventDefault()}
            />
          </Panel>
        </div>

        <Panel className="flex flex-col gap-4 self-start">
          <Stat
            label={t('Taps')}
            value={taps ? t('{taps} of {needed}', { taps: taps.taps, needed: taps.needed }) : t('Not started')}
            size="lg"
          />
          {result ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Stat label={t('Median')} value={`${Math.round(result.offsetMs)} ms`} sub={offsetWords(result.offsetMs)} size="lg" />
                <Stat label={t('Spread')} value={`${Math.round(result.sdMs)} ms`} sub={t('between taps')} size="lg" />
              </div>
              {uneven && <Notice tone="warn">{t(UNEVEN_NOTE)}</Notice>}
              {applied !== null ? (
                <Notice tone="good">
                  {t('{kind, select, visual {Visual offset set to {value} ms.} other {Audio offset set to {value} ms.}}', {
                    kind,
                    value: applied,
                  })}
                </Notice>
              ) : (
                <p className="text-sm text-ink-2">
                  {t(
                    '{kind, select, visual {Apply sets your visual offset to {value} ms.} other {Apply sets your audio offset to {value} ms.}}',
                    {
                      kind,
                      value: offsetToApply(kind, result.offsetMs),
                    },
                  )}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant={uneven || applied !== null ? 'secondary' : 'primary'} disabled={applied !== null} onClick={apply}>
                  {applied !== null ? t('Applied') : t('Apply')}
                </Button>
                <Button variant={uneven && applied === null ? 'primary' : 'secondary'} onClick={again}>
                  {t('Try again')}
                </Button>
                {applied !== null && (
                  <Button
                    variant="primary"
                    onClick={() => navigate(back, { state: { calibration: { kind, offsetMs: result.offsetMs, sdMs: result.sdMs } } })}
                  >
                    {fromWelcome ? t('Continue setup') : t('Done')}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-ink-2">
              {t(
                'The first press starts the run and does not count. After four lead-in beats, {n} taps are collected. The result shows here.',
                { n: taps?.needed ?? 24 },
              )}
            </p>
          )}
          {!result && taps && taps.taps > 0 && (
            <Button variant="ghost" onClick={again}>
              {t('Start over')}
            </Button>
          )}
        </Panel>
      </div>
    </>
  );
}
