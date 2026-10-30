// The game harness for dev.html. It picks a mode, level, mods and settings, plays, and prints the PlayResult.
// It talks to the engine only through src/game/index, like the app does.

import {
  DEFAULT_DIFFICULTY,
  DEFAULT_MODULE_LEVEL,
  DEFAULT_SETTINGS,
  DIFFICULTY_LIMITS,
  LEVEL_PRESETS,
  MODES,
  MODE_ORDER,
  MODS,
  MODULE_IDS,
  PALETTES,
  RECORD_VERSION,
  SOUND_SETS,
  modConflicts,
} from '../../shared/catalog';
import { decodeReplay, encodeReplay } from '../../shared/replay';
import type { ApproachStyle, CalibrationHandle, CalibrationKind, CursorStyle, DifficultySettings, GameHandle, LaunchRequest, MetronomeMode, ModId, ModeId, ModuleId, PaletteId, PlaybackHandle, PlaybackSource, PlayResult, Settings, SoundSetId, TestSound } from '../../shared/types';
import '@fontsource-variable/space-grotesk';
import { ENGINE_VERSION, GENERATOR_VERSION, createCalibration, createGame, createPlayback, playTestSound, previewLaunch } from '../index';
import { autoplayReplay } from '../replay/autoplayReplay';
import { NOISY_PLAYER } from '../sim/autoplay';

const STORE = 'heartbeat-dev-harness';

interface Form {
  mode: ModeId;
  preset: number;
  difficulty: DifficultySettings;
  level: number;
  mods: ModId[];
  length: number;
  seed: number;
  settings: Settings;
}

function loadForm(): Form {
  const base: Form = {
    mode: 'dynamic',
    preset: 4,
    difficulty: { ...DEFAULT_DIFFICULTY },
    level: DEFAULT_MODULE_LEVEL,
    mods: [],
    length: 60,
    seed: Math.floor(Math.random() * 2 ** 32),
    settings: structuredClone(DEFAULT_SETTINGS),
  };
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Form>;
      return { ...base, ...saved, seed: base.seed, settings: { ...base.settings, ...saved.settings } as Settings };
    }
  } catch {
    // Start from the defaults.
  }
  return base;
}

function saveForm(f: Form): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(f));
  } catch {
    // Storage may be blocked.
  }
}

type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') node.addEventListener(k, v);
    else if (k === 'style') node.style.cssText = String(v);
    else if (k in node) (node as unknown as Record<string, unknown>)[k] = v;
    else node.setAttribute(k, String(v));
  }
  for (const kid of kids) node.append(kid);
  return node;
}

const form = loadForm();
let handle: GameHandle | null = null;
let playback: PlaybackHandle | null = null;
let calibration: CalibrationHandle | null = null;
let lastResult: PlayResult | null = null;
let demoMisses = false;

