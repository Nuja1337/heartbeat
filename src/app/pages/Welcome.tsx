import { useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { MODES, PLACEMENT } from '../../shared/catalog';
import type { CalibrationKind } from '../../shared/types';
import { KeyCapture } from '../components/KeyCapture';
import { PLACEMENT_TIME } from '../copy';
import { andList } from '../format';
import { Button, LinkButton, Notice, PageHeader, Panel, Segmented, Slider, Stat, Toggle } from '../components/ui';
import { placementLaunch, startPlay } from '../state/launch';
import { useCurrentLevels } from '../state/levels';
import {
  EMPTY_ONBOARDING, STEPS, UNEVEN_NOTE, UNEVEN_SD_MS, finished, nextStep, offsetWords, stepDone, useOnboarding, withStepDone,
} from '../state/onboarding';
import type { OnboardingStep } from '../state/onboarding';
import { getAppState, useSettings } from '../state/store';

type Device = 'mouse' | 'tablet';

/** What the calibration page sent back in the router state. */
interface CalibrationNote {
  kind: CalibrationKind;
  offsetMs: number;
  sdMs: number;
}

function readCalibration(state: unknown): CalibrationNote | null {
  const c = (state as { calibration?: Partial<CalibrationNote> } | null)?.calibration;
  if (!c || (c.kind !== 'visual' && c.kind !== 'audio') || typeof c.offsetMs !== 'number' || typeof c.sdMs !== 'number') return null;
  return { kind: c.kind, offsetMs: c.offsetMs, sdMs: c.sdMs };
}

function StepList({ current, flags, onPick }: { current: OnboardingStep; flags: Record<OnboardingStep, boolean>; onPick(step: OnboardingStep): void }) {
  return (
    <ol className="mb-6 grid grid-cols-3 gap-2 sm:gap-4" aria-label="Setup steps">
      {STEPS.map((s, i) => {
        const here = s.id === current;
        return (
          <li key={s.id}>
            <button
              type="button"
              aria-current={here ? 'step' : undefined}
              onClick={() => onPick(s.id)}
              className={`block w-full cursor-pointer border-t-2 pt-3 text-left transition ${here ? 'border-accent' : flags[s.id] ? 'border-accent/40' : 'border-line-2'}`}
            >
              <span className="fw-kicker">Step {i + 1}</span>
              <span className={`mt-1 block font-display text-lg ${here ? 'text-ink' : 'text-ink-2'}`}>{s.label}</span>
              <span className="block text-sm text-ink-3">{flags[s.id] ? 'Done' : here ? 'In progress' : 'Not started'}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function StepFrame({ title, intro, children, actions }: { title: string; intro: string; children: ReactNode; actions: ReactNode }) {
  return (
    <Panel marks>
      <h2 className="text-xl">{title}</h2>
      <p className="mt-1 max-w-2xl text-ink-2">{intro}</p>
      <div className="mt-4 divide-y divide-line">{children}</div>
      <div className="mt-6 flex flex-wrap items-center gap-2">{actions}</div>
    </Panel>
  );
}

function InputStep({ onNext, onSkip }: { onNext(): void; onSkip(): void }) {
  const [s, update] = useSettings();
  const [device, setDevice] = useState<Device>('mouse');
  const setInput = (patch: Partial<typeof s.input>) => update((x) => ({ ...x, input: { ...x.input, ...patch } }));
  const pick = (d: Device) => {
    setDevice(d);
    // A pen is an absolute device, so raw input can't read it.
    if (d === 'tablet') setInput({ rawInput: false });
  };
  // A hit key can't also be the retry key, so picking it for a hit key turns the retry key off.
  const setHitKey = (slot: 0 | 1, code: string) =>
    update((x) => {
      const keys: [string, string] = [...x.input.keys];
      keys[slot] = code;
      return { ...x, input: { ...x.input, keys, retryKey: x.input.retryKey === code ? '' : x.input.retryKey } };
    });

  return (
    <StepFrame
      title="Input"
      intro="Choose the device you aim with and the keys that hit targets."
      actions={
        <>
          <Button variant="primary" onClick={onNext}>Continue</Button>
          <Button variant="ghost" onClick={onSkip}>Skip this step</Button>
        </>
      }
    >
      <div className="py-3 first:pt-0">
        <div className="mb-2 text-sm text-ink-2">Device</div>
        <Segmented
          legend="Device"
          value={device}
          options={[
            { value: 'mouse', label: 'Mouse' },
            { value: 'tablet', label: 'Tablet or pen' },
          ]}
          onChange={pick}
        />
        {device === 'tablet' && (
          <p className="mt-2 max-w-2xl text-sm text-ink-2">
            A tablet is an absolute device, so it reports where the pen is and not how far it moved. Raw input needs movement, so it is turned off and Flickwise reads the pen position directly.
          </p>
        )}
      </div>
      {device === 'mouse' && (
        <div className="py-3">
          <Toggle
            label="Raw input"
            help="Locks the pointer and reads mouse movement directly. Turn it off if the cursor feels wrong."
            checked={s.input.rawInput}
            onChange={(v) => setInput({ rawInput: v })}
          />
          <Slider
            label="Sensitivity"
            value={s.input.sensitivity}
            min={0.1}
            max={5}
            step={0.05}
            format={(v) => `${v.toFixed(2)}x`}
            help="Raw input only. At 1x one mouse count moves the cursor one pixel at 100% browser zoom."
            disabled={!s.input.rawInput}
            onChange={(v) => setInput({ sensitivity: v })}
          />
        </div>
      )}
      <div className="py-3 last:pb-0">
        <KeyCapture label="Hit key 1" value={s.input.keys[0]} other={s.input.keys[1]} onChange={(code) => setHitKey(0, code)} />
        <KeyCapture label="Hit key 2" value={s.input.keys[1]} other={s.input.keys[0]} onChange={(code) => setHitKey(1, code)} />
        <p className="mt-1 text-sm text-ink-2">Click a key box and press the key you want. Mouse buttons hit targets too.</p>
      </div>
    </StepFrame>
  );
}

function CalibrationRow({ kind, title, text, value, optional }: { kind: CalibrationKind; title: string; text: string; value: number; optional?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3 first:pt-0">
      <div className="min-w-0 flex-1">
        <h3 className="text-lg">
          {title} {optional && <span className="text-sm font-normal text-ink-3">optional</span>}
        </h3>
        <p className="text-sm text-ink-2">{text}</p>
        <p className="mt-1 text-sm text-ink-3">Offset now {value} ms</p>
      </div>
      <LinkButton to={`/calibrate?kind=${kind}&from=welcome`}>Calibrate</LinkButton>
    </div>
  );
}

function TimingStep({ calibrated, note, onNext, onSkip }: { calibrated: boolean; note: CalibrationNote | null; onNext(): void; onSkip(): void }) {
  const [s] = useSettings();
  return (
    <StepFrame
      title="Timing"
      intro="Displays and speakers add delay. Calibration measures yours so targets and clicks line up with what you see and hear."
      actions={
        calibrated ? (
          <>
            <Button variant="primary" onClick={onNext}>Continue</Button>
            <Button variant="ghost" onClick={onSkip}>Skip this step</Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onSkip}>Skip this step</Button>
        )
      }
    >
      <CalibrationRow kind="visual" title="Visual timing" text="Tap as a ring closes on a target. It takes about a minute." value={s.display.visualOffsetMs} />
      <CalibrationRow kind="audio" title="Audio timing" optional text="Tap with the metronome clicks. Use the speakers or headphones you play with." value={s.audio.offsetMs} />
      {note && (
        <div className="space-y-3 py-3 last:pb-0">
          <div className="grid max-w-sm grid-cols-2 gap-4">
            <Stat label={`${note.kind === 'visual' ? 'Visual' : 'Audio'} median`} value={`${Math.round(note.offsetMs)} ms`} sub={offsetWords(note.offsetMs)} />
            <Stat label="Spread" value={`${Math.round(note.sdMs)} ms`} sub="between taps" />
          </div>
          {note.sdMs > UNEVEN_SD_MS && <Notice tone="warn">{UNEVEN_NOTE}</Notice>}
        </div>
      )}
    </StepFrame>
  );
}

function PlacementStep({ onStart, onSkip, starting, error }: { onStart(): void; onSkip(): void; starting: boolean; error: string | null }) {
  return (
    <StepFrame
      title="Placement"
      intro={`This short test of ${PLACEMENT_TIME} sets the level each module starts at.`}
      actions={
        <>
          <Button variant="primary" disabled={starting} onClick={onStart}>Start placement</Button>
          <Button variant="ghost" onClick={onSkip}>Skip and finish</Button>
        </>
      }
    >
      <div className="space-y-3 py-3 first:pt-0 last:pb-0">
        <p className="max-w-2xl text-ink-2">
          You play {PLACEMENT.setsPerModule} short sets of each of {andList(PLACEMENT.modules.map((m) => MODES[m].label.toLowerCase()))}. The difficulty follows how you do, and the results show a starting level for each module.
        </p>
        <p className="max-w-2xl text-sm text-ink-3">Without it every module starts at level 3 and moves as you train.</p>
        {error && <Notice tone="bad">{error}</Notice>}
      </div>
    </StepFrame>
  );
}

export function Welcome() {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, error, update } = useOnboarding();
  const { levels, error: levelsError } = useCurrentLevels();
  const note = readCalibration(location.state);
  // Coming back from the calibration page shows its result on the timing step.
  const [viewing, setViewing] = useState<OnboardingStep | null>(note ? 'timing' : null);

  if (!state) return <p className="text-ink-2">Loading.</p>;

  const flags: Record<OnboardingStep, boolean> = {
    input: stepDone(state, 'input'),
    timing: stepDone(state, 'timing'),
    placement: stepDone(state, 'placement'),
  };
  const current = viewing ?? nextStep(state) ?? 'placement';
  const leave = () => navigate('/', { replace: true });

  const complete = async (step: OnboardingStep) => {
    await update((o) => withStepDone(o, step, Date.now()));
    setViewing(null);
  };
  const skipAll = async () => {
    await update((o) => finished(o, Date.now()));
    leave();
  };
  const finishWithoutPlacement = async () => {
    await update((o) => finished(withStepDone(o, 'placement', Date.now()), Date.now()));
    leave();
  };
  const startPlacement = () => {
    if (!levels) return;
    startPlay(navigate, placementLaunch(levels), '/welcome', getAppState().prefs.fullscreen);
  };

  if (state.done && viewing === null) {
    return (
      <>
        <PageHeader title="Setup is finished" intro="You can change any of it later in Settings." />
        <Panel marks className="flex flex-wrap gap-2">
          <LinkButton to="/" variant="primary">Go home</LinkButton>
          <LinkButton to="/train">Train</LinkButton>
          <Button variant="ghost" onClick={() => void update(() => ({ ...EMPTY_ONBOARDING }))}>Run setup again</Button>
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Set up Flickwise"
        intro="Setup has three short steps, and you can skip any of them."
        actions={<Button variant="ghost" onClick={() => void skipAll()}>Skip setup</Button>}
      />
      {error && (
        <div className="mb-4">
          <Notice tone="warn">{error}</Notice>
        </div>
      )}
      <StepList current={current} flags={flags} onPick={setViewing} />
      {current === 'input' && <InputStep onNext={() => void complete('input')} onSkip={() => void complete('input')} />}
      {current === 'timing' && <TimingStep calibrated={state.calibrated} note={note} onNext={() => void complete('timing')} onSkip={() => void complete('timing')} />}
      {current === 'placement' && (
        <PlacementStep starting={!levels && !levelsError} error={levelsError} onStart={startPlacement} onSkip={() => void finishWithoutPlacement()} />
      )}
    </>
  );
}
