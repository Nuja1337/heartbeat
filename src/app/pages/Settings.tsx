import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ImportError, buildExport, exportBytes, importBytes } from '../../data/exportImport';
import type { ImportReport } from '../../data/exportImport';
import { currentPersisted, getLastExport, storageEstimate } from '../../data/meta';
import { deleteAllData } from '../../data/plays';
import { replayStorage } from '../../data/replays';
import { RETENTION_CHOICES } from '../../data/settings';
import { PALETTES, REPLAY_LIMIT_CHOICES, RETRY_HOLD_MS, SETTING_RANGES, SHARE_CODE_VERSION, SOUND_SETS } from '../../shared/catalog';
import type { ApproachStyle, CursorStyle, MetronomeMode, PaletteId, SoundSetId, TestSound } from '../../shared/types';
import { KeyCapture } from '../components/KeyCapture';
import { OffsetField } from '../components/OffsetField';
import { SkinPreview } from '../components/SkinPreview';
import { Button, Card, Field, Notice, PageHeader, Segmented, SectionTitle, Slider, Toggle, keyLabel } from '../components/ui';
import { INTRO } from '../copy';
import { bytes, dateTime } from '../format';
import { invalidateAnalysis, useAnalysis } from '../state/analysis';
import { loadGame, useGame } from '../state/engine';
import { promptInstall, usePwa } from '../pwa';
import { useSettings } from '../state/store';

const RETENTION_LABEL = (d: number | null) => (d === null ? 'Forever' : `${d} days`);
const REPLAY_LIMIT_LABEL = (n: number | null) => (n === null ? 'All' : String(n));
const percent = (v: number) => `${Math.round(v * 100)}%`;

const SECTIONS = [
  ['input', 'Input'],
  ['look', 'Look'],
  ['sound', 'Sound'],
  ['timing', 'Timing'],
  ['display', 'Display'],
  ['goals', 'Goals'],
  ['data', 'Data'],
  ['app', 'App'],
] as const;

const TEST_SOUNDS: { sound: TestSound; label: string }[] = [
  { sound: 'hit', label: 'Hit' },
  { sound: 'miss', label: 'Miss' },
  { sound: 'combo', label: 'Combo' },
  { sound: 'tick', label: 'Tick' },
  { sound: 'metronome', label: 'Metronome' },
  { sound: 'countdown', label: 'Countdown' },
];

/** Why a key can't be the retry key, or null when it can. */
export function rejectRetryKey(code: string, hitKeys: readonly string[]): string | null {
  if (code === 'Escape') return "Esc is used to pause, so it can't be the retry key.";
  if (code === 'Tab') return "Tab moves between controls, so it can't be the retry key.";
  if (hitKeys.includes(code)) return "The retry key can't be one of the hit keys.";
  return null;
}

/** About how large an export with every stored replay is. The replays are stored gzipped and the file writes them as base64. */
export function replayExportMb(storedBytes: number): string {
  const mb = (storedBytes * 4) / 3 / 1024 ** 2;
  return mb < 0.1 ? 'under 0.1 MB' : `${mb.toFixed(1)} MB`;
}

function Section({ id, title, children }: { id: (typeof SECTIONS)[number][0]; title: string; children: ReactNode }) {
  return (
    <div id={`settings-${id}`} className="mb-6 scroll-mt-20 break-inside-avoid">
      <Card>
        <SectionTitle>{title}</SectionTitle>
        {children}
      </Card>
    </div>
  );
}

