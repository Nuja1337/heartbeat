// Stand-ins for the canvas and Web Audio, so draw and sound code can run in Node.

export interface CallLog {
  calls: number;
  names: Map<string, number>;
}

/** A 2D context that accepts every call and remembers how often each was made. */
export function fakeContext(log: CallLog): CanvasRenderingContext2D {
  const gradient = { addColorStop() {} };
  const store: Record<string, unknown> = {};
  return new Proxy(store, {
    get(_t, prop: string) {
      if (prop in store) return store[prop];
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return () => gradient;
      if (prop === 'measureText') return () => ({ width: 10 });
      return (...args: unknown[]) => {
        log.calls++;
        log.names.set(prop, (log.names.get(prop) ?? 0) + 1);
        for (const a of args) {
          if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`${prop} got ${a}`);
        }
        return undefined;
      };
    },
    set(_t, prop: string, value) {
      store[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

export function fakeCanvasFactory(log: CallLog) {
  return (w: number, h: number): HTMLCanvasElement => {
    if (!(w > 0 && h > 0 && w < 20000 && h < 20000)) throw new Error(`bad canvas size ${w}x${h}`);
    const ctx = fakeContext(log);
    return { width: w, height: h, getContext: () => ctx } as unknown as HTMLCanvasElement;
  };
}

class FakeParam {
  value = 0;
  setValueAtTime() {}
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
  setTargetAtTime() {}
}

export interface AudioLog {
  oscillators: number;
  sources: number;
}

export function fakeAudioContext(log: AudioLog): AudioContext {
  const node = () => ({ connect() {}, disconnect() {} });
  const ctx = {
    currentTime: 0,
    sampleRate: 48000,
    state: 'running',
    destination: node(),
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
    createGain: () => ({ ...node(), gain: new FakeParam() }),
    createOscillator: () => {
      log.oscillators++;
      return { ...node(), type: 'sine', frequency: new FakeParam(), start() {}, stop() {}, onended: null };
    },
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', frequency: new FakeParam(), Q: new FakeParam() }),
    createBufferSource: () => {
      log.sources++;
      return { ...node(), buffer: null, loop: false, start() {}, stop() {}, onended: null };
    },
    createBuffer: (_c: number, len: number, rate: number) => ({ duration: len / rate, getChannelData: () => new Float32Array(len) }),
    createDynamicsCompressor: () => ({
      ...node(),
      threshold: new FakeParam(),
      knee: new FakeParam(),
      ratio: new FakeParam(),
      attack: new FakeParam(),
      release: new FakeParam(),
    }),
  };
  return ctx as unknown as AudioContext;
}
