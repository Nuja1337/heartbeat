import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/catalog';
import type { CalibrationCallbacks, CalibrationKind } from '../../shared/types';
import { fakeAudioContext } from '../testing/fakes';
import type { AudioLog } from '../testing/fakes';
import { installFakeDom, key } from '../testing/fakeDom';
import type { FakeEnv } from '../testing/fakeDom';
import { createCalibrationImpl } from './calibration';
import { CALIBRATION_STRINGS } from './strings';

let env: FakeEnv | null = null;
afterEach(() => {
  env?.cleanup();
  env = null;
});

/** `state` is what the audio context reports after resume() settles. */
function start(kind: CalibrationKind, audio: 'running' | 'suspended' | 'missing') {
  const e = installFakeDom();
  env = e;
  if (audio !== 'missing') {
    const log: AudioLog = { oscillators: 0, sources: 0 };
    e.window.AudioContext = function () {
      const ctx = fakeAudioContext(log) as unknown as { state: string };
      ctx.state = audio;
      return ctx;
    };
  }
  const errors: string[] = [];
  const taps: Array<[number, number]> = [];
  const callbacks: CalibrationCallbacks = { onTap: (n, needed) => taps.push([n, needed]), onDone: vi.fn(), onError: (m) => errors.push(m) };
  const handle = createCalibrationImpl(e.canvas as unknown as HTMLCanvasElement, kind, DEFAULT_SETTINGS, callbacks);
  key(e, 'keydown', 'KeyZ');
  key(e, 'keyup', 'KeyZ');
  return { e, handle, errors, taps };
}

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe('audio calibration without sound', () => {
  it('says so when the audio context cannot start, and stops the run', async () => {
    const { errors, taps, e } = start('audio', 'suspended');
    await settle();
    expect(errors).toEqual([CALIBRATION_STRINGS.noSound]);
    expect(taps[taps.length - 1]).toEqual([0, 24]);
    // Further presses start nothing and the error is reported once.
    key(e, 'keydown', 'KeyZ');
    await settle();
    expect(errors).toHaveLength(1);
  });

  it('says so when the browser has no Web Audio', async () => {
    const { errors } = start('audio', 'missing');
    await settle();
    expect(errors).toEqual([CALIBRATION_STRINGS.noSound]);
  });

  it('says nothing when the audio context runs', async () => {
    const { errors } = start('audio', 'running');
    await settle();
    expect(errors).toEqual([]);
  });

  it('does not need sound for the visual calibration', async () => {
    const { errors } = start('visual', 'missing');
    await settle();
    expect(errors).toEqual([]);
  });
});