export function Settings() {
  const [s, update] = useSettings();
  const { data } = useAnalysis();
  const lastInput = data?.summaries[0]?.input ?? null;
  const { game } = useGame();
  const { canInstall } = usePwa();

  const test = (sound: TestSound) => {
    try {
      game?.playTestSound(s, sound);
    } catch {
      // The engine may not be available yet.
    }
  };

  const setInput = (patch: Partial<typeof s.input>) => update((x) => ({ ...x, input: { ...x.input, ...patch } }));
  const setAudio = (patch: Partial<typeof s.audio>) => update((x) => ({ ...x, audio: { ...x.audio, ...patch } }));
  const setDisplay = (patch: Partial<typeof s.display>) => update((x) => ({ ...x, display: { ...x.display, ...patch } }));
  const setSkin = (patch: Partial<typeof s.skin>) => update((x) => ({ ...x, skin: { ...x.skin, ...patch } }));

  // A hit key can't also be the retry key, so picking it for a hit key turns the retry key off.
  const setHitKey = (slot: 0 | 1, code: string) =>
    update((x) => {
      const keys: [string, string] = [...x.input.keys];
      keys[slot] = code;
      return { ...x, input: { ...x.input, keys, retryKey: x.input.retryKey === code ? '' : x.input.retryKey } };
    });

  return (
    <>
      <PageHeader title="Settings" intro={INTRO.settings} />
      <nav aria-label="Settings sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#settings-${id}`} className="shrink-0 whitespace-nowrap px-3 py-2 text-ink-2 transition hover:text-ink">
            {label}
          </a>
        ))}
      </nav>

      <div className="lg:columns-2 lg:gap-6">
        <Section id="input" title="Input">
          <Toggle
            label="Raw input"
            help="Locks the pointer and reads mouse movement directly. Turn it off if the cursor feels wrong or your device is a pen or tablet."
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
          <KeyCapture label="Hit key 1" value={s.input.keys[0]} other={s.input.keys[1]} onChange={(code) => setHitKey(0, code)} />
          <KeyCapture label="Hit key 2" value={s.input.keys[1]} other={s.input.keys[0]} onChange={(code) => setHitKey(1, code)} />
          <RetryKeyField value={s.input.retryKey} hitKeys={s.input.keys} onChange={(code) => setInput({ retryKey: code })} />
          <Toggle
            label="Mouse buttons count as hits"
            help="Left and right buttons, and a pen tip and barrel button."
            checked={s.input.mouseButtons}
            onChange={(v) => setInput({ mouseButtons: v })}
          />
          <Field label="Cursor" help="The system cursor has the least delay. Raw input always draws its own cursor.">
            <Segmented
              legend="Cursor"
              value={s.input.cursor}
              options={[
                { value: 'system', label: 'System' },
                { value: 'drawn', label: 'Drawn' },
              ]}
              onChange={(v) => setInput({ cursor: v })}
            />
          </Field>
          <p className="mt-2 text-sm text-ink-2">
            The hit keys are {keyLabel(s.input.keys[0])} and {keyLabel(s.input.keys[1])}. Esc pauses and can't be changed.
          </p>
          <div className="mt-4 border-t border-line pt-4">
            <h3 className="mb-2 text-sm text-ink-2">Detected on your last play</h3>
            {lastInput ? (
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-ink-2">Pointer</dt>
                <dd>{lastInput.pointer ?? 'unknown'}</dd>
                <dt className="text-ink-2">Pointer rate</dt>
                <dd>{lastInput.pointerHz ? `${Math.round(lastInput.pointerHz)} Hz` : 'unknown'}</dd>
                <dt className="text-ink-2">Display rate</dt>
                <dd>{lastInput.displayHz ? `${Math.round(lastInput.displayHz)} Hz` : 'unknown'}</dd>
                <dt className="text-ink-2">Raw input</dt>
                <dd>{lastInput.rawInput ? (lastInput.unadjusted ? 'on, without acceleration' : 'on, the browser kept acceleration') : 'off'}</dd>
              </dl>
            ) : (
              <p className="text-sm text-ink-2">Play once and the rates your browser reported will show up here.</p>
            )}
          </div>
        </Section>

        <Section id="look" title="Look">
          <SkinPreview settings={s} />
          <Field label="Palette">
            <div role="radiogroup" aria-label="Palette" className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(PALETTES) as PaletteId[]).map((id) => {
                const p = PALETTES[id];
                return (
                  <label key={id} className="fw-choice">
                    <input type="radio" name="palette" className="sr-only" checked={s.skin.palette === id} onChange={() => setSkin({ palette: id })} />
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-display font-semibold">{p.label}</span>
                      <span aria-hidden className="flex gap-1">
                        {p.groups.map((c) => (
                          <span key={c} className="size-3 rounded-full" style={{ background: c }} />
                        ))}
                      </span>
                    </span>
                    <span className="block text-sm text-ink-2">{p.description}</span>
                  </label>
                );
              })}
            </div>
          </Field>
          <Field label="Cursor style">
            <Segmented
              legend="Cursor style"
              value={s.skin.cursorStyle}
              options={[
                { value: 'ring', label: 'Ring' },
                { value: 'cross', label: 'Cross' },
                { value: 'dot', label: 'Dot' },
              ] satisfies { value: CursorStyle; label: string }[]}
              onChange={(v) => setSkin({ cursorStyle: v })}
            />
          </Field>
          <Field label="Approach style" help="How a target shows the time you have left.">
            <Segmented
              legend="Approach style"
              value={s.skin.approach}
              options={[
                { value: 'ring', label: 'Ring' },
                { value: 'fill', label: 'Fill' },
                { value: 'brackets', label: 'Brackets' },
              ] satisfies { value: ApproachStyle; label: string }[]}
              onChange={(v) => setSkin({ approach: v })}
            />
          </Field>
          <Slider
            label="Cursor size"
            value={s.input.cursorScale}
            min={0.5}
            max={2}
            step={0.05}
            format={(v) => `${v.toFixed(2)}x`}
            onChange={(v) => setInput({ cursorScale: v })}
          />
          <Toggle label="Field grid" help="A faint grid on the playfield." checked={s.skin.fieldGrid} onChange={(v) => setSkin({ fieldGrid: v })} />
          <Toggle label="Cursor trail" checked={s.input.cursorTrail} onChange={(v) => setInput({ cursorTrail: v })} />
          <Toggle label="Click ripple" help="A ring that spreads from every click." checked={s.skin.clickRipple} onChange={(v) => setSkin({ clickRipple: v })} />
        </Section>

        <Section id="sound" title="Sound">
          <Toggle label="Mute all sound" checked={s.audio.muted} onChange={(v) => setAudio({ muted: v })} />
          <Field label="Sound set" help={SOUND_SETS[s.audio.soundSet].description}>
            <Segmented
              legend="Sound set"
              value={s.audio.soundSet}
              options={(Object.keys(SOUND_SETS) as SoundSetId[]).map((id) => ({ value: id, label: SOUND_SETS[id].label }))}
              onChange={(v) => setAudio({ soundSet: v })}
            />
          </Field>
          <Field label="Try the sounds">
            <div className="flex flex-wrap gap-2">
              {TEST_SOUNDS.map(({ sound, label }) => (
                <Button key={sound} size="sm" onClick={() => test(sound)}>
                  {label}
                </Button>
              ))}
            </div>
          </Field>
          <Slider label="Master volume" value={s.audio.master} min={0} max={1} step={0.01} format={percent} onChange={(v) => setAudio({ master: v })} />
          <Slider label="Hit sounds" value={s.audio.hits} min={0} max={1} step={0.01} format={percent} onChange={(v) => setAudio({ hits: v })} />
          <Slider label="Effects" value={s.audio.effects} min={0} max={1} step={0.01} format={percent} onChange={(v) => setAudio({ effects: v })} />
          <Slider label="Ambient" value={s.audio.ambient} min={0} max={1} step={0.01} format={percent} onChange={(v) => setAudio({ ambient: v })} />
          <Field label="Metronome" help="A click on the beat, or on the first beat of every bar.">
            <Segmented
              legend="Metronome"
              value={s.audio.metronome}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'beat', label: 'Every beat' },
                { value: 'bar', label: 'Every bar' },
              ] satisfies { value: MetronomeMode; label: string }[]}
              onChange={(v) => setAudio({ metronome: v })}
            />
          </Field>
          <Slider
            label="Metronome volume"
            value={s.audio.metronomeVolume}
            min={SETTING_RANGES.metronomeVolume.min}
            max={SETTING_RANGES.metronomeVolume.max}
            step={SETTING_RANGES.metronomeVolume.step}
            format={percent}
            disabled={s.audio.metronome === 'off'}
            onChange={(v) => setAudio({ metronomeVolume: v })}
          />
        </Section>

        <Section id="timing" title="Timing">
          <OffsetField
            label="Visual offset"
            help="Positive values draw targets earlier. Use it if targets seem to arrive late."
            value={s.display.visualOffsetMs}
            min={SETTING_RANGES.visualOffsetMs.min}
            max={SETTING_RANGES.visualOffsetMs.max}
            step={SETTING_RANGES.visualOffsetMs.step}
            calibrate="visual"
            onChange={(v) => setDisplay({ visualOffsetMs: v })}
          />
          <OffsetField
            label="Audio offset"
            help="The metronome plays this many milliseconds earlier. Hit sounds always play at once."
            value={s.audio.offsetMs}
            min={SETTING_RANGES.audioOffsetMs.min}
            max={SETTING_RANGES.audioOffsetMs.max}
            step={SETTING_RANGES.audioOffsetMs.step}
            calibrate="audio"
            onChange={(v) => setAudio({ offsetMs: v })}
          />
        </Section>

        <Section id="display" title="Display">
          <Toggle label="Error bar" help="Shows where each click landed in time." checked={s.display.errorBar} onChange={(v) => setDisplay({ errorBar: v })} />
          <Toggle label="Path hints" help="Faint lines between targets." checked={s.display.pathHints} onChange={(v) => setDisplay({ pathHints: v })} />
          <Toggle label="Crisp pop-ups" help="Shows a word on every Crisp hit. Solid, Rough and Miss always show." checked={s.display.crispPopups} onChange={(v) => setDisplay({ crispPopups: v })} />
          <Toggle label="Early and late marks" checked={s.display.earlyLate} onChange={(v) => setDisplay({ earlyLate: v })} />
          <Toggle label="Reduce motion" checked={s.display.reduceMotion} onChange={(v) => setDisplay({ reduceMotion: v })} />
          <Toggle label="Low latency canvas" help="Applies from the next play. Turn it off if you see flicker." checked={s.display.lowLatency} onChange={(v) => setDisplay({ lowLatency: v })} />
          <Toggle label="Show frame rate" checked={s.display.showFps} onChange={(v) => setDisplay({ showFps: v })} />
          <Toggle label="Frame graph" help="Draws the time of recent frames in a play. Use it to find stutter." checked={s.display.frameGraph} onChange={(v) => setDisplay({ frameGraph: v })} />
        </Section>

        <Section id="goals" title="Goals">
          <Slider
            label="Weekly goal"
            value={s.goals.weeklyMinutes}
            min={SETTING_RANGES.weeklyMinutes.min}
            max={SETTING_RANGES.weeklyMinutes.max}
            step={SETTING_RANGES.weeklyMinutes.step}
            format={(v) => (v === 0 ? 'No goal' : `${v} min`)}
            help="Minutes of play a week. Set it to 0 for no goal."
            onChange={(v) => update((x) => ({ ...x, goals: { ...x.goals, weeklyMinutes: v } }))}
          />
        </Section>

        <DataSection />

        <Section id="app" title="App">
          <AppInfo />
          {canInstall && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="text-sm text-ink-2">Install Flickwise to open it from your desktop or home screen and play without a connection.</p>
              <Button variant="primary" className="mt-3" onClick={() => void promptInstall()}>
                Install
              </Button>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}

