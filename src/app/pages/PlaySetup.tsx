import { useId, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTY_LIMITS,
  JUDGMENTS,
  LEVEL_PRESETS,
  MODES,
  MODS,
  MOD_SCALE,
  levelForDemand,
  modMultiplier,
  precisionDemand,
  readingDemand,
  timingDemand,
  windowsForTiming,
} from '../../shared/catalog';
import { intlTag } from '../../shared/i18n';
import type { DifficultySettings, LaunchRequest, ModId, SkillId } from '../../shared/types';
import { DemandBars } from '../components/DemandBars';
import { MapPreview, useMapPreview } from '../components/MapPreview';
import { Button, Card, Field, Notice, PageHeader, SectionTitle, Slider, StickyStart, Toggle } from '../components/ui';
import { useGame } from '../state/engine';
import { INTRO, PREVIEW_UNAVAILABLE } from '../copy';
import { t } from '../i18n';
import { useCurrentLevels } from '../state/levels';
import { cleanMods, dynamicLaunch, presetDifficulty, randomSeed, sharedFrom, snapLength, startPlay } from '../state/launch';
import { getAppState, updatePrefs } from '../state/store';
import { SharedBanner } from './Share';

const snapDynamicLength = (sec: number): number => snapLength(sec, MODES.dynamic.lengthOptions);

const KEYS = Object.keys(DIFFICULTY_LIMITS) as (keyof DifficultySettings)[];
const DYNAMIC_MODS = MODES.dynamic.allowedMods;

/** "a", "a or b", "a, b or c", in the player's language. */
const orList = (items: readonly string[]): string => new Intl.ListFormat(intlTag(), { style: 'long', type: 'disjunction' }).format(items);

/** What the settings alone determine, for when the map can't be built. */
function settingsDemand(launch: LaunchRequest): Partial<Record<SkillId, { level: number }>> {
  const d = launch.difficulty;
  const tight = launch.mods.includes('tight');
  const wide = launch.mods.includes('wide');
  const radius = d.radius * (tight ? MOD_SCALE.tight.radius : wide ? MOD_SCALE.wide.radius : 1);
  const scale = tight ? MOD_SCALE.tight.windows : wide ? MOD_SCALE.wide.windows : 1;
  return {
    precision: { level: levelForDemand('precision', precisionDemand(radius)) },
    timing: { level: levelForDemand('timing', timingDemand(windowsForTiming(d.timing).crisp * scale)) },
    reading: { level: levelForDemand('reading', readingDemand(d.approachMs, launch.mods)) },
  };
}

