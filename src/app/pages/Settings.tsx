import { useEffect, useRef, useState } from 'react';
import { buildExport, exportBytes, ImportError, importBytes } from '../../data/exportImport';
import type { ImportReport } from '../../data/exportImport';
import { currentPersisted, getLastExport, storageEstimate } from '../../data/meta';
import { deleteAllData } from '../../data/plays';
import { RETENTION_CHOICES } from '../../data/settings';
import { ENGINE_VERSION, GENERATOR_VERSION, playTestSound } from '../../game/index';
import { KeyCapture } from '../components/KeyCapture';
import { Button, Card, Field, Notice, PageHeader, Segmented, SectionTitle, Slider, Toggle, keyLabel } from '../components/ui';
import { INTRO } from '../copy';
import { bytes, dateTime } from '../format';
import { invalidateAnalysis, useAnalysis } from '../state/analysis';
import { useSettings } from '../state/store';

const RETENTION_LABEL = (d: number | null) => (d === null ? 'Forever' : `${d} days`);

export function Settings() {
  const [s, update] = useSettings();
  const { data } = useAnalysis();
  const lastInput = data?.summaries[0]?.input ?? null;

  const test = (sound: 'hit' | 'miss' | 'combo') => {
    try {
      playTestSound(s, sound);
    } catch {
      // The engine may not be available yet.
    }
  };

  return (
    <>
      <PageHeader title="Settings" intro={INTRO.settings} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle>Input</SectionTitle>
          <Toggle
            label="Raw input"
            help="Locks the pointer and reads mouse movement directly. Turn it off if the cursor feels wrong or your device is a pen or tablet."
            checked={s.input.rawInput}
            onChange={(v) => update((x) => ({ ...x, input: { ...x.input, rawInput: v } }))}
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
            onChange={(v) => update((x) => ({ ...x, input: { ...x.input, sensitivity: v } }))}
          />
          <KeyCapture
            label="Hit key 1"
            value={s.input.keys[0]}
            other={s.input.keys[1]}
            onChange={(code) => update((x) => ({ ...x, input: { ...x.input, keys: [code, x.input.keys[1]] } }))}
          />
          <KeyCapture
            label="Hit key 2"
            value={s.input.keys[1]}
            other={s.input.keys[0]}
            onChange={(code) => update((x) => ({ ...x, input: { ...x.input, keys: [x.input.keys[0], code] } }))}
          />
          <Toggle
            label="Mouse buttons count as hits"
            help="Left and right buttons, and a pen tip and barrel button."
            checked={s.input.mouseButtons}
            onChange={(v) => update((x) => ({ ...x, input: { ...x.input, mouseButtons: v } }))}
          />
          <Field label="Cursor" help="The system cursor has the least delay. Raw input always draws its own cursor.">
            <Segmented
              legend="Cursor"
              value={s.input.cursor}
              options={[
                { value: 'system', label: 'System' },
                { value: 'drawn', label: 'Drawn' },
              ]}
              onChange={(v) => update((x) => ({ ...x, input: { ...x.input, cursor: v } }))}
            />
          </Field>
          <Slider
            label="Cursor size"
            value={s.input.cursorScale}
            min={0.5}
            max={2}
            step={0.05}
            format={(v) => `${v.toFixed(2)}x`}
            onChange={(v) => update((x) => ({ ...x, input: { ...x.input, cursorScale: v } }))}
          />
          <Toggle
            label="Cursor trail"
            checked={s.input.cursorTrail}
            onChange={(v) => update((x) => ({ ...x, input: { ...x.input, cursorTrail: v } }))}
          />
          <p className="mt-2 text-sm text-ink-2">
            The hit keys are {keyLabel(s.input.keys[0])} and {keyLabel(s.input.keys[1])}. Esc pauses and can't be changed.
          </p>
        </Card>

        <div className="space-y-6">
          <Card>
            <SectionTitle>Audio</SectionTitle>
            <Toggle label="Mute all sound" checked={s.audio.muted} onChange={(v) => update((x) => ({ ...x, audio: { ...x.audio, muted: v } }))} />
            <Slider label="Master volume" value={s.audio.master} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update((x) => ({ ...x, audio: { ...x.audio, master: v } }))} />
            <Slider label="Hit sounds" value={s.audio.hits} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update((x) => ({ ...x, audio: { ...x.audio, hits: v } }))} />
            <Slider label="Effects" value={s.audio.effects} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update((x) => ({ ...x, audio: { ...x.audio, effects: v } }))} />
            <Slider label="Ambient" value={s.audio.ambient} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update((x) => ({ ...x, audio: { ...x.audio, ambient: v } }))} />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => test('hit')}>Test hit</Button>
              <Button size="sm" onClick={() => test('miss')}>Test miss</Button>
              <Button size="sm" onClick={() => test('combo')}>Test combo</Button>
            </div>
          </Card>

          <Card>
            <SectionTitle>Display</SectionTitle>
            <Toggle label="Error bar" help="Shows where each click landed in time." checked={s.display.errorBar} onChange={(v) => update((x) => ({ ...x, display: { ...x.display, errorBar: v } }))} />
            <Toggle label="Path hints" help="Faint lines between targets." checked={s.display.pathHints} onChange={(v) => update((x) => ({ ...x, display: { ...x.display, pathHints: v } }))} />
            <Toggle label="Crisp pop-ups" help="Shows a word on every Crisp hit. Solid, Rough and Miss always show." checked={s.display.crispPopups} onChange={(v) => update((x) => ({ ...x, display: { ...x.display, crispPopups: v } }))} />
            <Toggle label="Early and late marks" checked={s.display.earlyLate} onChange={(v) => update((x) => ({ ...x, display: { ...x.display, earlyLate: v } }))} />
            <Toggle label="Reduce motion" checked={s.display.reduceMotion} onChange={(v) => update((x) => ({ ...x, display: { ...x.display, reduceMotion: v } }))} />
            <Toggle label="Low latency canvas" help="Applies from the next play. Turn it off if you see flicker." checked={s.display.lowLatency} onChange={(v) => update((x) => ({ ...x, display: { ...x.display, lowLatency: v } }))} />
            <Toggle label="Show frame rate" checked={s.display.showFps} onChange={(v) => update((x) => ({ ...x, display: { ...x.display, showFps: v } }))} />
          </Card>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle>Detected on your last play</SectionTitle>
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
            <p className="text-ink-2">Play once and the rates your browser reported will show up here.</p>
          )}
        </Card>
        <DataCard />
      </div>
    </>
  );
}