/** Click, then press a key. Escape, Tab and the hit keys are refused. "Turn off" clears it. */
function RetryKeyField({ value, hitKeys, onChange }: { value: string; hitKeys: readonly string[]; onChange(code: string): void }) {
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setListening(false);
      const why = rejectRetryKey(e.code, hitKeys);
      setMessage(why);
      if (!why) onChange(e.code);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, hitKeys, onChange]);

  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <span>Retry key</span>
        <span className="flex items-center gap-2">
          {value !== '' && (
            <Button size="sm" variant="ghost" onClick={() => onChange('')}>
              Turn off
            </Button>
          )}
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setListening(true);
            }}
            onBlur={() => setListening(false)}
            className="min-w-24 rounded-md border border-line-2 bg-bg px-3 py-1.5 font-mono text-sm hover:border-ink-3"
            aria-label={`Retry key, currently ${value === '' ? 'off' : keyLabel(value)}. Press to change.`}
          >
            {listening ? 'Press a key' : value === '' ? 'Off' : keyLabel(value)}
          </button>
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-2">Hold it for {RETRY_HOLD_MS / 1000} seconds during a play to start the map again.</p>
      {message && (
        <p role="status" className="mt-1 text-sm text-warn">
          {message}
        </p>
      )}
    </div>
  );
}

