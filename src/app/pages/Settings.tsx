import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { ImportError, importBytes } from '../../data/exportImport';
import type { ImportReport } from '../../data/exportImport';
import { currentPersisted, getLastExport, storageEstimate } from '../../data/meta';
import { deleteAllData } from '../../data/plays';
import { countReplayRemovals, replayStorage } from '../../data/replays';
import { RETENTION_CHOICES } from '../../data/settings';
import { PALETTES, REPLAY_LIMIT_CHOICES, RETRY_HOLD_MS, SETTING_RANGES, SHARE_CODE_VERSION, SOUND_SETS } from '../../shared/catalog';
import { LOCALES } from '../../shared/locales';
import type { LanguageChoice } from '../../shared/locales';
import type { TextSize, ThemeChoice } from '../../shared/theme';
import type { ApproachStyle, CursorStyle, MetronomeMode, PaletteId, SoundSetId, TestSound } from '../../shared/types';
import { KeyCapture } from '../components/KeyCapture';
import { OffsetField } from '../components/OffsetField';
import { SkinPreview } from '../components/SkinPreview';
import { Button, Card, Field, Notice, PageHeader, Segmented, SectionTitle, Slider, Toggle, keyLabel } from '../components/ui';
import { INTRO } from '../copy';
import { bytes, dateTime } from '../format';
import { invalidateAnalysis, useAnalysis } from '../state/analysis';
import { useGame } from '../state/engine';
import { saveExport } from '../state/exportFile';
import { promptInstall, usePwa } from '../pwa';
import { useSettings } from '../state/store';
import { msg, t, tx } from '../i18n';
import { formatNumber } from '../../shared/i18n';

const RETENTION_LABEL = (d: number | null) => (d === null ? t('Forever') : t('{n, plural, one {# day} other {# days}}', { n: d }));
const REPLAY_LIMIT_LABEL = (n: number | null) => (n === null ? t('All') : String(n));
const percent = (v: number) => `${Math.round(v * 100)}%`;

const SECTIONS = [
  ['input', msg('Input')],
  ['look', msg('Look')],
  ['sound', msg('Sound')],
  ['timing', msg('Timing')],
  ['display', msg('Display')],
  ['access', msg('Accessibility')],
  ['goals', msg('Goals')],
  ['data', msg('Data')],
  ['app', msg('App')],
] as const;

const TEST_SOUNDS: { sound: TestSound; label: string }[] = [
  { sound: 'hit', label: msg('Hit') },
  { sound: 'miss', label: msg('Miss') },
  { sound: 'combo', label: msg('Combo') },
  { sound: 'tick', label: msg('Tick') },
  { sound: 'metronome', label: msg('Metronome') },
  { sound: 'countdown', label: msg('Countdown') },
];

/** Why a key can't be the retry key, or null when it can. */
export function rejectRetryKey(code: string, hitKeys: readonly string[]): string | null {
  if (code === 'Escape') return t("Esc is used to pause, so it can't be the retry key.");
  if (code === 'Tab') return t("Tab moves between controls, so it can't be the retry key.");
  if (hitKeys.includes(code)) return t("The retry key can't be one of the hit keys.");
  return null;
}