/** Radio buttons drawn like the segmented control, but sharing the width so a long row never wraps. */
function LengthPicker({ value, options, onChange }: { value: number; options: readonly number[]; onChange(v: number): void }) {
  const name = useId();
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="sr-only">{t('Length')}</legend>
      <div
        className="grid gap-0.5 rounded-[18px] border border-line bg-bg-2 p-0.5"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((n) => (
          <label key={n} className="cursor-pointer">
            <input type="radio" name={name} className="peer sr-only" checked={n === value} onChange={() => onChange(n)} />
            <span className="flex h-7 items-center justify-center whitespace-nowrap rounded-[14px] px-1 text-sm text-ink-2 transition hover:text-ink peer-checked:bg-surface-3 peer-checked:text-ink peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
              {n} s
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function PlaySetup() {
  const navigate = useNavigate();
  const { levels: loadedLevels, error: levelsError } = useCurrentLevels();
  const shared = sharedFrom(useLocation().state, 'dynamic');
  const [initial] = useState(() => getAppState().prefs);
  const [prefill] = useState(() => shared?.prefill ?? null);
  const [preset, setPreset] = useState<number | null>(prefill ? prefill.presetLevel : initial.dynamic.presetLevel);
  const [difficulty, setDifficulty] = useState<DifficultySettings>(
    prefill?.difficulty ?? initial.dynamic.difficulty ?? { ...DEFAULT_DIFFICULTY },
  );
  const [mods, setMods] = useState<ModId[]>(() => cleanMods(prefill ? prefill.mods : initial.dynamic.mods, 'dynamic'));
  const [lengthSec, setLengthSec] = useState<number>(() =>
    snapDynamicLength(
      prefill?.lengthSec ?? initial.dynamic.lengthSec ?? LEVEL_PRESETS[(initial.dynamic.presetLevel ?? 4) - 1]?.lengthSec ?? 90,
    ),
  );
  const [seed, setSeed] = useState<number>(() => prefill?.seed ?? randomSeed());
  const [fullscreen, setFullscreen] = useState(initial.fullscreen);

  const levels = useMemo(() => loadedLevels ?? {}, [loadedLevels]);
  const launch = useMemo(
    () => dynamicLaunch({ presetLevel: preset, difficulty, mods, lengthSec, seed, levels }),
    [preset, difficulty, mods, lengthSec, seed, levels],
  );
  const { game, failed } = useGame();
  const { data: preview, pending, failed: previewFailed } = useMapPreview(launch, game);
  const fallbackDemand = useMemo(() => settingsDemand(launch), [launch]);

  const tight = mods.includes('tight');
  const wide = mods.includes('wide');
  const shownRadius = difficulty.radius * (tight ? MOD_SCALE.tight.radius : wide ? MOD_SCALE.wide.radius : 1);
  const windowScale = tight ? MOD_SCALE.tight.windows : wide ? MOD_SCALE.wide.windows : 1;
  const w = windowsForTiming(difficulty.timing);

  const choosePreset = (level: number) => {
    setPreset(level);
    setDifficulty(presetDifficulty(level));
    setLengthSec(snapDynamicLength(LEVEL_PRESETS[level - 1]!.lengthSec));
  };
  const toggleMod = (id: ModId, on: boolean) => setMods((cur) => (on ? cleanMods([...cur, id], 'dynamic') : cur.filter((m) => m !== id)));

  const presetLength = preset === null ? null : (LEVEL_PRESETS[preset - 1]?.lengthSec ?? null);
  const start = () => {
    if (!loadedLevels) return;
    updatePrefs((p) => ({ ...p, fullscreen, dynamic: { presetLevel: preset, difficulty, mods, lengthSec } }));
    startPlay(navigate, launch, '/play', fullscreen);
  };

  const levelText = preset === null ? t('Custom') : t('Level {level}', { level: preset });
  const summary = mods.length
    ? t('{level}, {length} s, {n, plural, one {# mod} other {# mods}}', { level: levelText, length: lengthSec, n: mods.length })
    : t('{level}, {length} s', { level: levelText, length: lengthSec });

  return (
    <>
      <PageHeader title={t('Play')} intro={INTRO.play} />
      {shared && (
        <div className="mb-6">
          <SharedBanner generatorVersion={shared.shared.generatorVersion} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card>
            <SectionTitle>{t('Level')}</SectionTitle>
            <div role="radiogroup" aria-label={t('Level')} className="grid gap-3 sm:grid-cols-2">
              {LEVEL_PRESETS.map((p) => (
                <label key={p.level} className="hb-choice">
                  <input
                    type="radio"
                    name="level"
                    className="sr-only"
                    checked={preset === p.level}
                    onChange={() => choosePreset(p.level)}
                  />
                  <span className="block font-display font-semibold">{p.label}</span>
                  <span className="block text-sm text-ink-2">{p.description}</span>
                </label>
              ))}
              <label className="hb-choice sm:col-span-2">
                <input type="radio" name="level" className="sr-only" checked={preset === null} onChange={() => setPreset(null)} />
                <span className="block font-display font-semibold">{t('Custom')}</span>
                <span className="block text-sm text-ink-2">{t('Set each part of the difficulty yourself.')}</span>
              </label>
            </div>
          </Card>

          {preset === null && (
            <Card>
              <SectionTitle>{t('Custom difficulty')}</SectionTitle>
              <div className="grid gap-x-8 sm:grid-cols-2">
                {KEYS.map((k) => {
                  const lim = DIFFICULTY_LIMITS[k];
                  return (
                    <Slider
                      key={k}
                      label={lim.label}
                      help={lim.help}
                      value={difficulty[k]}
                      min={lim.min}
                      max={lim.max}
                      step={lim.step}
                      format={(v) => (k === 'approachMs' ? `${v} ms` : String(v))}
                      onChange={(v) => setDifficulty((d) => ({ ...d, [k]: v }))}
                    />
                  );
                })}
              </div>
            </Card>
          )}

          <MapPreview launch={launch} data={preview} pending={pending} failed={previewFailed} />

          <Card>
            <SectionTitle aside={t('Score multiplier x{value}', { value: modMultiplier(mods).toFixed(2) })}>{t('Mods')}</SectionTitle>
            <ul className="grid gap-3 sm:grid-cols-2">
              {DYNAMIC_MODS.map((id) => {
                const info = MODS[id];
                const blocked = !mods.includes(id) && info.conflicts.some((c) => mods.includes(c));
                return (
                  <li key={id}>
                    <label className="hb-choice flex gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
                        checked={mods.includes(id)}
                        disabled={blocked}
                        onChange={(e) => toggleMod(id, e.target.checked)}
                      />
                      <span>
                        <span className="font-display font-semibold">{info.label}</span>
                        <span className="ml-2 text-sm text-ink-2">x{info.multiplier}</span>
                        <span className="block text-sm text-ink-2">{info.description}</span>
                        {blocked && (
                          <span className="block text-sm text-warn">
                            {t("Can't be used with {mods}.", { mods: orList(info.conflicts.map((c) => MODS[c].label)) })}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <SectionTitle>{t('Target')}</SectionTitle>
            <svg
              viewBox="0 0 1000 625"
              className="w-full rounded-md border border-line bg-bg-2"
              role="img"
              aria-label={t('Target of radius {radius} on a 1000 wide field', { radius: Math.round(shownRadius) })}
            >
              <circle
                cx={500}
                cy={312.5}
                r={shownRadius}
                fill="color-mix(in srgb, var(--color-accent) 18%, transparent)"
                stroke="var(--color-accent)"
                strokeWidth={4}
              />
              <circle cx={500} cy={312.5} r={Math.max(4, shownRadius * 0.08)} fill="var(--color-accent)" />
            </svg>
            <dl className="mt-4 grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-ink-2">{t('Radius')}</dt>
              <dd>{t('{n} units', { n: String(Math.round(shownRadius)) })}</dd>
              <dt className="text-ink-2">{t('Approach')}</dt>
              <dd>{difficulty.approachMs} ms</dd>
              <dt className="text-ink-2">{JUDGMENTS.crisp.label}</dt>
              <dd>{t('{ms} ms either side', { ms: (w.crisp * windowScale).toFixed(0) })}</dd>
              <dt className="text-ink-2">{JUDGMENTS.solid.label}</dt>
              <dd>{(w.solid * windowScale).toFixed(0)} ms</dd>
              <dt className="text-ink-2">{JUDGMENTS.rough.label}</dt>
              <dd>{(w.rough * windowScale).toFixed(0)} ms</dd>
            </dl>
          </Card>

          <Card>
            <SectionTitle>{t('Demand')}</SectionTitle>
            <DemandBars demand={preview?.demand ?? fallbackDemand} />
            {!preview && (previewFailed || failed) && (
              <div className="mt-3">
                <Notice>{t(PREVIEW_UNAVAILABLE)}</Notice>
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle>{t('Length and seed')}</SectionTitle>
            <LengthPicker value={lengthSec} options={MODES.dynamic.lengthOptions} onChange={setLengthSec} />
            {presetLength !== null && !MODES.dynamic.lengthOptions.includes(presetLength) && (
              <p className="mt-2 text-sm text-ink-2">
                {t('This level is {length} s by design. The closest option, {closest} s, is selected.', {
                  length: presetLength,
                  closest: snapDynamicLength(presetLength),
                })}
              </p>
            )}
            <Field
              label={t('Seed')}
              help={t('The same seed gives the same map in this browser. A new seed is picked every time you open this page.')}
            >
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  max={4294967295}
                  value={seed}
                  aria-label={t('Seed')}
                  className="w-full min-w-0"
                  onChange={(e) => {
                    const v = Math.floor(Number(e.target.value));
                    if (Number.isFinite(v) && v >= 0 && v <= 4294967295) setSeed(v);
                  }}
                />
                <Button size="sm" onClick={() => setSeed(randomSeed())}>
                  {t('New seed')}
                </Button>
              </div>
            </Field>
            <Toggle label={t('Full screen')} checked={fullscreen} onChange={setFullscreen} />
            <Button variant="primary" size="lg" className="mt-3 w-full max-lg:hidden" disabled={!loadedLevels} onClick={start}>
              {t('Start')}
            </Button>
            {levelsError && (
              <div className="mt-3">
                <Notice tone="bad">{t('{error} Reload the page to try again.', { error: levelsError })}</Notice>
              </div>
            )}
          </Card>
        </aside>
      </div>
      <StickyStart summary={summary}>
        <Button variant="primary" size="lg" className="px-8" disabled={!loadedLevels} onClick={start}>
          {t('Start')}
        </Button>
      </StickyStart>
    </>
  );
}