function AppInfo() {
  const { game } = useGame();
  const rows: [string, string][] = [
    ['Game engine', game ? String(game.ENGINE_VERSION) : 'loading'],
    ['Map generator', game ? String(game.GENERATOR_VERSION) : 'loading'],
    ['Share link format', String(SHARE_CODE_VERSION)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-ink-2">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Saves the export as a download. Resolves with the number of plays in it. */
async function saveExport(gzip: boolean, includeReplays: boolean): Promise<number> {
  const g = await loadGame();
  const file = await buildExport({ engineVersion: g.ENGINE_VERSION, generatorVersion: g.GENERATOR_VERSION }, { includeReplays });
  const data = await exportBytes(file, gzip);
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: gzip ? 'application/gzip' : 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `flickwise-${new Date().toISOString().slice(0, 10)}.json${gzip ? '.gz' : ''}`;
  a.click();
  URL.revokeObjectURL(url);
  return file.plays.length;
}

function DataSection() {
  const [s, update] = useSettings();
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [lastExport, setLastExport] = useState<number | undefined>();
  const [replays, setReplays] = useState<{ count: number; bytes: number } | null>(null);
  const [includeReplays, setIncludeReplays] = useState(true);
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => {
    storageEstimate().then(setUsage);
    currentPersisted().then(setPersisted);
    getLastExport().then(setLastExport).catch(() => undefined);
    replayStorage().then(setReplays).catch(() => undefined);
  };
  useEffect(refresh, []);

  const doExport = async (gzip: boolean) => {
    setBusy(true);
    try {
      const count = await saveExport(gzip, includeReplays && (replays?.count ?? 0) > 0);
      setMessage({ tone: 'good', text: `Exported ${count} plays.` });
      refresh();
    } catch (e) {
      setMessage({ tone: 'bad', text: e instanceof Error ? e.message : 'The export failed.' });
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (file: File) => {
    setBusy(true);
    try {
      const report: ImportReport = await importBytes(new Uint8Array(await file.arrayBuffer()));
      invalidateAnalysis();
      setMessage({
        tone: 'good',
        text: `Added ${report.playsAdded} plays and skipped ${report.playsSkipped} that were already here.${report.tombstonesApplied ? ` Removed ${report.tombstonesApplied} that the file marks as deleted.` : ''}`,
      });
      refresh();
    } catch (e) {
      setMessage({ tone: 'bad', text: e instanceof ImportError ? e.message : 'The file could not be imported.' });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const askPersist = async () => {
    try {
      const ok = await navigator.storage?.persist?.();
      setPersisted(ok ?? null);
    } catch {
      setPersisted(null);
    }
  };

  const wipe = async () => {
    setBusy(true);
    try {
      await deleteAllData();
      invalidateAnalysis();
      setMessage({ tone: 'good', text: 'All plays, progress and drills were deleted. Your settings stay.' });
    } catch (e) {
      setMessage({ tone: 'bad', text: e instanceof Error ? e.message : 'Deleting failed.' });
    } finally {
      setConfirming(false);
      setBusy(false);
      refresh();
    }
  };

  const hasReplays = (replays?.count ?? 0) > 0;

  return (
    <Section id="data" title="Data">
      <p className="text-sm text-ink-2">Everything is stored in this browser only. Export a file to keep a copy or move to another browser.</p>
      <Toggle
        label={replays === null ? 'Include replays' : hasReplays ? `Include replays (about ${replayExportMb(replays.bytes)})` : 'Include replays (none stored)'}
        help="Without replays the file is much smaller. Plays and stats are always included."
        checked={includeReplays && hasReplays}
        disabled={!hasReplays}
        onChange={setIncludeReplays}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void doExport(false)}>Export (.json)</Button>
        <Button disabled={busy} onClick={() => void doExport(true)}>Export (.json.gz)</Button>
        <Button disabled={busy} onClick={() => fileInput.current?.click()}>Import</Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.gz,application/json,application/gzip"
          className="sr-only"
          aria-label="Import file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
          }}
        />
      </div>
      {message && (
        <div className="mt-3">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}
      <dl className="mt-4 grid grid-cols-2 gap-y-1 text-sm">
        <dt className="text-ink-2">Space used</dt>
        <dd>{usage ? `${bytes(usage.usage)} of ${bytes(usage.quota)}` : 'unknown'}</dd>
        <dt className="text-ink-2">Replays stored</dt>
        <dd>{replays ? `${replays.count}, ${bytes(replays.bytes)}` : 'unknown'}</dd>
        <dt className="text-ink-2">Kept by the browser</dt>
        <dd>
          {persisted === null ? 'unknown' : persisted ? 'Yes' : 'No, the browser may clear it'}
          {persisted === false && (
            <Button size="sm" variant="ghost" className="ml-2" onClick={() => void askPersist()}>
              Ask again
            </Button>
          )}
        </dd>
        <dt className="text-ink-2">Last export</dt>
        <dd>{lastExport ? dateTime(lastExport) : 'never'}</dd>
      </dl>
      {persisted === false && <p className="mt-2 text-sm text-warn">The browser has not promised to keep this data. Export a file now and then.</p>}

      <Field label="Keep the newest replays" help="Replays you mark to keep are never removed. Older ones are removed the next time Flickwise starts.">
        <Segmented
          legend="Replay limit"
          value={String(s.data.replayLimit)}
          options={REPLAY_LIMIT_CHOICES.map((n) => ({ value: String(n), label: REPLAY_LIMIT_LABEL(n) }))}
          onChange={(v) => update((x) => ({ ...x, data: { ...x.data, replayLimit: v === 'null' ? null : Number(v) } }))}
        />
      </Field>

      <Field label="Keep per-object detail for" help="Older detail is removed. Play summaries, ratings, trends and bests are always kept.">
        <Segmented
          legend="Detail retention"
          value={String(s.data.detailRetentionDays)}
          options={RETENTION_CHOICES.map((d) => ({ value: String(d), label: RETENTION_LABEL(d) }))}
          onChange={(v) => update((x) => ({ ...x, data: { ...x.data, detailRetentionDays: v === 'null' ? null : Number(v) } }))}
        />
      </Field>

      <div className="mt-4 border-t border-line pt-4">
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">This removes every play, progress and drill.</span>
            <Button variant="danger" disabled={busy} onClick={() => void wipe()}>Yes, delete everything</Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setConfirming(true)}>Delete all data</Button>
        )}
      </div>
    </Section>
  );
}