document.body.style.cssText = 'margin:0;background:#0b0f14;color:#e5e7eb;font:13px/1.4 system-ui,sans-serif;overflow:hidden';
const canvas = el('canvas', { style: 'position:fixed;inset:0;width:100vw;height:100vh;display:block' });
const panel = el('div', { style: 'position:fixed;top:0;left:0;bottom:0;width:380px;overflow:auto;padding:14px;box-sizing:border-box;background:rgba(11,15,20,0.96);border-right:1px solid #1f2937;z-index:5' });
const pauseBox = el('div', { style: 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;gap:12px;background:rgba(5,7,10,0.6);z-index:8' });
const panelButton = el('button', { style: 'position:fixed;top:8px;left:8px;z-index:9;display:none', textContent: 'Back to the harness' });
const watchBar = el('div', { style: 'position:fixed;left:0;right:0;bottom:0;display:none;align-items:center;gap:10px;padding:8px 14px;background:rgba(5,7,10,0.85);z-index:9' });
document.body.append(canvas, panel, pauseBox, panelButton, watchBar);

const log = el('pre', { style: 'white-space:pre-wrap;margin:8px 0;font-size:12px' });
const json = el('textarea', { style: 'width:100%;height:120px;font-size:11px;background:#0e141b;color:#9ca3af;border:1px solid #1f2937', readOnly: true });

pauseBox.append(
  el('button', { textContent: 'Resume', style: 'padding:10px 18px;font-size:15px', click: () => handle?.resume() }),
  el('button', { textContent: 'Quit', style: 'padding:10px 18px;font-size:15px', click: () => handle?.quit() }),
);

/* ------------------------------------------------------------- the form */

function row(label: string, control: HTMLElement): HTMLElement {
  return el('label', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;margin:4px 0' }, el('span', {}, label), control);
}

function number(value: number, min: number, max: number, step: number, on: (v: number) => void): HTMLInputElement {
  return el('input', {
    type: 'number',
    value: String(value),
    min,
    max,
    step,
    style: 'width:90px',
    change: (e) => on(Number((e.target as HTMLInputElement).value)),
  });
}

function check(value: boolean, on: (v: boolean) => void): HTMLInputElement {
  return el('input', { type: 'checkbox', checked: value, change: (e) => on((e.target as HTMLInputElement).checked) });
}

function select(options: [string, string][], value: string, on: (v: string) => void): HTMLSelectElement {
  const s = el('select', { change: (e) => on((e.target as HTMLSelectElement).value) });
  for (const [v, label] of options) s.append(el('option', { value: v, textContent: label, selected: v === value }));
  return s;
}

function launch(): LaunchRequest {
  const m = MODES[form.mode];
  const levels: Partial<Record<ModuleId, number>> = {};
  for (const id of MODULE_IDS) levels[id] = form.level;
  return {
    modeId: form.mode,
    difficulty: form.mode === 'dynamic' ? form.difficulty : DEFAULT_DIFFICULTY,
    presetLevel: form.mode === 'dynamic' && form.preset > 0 ? form.preset : null,
    options: m.defaultOptions,
    mods: form.mods.filter((x) => m.allowedMods.includes(x)),
    seed: form.seed,
    lengthSec: form.length,
    levels,
    drillId: null,
  };
}

function build(): void {
  panel.replaceChildren();
  const m = MODES[form.mode];
  panel.append(el('h3', { style: 'margin:0 0 8px' }, `Heartbeat harness (engine ${ENGINE_VERSION}, generator ${GENERATOR_VERSION})`));
  panel.append(
    row('Mode', select(MODE_ORDER.map((id) => [id, MODES[id].label]), form.mode, (v) => {
      form.mode = v as ModeId;
      form.length = MODES[form.mode].defaultLengthSec;
      build();
    })),
  );
  if (form.mode === 'dynamic') {
    panel.append(
      row('Preset', select([['0', 'Custom'], ...LEVEL_PRESETS.map((p) => [String(p.level), p.label] as [string, string])], String(form.preset), (v) => {
        form.preset = Number(v);
        const p = LEVEL_PRESETS.find((x) => x.level === form.preset);
        if (p) {
          form.difficulty = { ...p.difficulty };
          form.length = p.lengthSec;
        }
        build();
      })),
    );
    for (const key of Object.keys(DIFFICULTY_LIMITS) as (keyof DifficultySettings)[]) {
      const lim = DIFFICULTY_LIMITS[key];
      panel.append(
        row(lim.label, number(form.difficulty[key], lim.min, lim.max, lim.step, (v) => {
          form.difficulty = { ...form.difficulty, [key]: v };
          form.preset = 0;
        })),
      );
    }
  } else if ((MODULE_IDS as ModeId[]).includes(form.mode) || form.mode === 'mix' || form.mode === 'warmup' || form.mode === 'stamina') {
    panel.append(row('Module level', number(form.level, 1, 15, 0.5, (v) => (form.level = v))));
  }
  panel.append(row('Length (s)', select(m.lengthOptions.map((n) => [String(n), String(n)]), String(m.lengthOptions.includes(form.length) ? form.length : m.defaultLengthSec), (v) => (form.length = Number(v)))));
  panel.append(row('Seed', el('span', {}, number(form.seed, 0, 4294967295, 1, (v) => (form.seed = v >>> 0)), el('button', { textContent: 'New', click: () => { form.seed = Math.floor(Math.random() * 2 ** 32); build(); } }))));

  panel.append(el('h4', { style: 'margin:10px 0 2px' }, 'Mods'));
  const conflicts = modConflicts(form.mods);
  for (const id of Object.keys(MODS) as ModId[]) {
    const info = MODS[id];
    const blocked = !m.allowedMods.includes(id) || form.mods.some((o) => o !== id && info.conflicts.includes(o));
    const box = check(form.mods.includes(id), (v) => {
      form.mods = v ? [...form.mods, id] : form.mods.filter((x) => x !== id);
      build();
    });
    box.disabled = blocked;
    panel.append(row(`${info.label} (x${info.multiplier})`, box));
  }
  void conflicts;

  panel.append(el('h4', { style: 'margin:10px 0 2px' }, 'Input'));
  const s = form.settings;
  panel.append(row('Raw input', check(s.input.rawInput, (v) => (s.input.rawInput = v))));
  panel.append(row('Sensitivity', number(s.input.sensitivity, 0.1, 5, 0.1, (v) => (s.input.sensitivity = v))));
  panel.append(row('Mouse buttons', check(s.input.mouseButtons, (v) => (s.input.mouseButtons = v))));
  for (const i of [0, 1] as const) {
    const box = el('input', { value: s.input.keys[i], style: 'width:90px', readOnly: true });
    box.addEventListener('keydown', (e) => {
      e.preventDefault();
      if (e.code === 'Escape') return;
      s.input.keys = i === 0 ? [e.code, s.input.keys[1]] : [s.input.keys[0], e.code];
      box.value = e.code;
    });
    panel.append(row(`Key ${i + 1}`, box));
  }
  panel.append(row('Cursor', select([['system', 'System'], ['drawn', 'Drawn']], s.input.cursor, (v) => (s.input.cursor = v as 'system' | 'drawn'))));
  panel.append(row('Cursor size', number(s.input.cursorScale, 0.5, 2, 0.1, (v) => (s.input.cursorScale = v))));
  panel.append(row('Cursor trail', check(s.input.cursorTrail, (v) => (s.input.cursorTrail = v))));

  panel.append(el('h4', { style: 'margin:10px 0 2px' }, 'Audio'));
  panel.append(row('Master', number(s.audio.master, 0, 1, 0.05, (v) => (s.audio.master = v))));
  panel.append(row('Hits', number(s.audio.hits, 0, 1, 0.05, (v) => (s.audio.hits = v))));
  panel.append(row('Effects', number(s.audio.effects, 0, 1, 0.05, (v) => (s.audio.effects = v))));
  panel.append(row('Ambient', number(s.audio.ambient, 0, 1, 0.05, (v) => (s.audio.ambient = v))));
  panel.append(row('Muted', check(s.audio.muted, (v) => (s.audio.muted = v))));
  panel.append(row('Sound set', select(Object.entries(SOUND_SETS).map(([id, x]) => [id, x.label] as [string, string]), s.audio.soundSet, (v) => (s.audio.soundSet = v as SoundSetId))));
  const tests: [TestSound, string][] = [['hit', 'Hit'], ['miss', 'Miss'], ['combo', 'Combo'], ['tick', 'Tick'], ['metronome', 'Metronome'], ['countdown', 'Countdown']];
  panel.append(
    el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:4px 0' }, ...tests.map(([id, label]) => el('button', { textContent: label, click: () => playTestSound(form.settings, id) }))),
  );
  panel.append(row('Metronome', select([['off', 'Off'], ['beat', 'Every beat'], ['bar', 'Every bar']], s.audio.metronome, (v) => (s.audio.metronome = v as MetronomeMode))));
  panel.append(row('Metronome volume', number(s.audio.metronomeVolume, 0, 1, 0.05, (v) => (s.audio.metronomeVolume = v))));
  panel.append(row('Audio offset (ms)', number(s.audio.offsetMs, -100, 300, 1, (v) => (s.audio.offsetMs = v))));
  panel.append(
    el(
      'div',
      { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:4px 0' },
      el('button', { textContent: 'Visual calibration', click: () => calibrate('visual') }),
      el('button', { textContent: 'Audio calibration', click: () => calibrate('audio') }),
    ),
  );

  panel.append(el('h4', { style: 'margin:10px 0 2px' }, 'Display'));
  const d = s.display;
  panel.append(row('Error bar', check(d.errorBar, (v) => (d.errorBar = v))));
  panel.append(row('Path hints', check(d.pathHints, (v) => (d.pathHints = v))));
  panel.append(row('Crisp pop-ups', check(d.crispPopups, (v) => (d.crispPopups = v))));
  panel.append(row('Early and late', check(d.earlyLate, (v) => (d.earlyLate = v))));
  panel.append(row('Reduce motion', check(d.reduceMotion, (v) => (d.reduceMotion = v))));
  panel.append(row('Low latency canvas', check(d.lowLatency, (v) => (d.lowLatency = v))));
  panel.append(row('Show fps', check(d.showFps, (v) => (d.showFps = v))));
  panel.append(row('Frame graph', check(d.frameGraph, (v) => (d.frameGraph = v))));
  panel.append(row('Visual offset (ms)', number(d.visualOffsetMs, -50, 150, 1, (v) => (d.visualOffsetMs = v))));

  panel.append(el('h4', { style: 'margin:10px 0 2px' }, 'Skin'));
  panel.append(row('Palette', select(Object.entries(PALETTES).map(([id, p]) => [id, p.label] as [string, string]), s.skin.palette, (v) => (s.skin.palette = v as PaletteId))));
  panel.append(row('Approach', select([['ring', 'Ring'], ['fill', 'Fill'], ['brackets', 'Brackets']], s.skin.approach, (v) => (s.skin.approach = v as ApproachStyle))));
  panel.append(row('Cursor style', select([['ring', 'Ring'], ['cross', 'Cross'], ['dot', 'Dot']], s.skin.cursorStyle, (v) => (s.skin.cursorStyle = v as CursorStyle))));
  panel.append(row('Field grid', check(s.skin.fieldGrid, (v) => (s.skin.fieldGrid = v))));
  panel.append(row('Click ripple', check(s.skin.clickRipple, (v) => (s.skin.clickRipple = v))));

  panel.append(
    el(
      'div',
      { style: 'display:flex;gap:6px;margin:12px 0;flex-wrap:wrap' },
      el('button', { textContent: 'Play', style: 'padding:8px 16px;font-weight:600', click: play }),
      el('button', { textContent: 'Preview map', click: preview }),
      el('button', { textContent: 'Watch last play', click: watch }),
      el('button', { textContent: 'Autoplay demo', click: demo }),
      el('label', {}, check(demoMisses, (v) => (demoMisses = v)), ' demo player misses'),
    ),
  );
  panel.append(log, json);
}

/* ------------------------------------------------------------- the play */

function showPanel(on: boolean): void {
  panel.style.display = on ? 'block' : 'none';
  panelButton.style.display = on ? 'none' : 'block';
}

function play(): void {
  saveForm(form);
  playback?.destroy();
  playback = null;
  watchBar.style.display = 'none';
  handle?.destroy();
  pauseBox.style.display = 'none';
  showPanel(false);
  const l = launch();
  handle = createGame(canvas, l, structuredClone(form.settings), {
    onPause: (paused) => {
      pauseBox.style.display = paused ? 'flex' : 'none';
    },
    onFinish: (r) => {
      pauseBox.style.display = 'none';
      lastResult = r;
      report(r);
      showPanel(true);
      form.seed = Math.floor(Math.random() * 2 ** 32);
      build();
    },
    // Holding the retry key ends the play and starts the same map again.
    onRetry: (r) => {
      lastResult = r;
      report(r);
      play();
    },
    onError: (message) => {
      log.textContent = message;
      showPanel(true);
    },
  });
}

panelButton.addEventListener('click', () => {
  if (calibration) {
    stopCalibration();
    return;
  }
  handle?.quit();
});

/** Run a calibration screen on the canvas. A finished run puts its median into the matching offset setting. */
function calibrate(kind: CalibrationKind): void {
  saveForm(form);
  playback?.destroy();
  playback = null;
  handle?.destroy();
  handle = null;
  calibration?.destroy();
  watchBar.style.display = 'none';
  showPanel(false);
  log.textContent = '';
  calibration = createCalibration(canvas, kind, structuredClone(form.settings), {
    onTap: (taps, needed) => {
      log.textContent = `${kind} calibration, ${taps} of ${needed} taps`;
    },
    onDone: (r) => {
      const offset = Math.round(r.offsetMs);
      if (r.kind === 'visual') form.settings.display.visualOffsetMs = Math.max(-50, Math.min(150, offset));
      else form.settings.audio.offsetMs = Math.max(-100, Math.min(300, offset));
      log.textContent = `${kind} calibration done. Median ${r.offsetMs.toFixed(1)} ms, spread ${r.sdMs.toFixed(1)} ms, ${r.taps} taps. Applied ${offset} ms.`;
    },
    onError: (message) => {
      log.textContent = message;
      stopCalibration();
    },
  });
  (window as unknown as { __hbCal?: CalibrationHandle }).__hbCal = calibration;
}

function stopCalibration(): void {
  calibration?.destroy();
  calibration = null;
  showPanel(true);
  build();
}

/** Play the last play's replay back. The replay goes through the codec first, like a saved one does. */
function watch(): void {
  const replay = lastResult?.replay;
  if (!replay) {
    log.textContent = lastResult ? 'The last play has no replay.' : 'Play first, then watch it.';
    return;
  }
  let decoded: typeof replay;
  let bytes = 0;
  try {
    const encoded = encodeReplay(replay);
    bytes = encoded.byteLength;
    decoded = decodeReplay(encoded);
  } catch (err) {
    log.textContent = `The replay did not survive the codec: ${String(err)}`;
    return;
  }
  playback?.destroy();
  handle?.destroy();
  showPanel(false);
  panelButton.style.display = 'none';
  watchBar.replaceChildren();
  watchBar.style.display = 'flex';
  const status = el('span', { style: 'min-width:260px' }, 'Loading');
  const slider = el('input', { type: 'range', min: 0, max: 1, step: 1, value: 0, style: 'flex:1' });
  let dragging = false;
  slider.addEventListener('input', () => {
    dragging = true;
    playback?.seek(Number(slider.value));
  });
  slider.addEventListener('change', () => {
    dragging = false;
  });
  const speed = select(['0.25', '0.5', '1', '1.5', '2'].map((v) => [v, `${v}x`] as [string, string]), '1', (v) => playback?.setSpeed(Number(v)));
  watchBar.append(
    el('button', { textContent: 'Play', click: () => playback?.play() }),
    el('button', { textContent: 'Pause', click: () => playback?.pause() }),
    speed,
    slider,
    status,
    el('button', { textContent: 'Back to the harness', click: stopWatching }),
  );
  let duration = 0;
  let mismatches = 0;
  const say = (t: number) => {
    status.textContent = `${(t / 1000).toFixed(1)} of ${(duration / 1000).toFixed(1)} s, ${mismatches} judgments differ, ${(bytes / 1024).toFixed(0)} kB raw`;
  };
  playback = createPlayback(canvas, { kind: 'replay', replay: decoded }, structuredClone(form.settings), {
    onReady: (info) => {
      duration = info.durationMs;
      mismatches = info.mismatches;
      slider.max = String(Math.ceil(duration));
      say(0);
      playback?.play();
    },
    onTime: (t) => {
      if (!dragging) slider.value = String(Math.round(t));
      say(t);
    },
    onEnd: () => {
      status.textContent = `Done. ${mismatches} judgments differ.`;
    },
    onError: (message) => {
      status.textContent = message;
    },
  });
}

/** Watch a simulated player on this launch, looping. Used to look at the skin, and by the screenshot scripts. */
function demo(): void {
  saveForm(form);
  playback?.destroy();
  handle?.destroy();
  showPanel(false);
  panelButton.style.display = 'none';
  watchBar.style.display = 'none';
  const win = window as unknown as { __hb?: { playback: PlaybackHandle | null; launch: LaunchRequest } };
  // A sloppy player misses now and then, which the skin needs to show.
  const source: PlaybackSource = demoMisses
    ? { kind: 'replay', replay: autoplayReplay(launch(), { ...NOISY_PLAYER, name: 'sloppy', sigmaT: 55, sigmaAim: 0.75, trackNoise: 0.9 }) }
    : { kind: 'autoplay', launch: launch(), loop: true };
  playback = createPlayback(canvas, source, structuredClone(form.settings), {
    onReady: () => playback?.play(),
    onTime: () => undefined,
    onEnd: () => undefined,
    onError: (message) => {
      log.textContent = message;
      showPanel(true);
    },
  });
  win.__hb = { playback, launch: launch() };
}

function stopWatching(): void {
  playback?.destroy();
  playback = null;
  watchBar.style.display = 'none';
  showPanel(true);
}

function preview(): void {
  const t0 = performance.now();
  try {
    const p = previewLaunch(launch());
    const dt = performance.now() - t0;
    const counts = { circle: 0, slider: 0, spinner: 0 };
    for (const o of p.map.objects) counts[o.kind]++;
    log.textContent = `Preview in ${dt.toFixed(1)} ms\nObjects ${p.map.objects.length} (circles ${counts.circle}, sliders ${counts.slider}, spinners ${counts.spinner})\nDuration ${(p.map.durationMs / 1000).toFixed(1)} s\nBeat ${p.map.beatMs.toFixed(1)} ms, rate ${p.map.rate}\nSections ${p.map.sections.length}`;
  } catch (err) {
    log.textContent = String(err);
  }
}

/** Check a result against the contract and list what is off. */
function problems(r: PlayResult): string[] {
  const out: string[] = [];
  if (r.recordVersion !== RECORD_VERSION) out.push('recordVersion');
  if (r.engineVersion !== ENGINE_VERSION) out.push('engineVersion');
  if (r.records.length !== r.counts.crisp + r.counts.solid + r.counts.rough + r.counts.miss) out.push('record count');
  r.records.forEach((rec, i) => {
    if (i > 0 && rec.index <= (r.records[i - 1]?.index ?? -1)) out.push(`order at ${i}`);
    if (rec.kind === 'circle' && rec.headJudgment !== rec.judgment) out.push(`head at ${i}`);
    if (rec.kind === 'spinner' && rec.spinner === null) out.push(`spinner stats at ${i}`);
    if (rec.kind === 'slider' && rec.slider === null) out.push(`slider stats at ${i}`);
  });
  return out;
}

function report(r: PlayResult): void {
  const bad = problems(r);
  const c = r.counts;
  log.textContent = [
    `Status ${r.status}, played ${(r.playedMs / 1000).toFixed(1)} s`,
    `Score ${r.score}, accuracy ${(r.accuracy * 100).toFixed(2)}%, max combo ${r.maxCombo}`,
    `Crisp ${c.crisp}, Solid ${c.solid}, Rough ${c.rough}, Miss ${c.miss}`,
    `Slider parts ${r.sliderParts.hit} of ${r.sliderParts.total}, stray presses ${r.strayPresses}, pauses ${r.pauses}`,
    `Input ${JSON.stringify(r.input)}`,
    r.levels.length > 0 ? `Levels ${r.levels.map((s) => `${s.module} ${s.level} (${Math.round(s.success * 100)}%)`).join(', ')}` : '',
    r.levels.length > 0 ? `Final levels ${JSON.stringify(r.finalLevels)}` : '',
    bad.length > 0 ? `Contract problems ${bad.join(', ')}` : 'Contract check passed',
  ]
    .filter(Boolean)
    .join('\n');
  json.value = JSON.stringify(r, null, 1);
}

build();
showPanel(true);