/** About how large an export with every stored replay is. The replays are stored gzipped and the file writes them as base64. */
export function replayExportMb(storedBytes: number): string {
  const mb = (storedBytes * 4) / 3 / 1024 ** 2;
  return mb < 0.1 ? t('under 0.1 MB') : `${formatNumber(mb, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

function Section({ id, children }: { id: (typeof SECTIONS)[number][0]; children: ReactNode }) {
  const title = SECTIONS.find(([key]) => key === id)![1];
  return (
    <div id={`settings-${id}`} className="mb-6 scroll-mt-20 break-inside-avoid">
      <Card>
        <SectionTitle>{t(title)}</SectionTitle>
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
  const { hash } = useLocation();

  // A link such as /settings#settings-data lands here from another page, where the router does not scroll to the anchor.
  useEffect(() => {
    if (hash.length > 1) {
      let id = hash.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        // A hash that is not valid UTF-8 is used as it is.
      }
      document.getElementById(id)?.scrollIntoView();
    }
  }, [hash]);

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
      <PageHeader title={t('Settings')} intro={INTRO.settings} />
      <nav aria-label={t('Settings sections')} className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#settings-${id}`} className="shrink-0 whitespace-nowrap px-3 py-2 text-ink-2 transition hover:text-ink">
            {t(label)}
          </a>
        ))}
      </nav>

      <div className="lg:columns-2 lg:gap-6">
        <Section id="input">
          <Toggle
            label={t('Raw input')}
            help={t(
              'Locks the pointer and reads mouse movement directly. Turn it off if the cursor feels wrong or your device is a pen or tablet.',
            )}
            checked={s.input.rawInput}
            onChange={(v) => setInput({ rawInput: v })}
          />
          <Slider
            label={t('Sensitivity')}
            value={s.input.sensitivity}
            min={0.1}
            max={5}
            step={0.05}
            format={(v) => `${v.toFixed(2)}x`}
            help={t('Raw input only. At 1x one mouse count moves the cursor one pixel at 100% browser zoom.')}
            disabled={!s.input.rawInput}
            onChange={(v) => setInput({ sensitivity: v })}
          />
          <KeyCapture label={t('Hit key 1')} value={s.input.keys[0]} other={s.input.keys[1]} onChange={(code) => setHitKey(0, code)} />
          <KeyCapture label={t('Hit key 2')} value={s.input.keys[1]} other={s.input.keys[0]} onChange={(code) => setHitKey(1, code)} />
          <RetryKeyField value={s.input.retryKey} hitKeys={s.input.keys} onChange={(code) => setInput({ retryKey: code })} />
          <Toggle
            label={t('Mouse buttons count as hits')}
            help={t('Left and right buttons, and a pen tip and barrel button.')}
            checked={s.input.mouseButtons}
            onChange={(v) => setInput({ mouseButtons: v })}
          />
          <Field label={t('Cursor')} help={t('The system cursor has the least delay. Raw input always draws its own cursor.')}>
            <Segmented
              legend={t('Cursor')}
              value={s.input.cursor}
              options={[
                { value: 'system', label: t('System') },
                { value: 'drawn', label: t('Drawn') },
              ]}
              onChange={(v) => setInput({ cursor: v })}
            />
          </Field>
          <p className="mt-2 text-sm text-ink-2">
            {t("The hit keys are {first} and {second}. Esc pauses and can't be changed.", {
              first: keyLabel(s.input.keys[0]),
              second: keyLabel(s.input.keys[1]),
            })}
          </p>
          <div className="mt-4 border-t border-line pt-4">
            <h3 className="mb-2 text-sm text-ink-2">{t('Detected on your last play')}</h3>
            {lastInput ? (
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-ink-2">{t('Pointer')}</dt>
                <dd>{lastInput.pointer ?? t('unknown')}</dd>
                <dt className="text-ink-2">{t('Pointer rate')}</dt>
                <dd>{lastInput.pointerHz ? `${Math.round(lastInput.pointerHz)} Hz` : t('unknown')}</dd>
                <dt className="text-ink-2">{t('Display rate')}</dt>
                <dd>{lastInput.displayHz ? `${Math.round(lastInput.displayHz)} Hz` : t('unknown')}</dd>
                <dt className="text-ink-2">{t('Raw input')}</dt>
                <dd>
                  {lastInput.rawInput
                    ? lastInput.unadjusted
                      ? t('on, without acceleration')
                      : t('on, the browser kept acceleration')
                    : t('off')}
                </dd>
              </dl>
            ) : (
              <p className="text-sm text-ink-2">{t('Play once and the rates your browser reported will show up here.')}</p>
            )}
          </div>
        </Section>

        <Section id="look">
          <SkinPreview settings={s} />
          <Field label={t('Theme')} help={t('System follows your operating system. The playfield changes with the pages.')}>
            <Segmented
              legend={t('Theme')}
              value={s.display.theme}
              options={
                [
                  { value: 'system', label: t('System') },
                  { value: 'dark', label: t('Dark') },
                  { value: 'light', label: t('Light') },
                ] satisfies { value: ThemeChoice; label: string }[]
              }
              onChange={(v) => setDisplay({ theme: v })}
            />
          </Field>
          <Field label={t('Palette')}>
            <div role="radiogroup" aria-label={t('Palette')} className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(PALETTES) as PaletteId[]).map((id) => {
                const p = PALETTES[id];
                return (
                  <label key={id} className="hb-choice">
                    <input
                      type="radio"
                      name="palette"
                      className="sr-only"
                      checked={s.skin.palette === id}
                      onChange={() => setSkin({ palette: id })}
                    />
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
          <Field label={t('Cursor style')}>
            <Segmented
              legend={t('Cursor style')}
              value={s.skin.cursorStyle}
              options={
                [
                  { value: 'ring', label: t('Ring') },
                  { value: 'cross', label: t('Cross') },
                  { value: 'dot', label: t('Dot') },
                ] satisfies { value: CursorStyle; label: string }[]
              }
              onChange={(v) => setSkin({ cursorStyle: v })}
            />
          </Field>
          <Field label={t('Approach style')} help={t('How a target shows the time you have left.')}>
            <Segmented
              legend={t('Approach style')}
              value={s.skin.approach}
              options={
                [
                  { value: 'ring', label: t('Ring') },
                  { value: 'fill', label: t('Fill') },
                  { value: 'brackets', label: t('Brackets') },
                ] satisfies { value: ApproachStyle; label: string }[]
              }
              onChange={(v) => setSkin({ approach: v })}
            />
          </Field>
          <Slider
            label={t('Cursor size')}
            value={s.input.cursorScale}
            min={0.5}
            max={2}
            step={0.05}
            format={(v) => `${v.toFixed(2)}x`}
            onChange={(v) => setInput({ cursorScale: v })}
          />
          <Toggle
            label={t('Field grid')}
            help={t('A faint grid on the playfield.')}
            checked={s.skin.fieldGrid}
            onChange={(v) => setSkin({ fieldGrid: v })}
          />
          <Toggle label={t('Cursor trail')} checked={s.input.cursorTrail} onChange={(v) => setInput({ cursorTrail: v })} />
          <Toggle
            label={t('Click ripple')}
            help={t('A ring that spreads from every click.')}
            checked={s.skin.clickRipple}
            onChange={(v) => setSkin({ clickRipple: v })}
          />
        </Section>

        <Section id="sound">
          <Toggle label={t('Mute all sound')} checked={s.audio.muted} onChange={(v) => setAudio({ muted: v })} />
          <Field label={t('Sound set')} help={SOUND_SETS[s.audio.soundSet].description}>
            <Segmented
              legend={t('Sound set')}
              value={s.audio.soundSet}
              options={(Object.keys(SOUND_SETS) as SoundSetId[]).map((id) => ({ value: id, label: SOUND_SETS[id].label }))}
              onChange={(v) => setAudio({ soundSet: v })}
            />
          </Field>
          <Field label={t('Try the sounds')}>
            <div className="flex flex-wrap gap-2">
              {TEST_SOUNDS.map(({ sound, label }) => (
                <Button key={sound} size="sm" onClick={() => test(sound)}>
                  {t(label)}
                </Button>
              ))}
            </div>
          </Field>
          <Slider
            label={t('Master volume')}
            value={s.audio.master}
            min={0}
            max={1}
            step={0.01}
            format={percent}
            onChange={(v) => setAudio({ master: v })}
          />
          <Slider
            label={t('Hit sounds')}
            value={s.audio.hits}
            min={0}
            max={1}
            step={0.01}
            format={percent}
            onChange={(v) => setAudio({ hits: v })}
          />
          <Slider
            label={t('Effects')}
            value={s.audio.effects}
            min={0}
            max={1}
            step={0.01}
            format={percent}
            onChange={(v) => setAudio({ effects: v })}
          />
          <Slider
            label={t('Ambient')}
            value={s.audio.ambient}
            min={0}
            max={1}
            step={0.01}
            format={percent}
            onChange={(v) => setAudio({ ambient: v })}
          />
          <Field label={t('Metronome')} help={t('A click on the beat, or on the first beat of every bar.')}>
            <Segmented
              legend={t('Metronome')}
              value={s.audio.metronome}
              options={
                [
                  { value: 'off', label: t('Off') },
                  { value: 'beat', label: t('Every beat') },
                  { value: 'bar', label: t('Every bar') },
                ] satisfies { value: MetronomeMode; label: string }[]
              }
              onChange={(v) => setAudio({ metronome: v })}
            />
          </Field>
          <Slider
            label={t('Metronome volume')}
            value={s.audio.metronomeVolume}
            min={SETTING_RANGES.metronomeVolume.min}
            max={SETTING_RANGES.metronomeVolume.max}
            step={SETTING_RANGES.metronomeVolume.step}
            format={percent}
            disabled={s.audio.metronome === 'off'}
            onChange={(v) => setAudio({ metronomeVolume: v })}
          />
        </Section>

        <Section id="timing">
          <OffsetField
            label={t('Visual offset')}
            help={t('Positive values draw targets earlier. Use it if targets seem to arrive late.')}
            value={s.display.visualOffsetMs}
            min={SETTING_RANGES.visualOffsetMs.min}
            max={SETTING_RANGES.visualOffsetMs.max}
            step={SETTING_RANGES.visualOffsetMs.step}
            calibrate="visual"
            onChange={(v) => setDisplay({ visualOffsetMs: v })}
          />
          <OffsetField
            label={t('Audio offset')}
            help={t('The metronome plays this many milliseconds earlier. Hit sounds always play at once.')}
            value={s.audio.offsetMs}
            min={SETTING_RANGES.audioOffsetMs.min}
            max={SETTING_RANGES.audioOffsetMs.max}
            step={SETTING_RANGES.audioOffsetMs.step}
            calibrate="audio"
            onChange={(v) => setAudio({ offsetMs: v })}
          />
        </Section>

        <Section id="display">
          <Toggle
            label={t('Error bar')}
            help={t('Shows where each click landed in time.')}
            checked={s.display.errorBar}
            onChange={(v) => setDisplay({ errorBar: v })}
          />
          <Toggle
            label={t('Path hints')}
            help={t('Faint lines between targets.')}
            checked={s.display.pathHints}
            onChange={(v) => setDisplay({ pathHints: v })}
          />
          <Toggle
            label={t('Crisp pop-ups')}
            help={t('Shows a word on every Crisp hit. Solid, Rough and Miss always show.')}
            checked={s.display.crispPopups}
            onChange={(v) => setDisplay({ crispPopups: v })}
          />
          <Toggle label={t('Early and late marks')} checked={s.display.earlyLate} onChange={(v) => setDisplay({ earlyLate: v })} />
          <Toggle
            label={t('Low latency canvas')}
            help={t('Applies from the next play. Turn it off if you see flicker.')}
            checked={s.display.lowLatency}
            onChange={(v) => setDisplay({ lowLatency: v })}
          />
          <Toggle label={t('Show frame rate')} checked={s.display.showFps} onChange={(v) => setDisplay({ showFps: v })} />
          <Toggle
            label={t('Frame graph')}
            help={t('Draws the time of recent frames in a play. Use it to find stutter.')}
            checked={s.display.frameGraph}
            onChange={(v) => setDisplay({ frameGraph: v })}
          />
        </Section>

        <Section id="access">
          <Field
            label={t('Language')}
            help={t("Automatic follows your browser's language. English is the source text, and the others are translations.")}
          >
            <select
              aria-label={t('Language')}
              value={s.language}
              onChange={(e) => update((x) => ({ ...x, language: e.target.value as LanguageChoice }))}
              className="w-full max-w-xs"
            >
              <option value="auto">{t('Automatic')}</option>
              {LOCALES.map((l) => (
                <option key={l.id} value={l.id} lang={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Text size')} help={t('Scales the text on every page. The playfield keeps its size.')}>
            <Segmented
              legend={t('Text size')}
              value={s.display.textSize}
              options={
                [
                  { value: 'default', label: t('Default') },
                  { value: 'large', label: t('Large') },
                  { value: 'larger', label: t('Larger') },
                ] satisfies { value: TextSize; label: string }[]
              }
              onChange={(v) => setDisplay({ textSize: v })}
            />
          </Field>
          <Toggle
            label={t('High contrast')}
            help={t('Stronger text, lines and focus rings. It also turns on when your operating system asks for more contrast.')}
            checked={s.display.highContrast}
            onChange={(v) => setDisplay({ highContrast: v })}
          />
          <Toggle
            label={t('Reduce motion')}
            help={t(
              'Turns off page animations, sparks, shakes and the flash on a miss. It also follows your operating system on the first visit.',
            )}
            checked={s.display.reduceMotion}
            onChange={(v) => setDisplay({ reduceMotion: v })}
          />
          <p className="mt-2 text-sm text-ink-2">
            {t(
              'The Clear view palette under Look is easier to tell apart with red-green color blindness, and every target can be hit with the keyboard keys under Input.',
            )}
          </p>
        </Section>

        <Section id="goals">
          <Slider
            label={t('Weekly goal')}
            value={s.goals.weeklyMinutes}
            min={SETTING_RANGES.weeklyMinutes.min}
            max={SETTING_RANGES.weeklyMinutes.max}
            step={SETTING_RANGES.weeklyMinutes.step}
            format={(v) => (v === 0 ? t('No goal') : t('{n} min', { n: v }))}
            help={t('Minutes of play a week. Set it to 0 for no goal.')}
            onChange={(v) => update((x) => ({ ...x, goals: { ...x.goals, weeklyMinutes: v } }))}
          />
        </Section>

        <DataSection />

        <Section id="app">
          <AppInfo />
          <p className="mt-3 text-sm text-ink-2">
            {tx('The {guide} explains the modes, the controls and how the stats are worked out.', {
              guide: (
                <Link to="/guide" className="text-accent hover:underline">
                  {t('guide')}
                </Link>
              ),
            })}
          </p>
          {canInstall && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="text-sm text-ink-2">
                {t('Install Heartbeat to open it from your desktop or home screen and play without a connection.')}
              </p>
              <Button variant="primary" className="mt-3" onClick={() => void promptInstall()}>
                {t('Install')}
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
        <span>{t('Retry key')}</span>
        <span className="flex items-center gap-2">
          {value !== '' && (
            <Button size="sm" variant="ghost" onClick={() => onChange('')}>
              {t('Turn off')}
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
            aria-label={t('Retry key, currently {key}. Press to change.', { key: value === '' ? t('off') : keyLabel(value) })}
          >
            {listening ? t('Press a key') : value === '' ? t('Off') : keyLabel(value)}
          </button>
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-2">
        {t('Hold it for {n, plural, one {# second} other {# seconds}} during a play to start the map again.', { n: RETRY_HOLD_MS / 1000 })}
      </p>
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
    [t('Version'), __APP_VERSION__],
    [t('Game engine'), game ? String(game.ENGINE_VERSION) : t('loading')],
    [t('Map generator'), game ? String(game.GENERATOR_VERSION) : t('loading')],
    [t('Share link format'), String(SHARE_CODE_VERSION)],
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
  const [pendingLimit, setPendingLimit] = useState<{ value: number | null; removing: number } | null>(null);
  const limitCheck = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => {
    storageEstimate().then(setUsage);
    currentPersisted().then(setPersisted);
    getLastExport()
      .then(setLastExport)
      .catch(() => undefined);
    replayStorage()
      .then(setReplays)
      .catch(() => undefined);
  };
  useEffect(refresh, []);

  const doExport = async (gzip: boolean) => {
    setBusy(true);
    try {
      const n = await saveExport(gzip, includeReplays && (replays?.count ?? 0) > 0);
      setMessage({ tone: 'good', text: t('Exported {n, plural, one {# play} other {# plays}}.', { n }) });
      refresh();
    } catch (e) {
      setMessage({ tone: 'bad', text: e instanceof Error ? e.message : t('The export failed.') });
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
        text: [
          t(
            'Added {added, plural, one {# play} other {# plays}} and skipped {skipped} that {skipped, plural, one {was} other {were}} already here.',
            {
              added: report.playsAdded,
              skipped: report.playsSkipped,
            },
          ),
          report.tombstonesApplied ? t('Removed {n} that the file marks as deleted.', { n: report.tombstonesApplied }) : '',
        ]
          .filter(Boolean)
          .join(' '),
      });
      refresh();
    } catch (e) {
      setMessage({ tone: 'bad', text: e instanceof ImportError ? e.message : t('The file could not be imported.') });
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
      setMessage({ tone: 'good', text: t('All plays, progress and drills were deleted. Your settings stay.') });
    } catch (e) {
      setMessage({ tone: 'bad', text: e instanceof Error ? e.message : t('Deleting failed.') });
    } finally {
      setConfirming(false);
      setBusy(false);
      refresh();
    }
  };

  const saveReplayLimit = (value: number | null) => update((x) => ({ ...x, data: { ...x.data, replayLimit: value } }));

  // Saving a lower limit makes the next save or start remove replays, so say how many first.
  const chooseReplayLimit = async (v: string) => {
    const value = v === 'null' ? null : Number(v);
    const check = ++limitCheck.current;
    setPendingLimit(null);
    let removing = 0;
    try {
      removing = await countReplayRemovals(value);
    } catch {
      removing = 0;
    }
    if (check !== limitCheck.current) return;
    if (removing > 0) setPendingLimit({ value, removing });
    else saveReplayLimit(value);
  };

  const hasReplays = (replays?.count ?? 0) > 0;

  return (
    <Section id="data">
      <p className="text-sm text-ink-2">
        {t('Everything is stored in this browser only. Export a file to keep a copy or move to another browser.')}
      </p>
      <Toggle
        label={
          replays === null
            ? t('Include replays')
            : hasReplays
              ? t('Include replays (about {size})', { size: replayExportMb(replays.bytes) })
              : t('Include replays (none stored)')
        }
        help={t('Without replays the file is much smaller. Plays and stats are always included.')}
        checked={includeReplays && hasReplays}
        disabled={!hasReplays}
        onChange={setIncludeReplays}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void doExport(false)}>
          {t('Export ({format})', { format: '.json' })}
        </Button>
        <Button disabled={busy} onClick={() => void doExport(true)}>
          {t('Export ({format})', { format: '.json.gz' })}
        </Button>
        <Button disabled={busy} onClick={() => fileInput.current?.click()}>
          {t('Import')}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.gz,application/json,application/gzip"
          className="sr-only"
          aria-label={t('Import file')}
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
        <dt className="text-ink-2">{t('Space used')}</dt>
        <dd>{usage ? t('{used} of {total}', { used: bytes(usage.usage), total: bytes(usage.quota) }) : t('unknown')}</dd>
        <dt className="text-ink-2">{t('Replays stored')}</dt>
        <dd>{replays ? `${replays.count}, ${bytes(replays.bytes)}` : t('unknown')}</dd>
        <dt className="text-ink-2">{t('Kept by the browser')}</dt>
        <dd>
          {persisted === null ? t('unknown') : persisted ? t('Yes') : t('No, the browser may clear it')}
          {persisted === false && (
            <Button size="sm" variant="ghost" className="ml-2" onClick={() => void askPersist()}>
              {t('Ask again')}
            </Button>
          )}
        </dd>
        <dt className="text-ink-2">{t('Last export')}</dt>
        <dd>{lastExport ? dateTime(lastExport) : t('never')}</dd>
      </dl>
      {persisted === false && (
        <p className="mt-2 text-sm text-warn">{t('The browser has not promised to keep this data. Export a file now and then.')}</p>
      )}

      <Field
        label={t('Keep the newest replays')}
        help={t(
          'Replays you mark to keep, and replays of new bests, are never removed. Older ones are removed after your next play or the next time Heartbeat starts.',
        )}
      >
        <Segmented
          legend={t('Replay limit')}
          value={String(s.data.replayLimit)}
          options={REPLAY_LIMIT_CHOICES.map((n) => ({ value: String(n), label: REPLAY_LIMIT_LABEL(n) }))}
          onChange={(v) => void chooseReplayLimit(v)}
        />
        {pendingLimit && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm">
              {t('This removes {n, plural, one {# replay} other {# replays}}.', { n: pendingLimit.removing })}
            </span>
            <Button
              variant="danger"
              onClick={() => {
                saveReplayLimit(pendingLimit.value);
                setPendingLimit(null);
              }}
            >
              {t('Remove them')}
            </Button>
            <Button variant="ghost" onClick={() => setPendingLimit(null)}>
              {t('Keep the current limit')}
            </Button>
          </div>
        )}
      </Field>

      <Field
        label={t('Keep per-object detail for')}
        help={t('Older detail is removed. Play summaries, ratings, trends and bests are always kept.')}
      >
        <Segmented
          legend={t('Detail retention')}
          value={String(s.data.detailRetentionDays)}
          options={RETENTION_CHOICES.map((d) => ({ value: String(d), label: RETENTION_LABEL(d) }))}
          onChange={(v) => update((x) => ({ ...x, data: { ...x.data, detailRetentionDays: v === 'null' ? null : Number(v) } }))}
        />
      </Field>

      <div className="mt-4 border-t border-line pt-4">
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{t('This removes every play, progress and drill.')}</span>
            <Button variant="danger" disabled={busy} onClick={() => void wipe()}>
              {t('Yes, delete everything')}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('Cancel')}
            </Button>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            {t('Delete all data')}
          </Button>
        )}
      </div>
    </Section>
  );
}