function DataCard() {
  const [s, update] = useSettings();
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [lastExport, setLastExport] = useState<number | undefined>();
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => {
    storageEstimate().then(setUsage);
    currentPersisted().then(setPersisted);
    getLastExport().then(setLastExport).catch(() => undefined);
  };
  useEffect(refresh, []);

  const doExport = async (gzip: boolean) => {
    setBusy(true);
    try {
      const file = await buildExport({ engineVersion: ENGINE_VERSION, generatorVersion: GENERATOR_VERSION });
      const bytesOut = await exportBytes(file, gzip);
      const blob = new Blob([bytesOut as BlobPart], { type: gzip ? 'application/gzip' : 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flickwise-${new Date().toISOString().slice(0, 10)}.json${gzip ? '.gz' : ''}`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage({ tone: 'good', text: `Exported ${file.plays.length} plays.` });
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

  return (
    <Card>
      <SectionTitle>Data</SectionTitle>
      <p className="text-sm text-ink-2">Everything is stored in this browser only. Export a file to keep a copy or move to another browser.</p>
      <div className="mt-3 flex flex-wrap gap-2">
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
      {persisted === false && <p className="mt-2 text-sm text-rough">The browser has not promised to keep this data. Export a file now and then.</p>}

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
    </Card>
  );
}
