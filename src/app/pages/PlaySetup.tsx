import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { itemsFromMap, mapDemand, PREVIEW_MIN_N } from '../../analytics/demand';
import type { SkillDemand } from '../../analytics/demand';
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTY_LIMITS,
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
import type { DifficultySettings, LaunchRequest, ModId, SkillId } from '../../shared/types';
import { DemandBars } from '../components/DemandBars';
import { Button, Card, Field, Notice, PageHeader, SectionTitle, Segmented, Slider, Toggle } from '../components/ui';
import type { GameModule } from '../state/engine';
import { useGame } from '../state/engine';
import { INTRO, PREVIEW_UNAVAILABLE } from '../copy';
import { useCurrentLevels } from '../state/levels';
import { cleanMods, dynamicLaunch, presetDifficulty, randomSeed, snapLength, startPlay } from '../state/launch';

const snapDynamicLength = (sec: number): number => snapLength(sec, MODES.dynamic.lengthOptions);
import { getAppState, updatePrefs } from '../state/store';

const KEYS = Object.keys(DIFFICULTY_LIMITS) as (keyof DifficultySettings)[];
const DYNAMIC_MODS = MODES.dynamic.allowedMods;

interface Preview {
  demand: Partial<Record<SkillId, Pick<SkillDemand, 'level'>>>;
  full: boolean;
}

function previewFor(launch: LaunchRequest, game: GameModule | null): Preview {
  try {
    if (!game) throw new Error('The game has not loaded.');
    const p = game.previewLaunch(launch);
    return { demand: mapDemand(itemsFromMap(p.map, p.features), launch.mods, PREVIEW_MIN_N), full: true };
  } catch {
    // Without the engine, show what the settings alone determine.
    const d = launch.difficulty;
    const tight = launch.mods.includes('tight');
    const wide = launch.mods.includes('wide');
    const radius = d.radius * (tight ? MOD_SCALE.tight.radius : wide ? MOD_SCALE.wide.radius : 1);
    const scale = tight ? MOD_SCALE.tight.windows : wide ? MOD_SCALE.wide.windows : 1;
    return {
      demand: {
        precision: { level: levelForDemand('precision', precisionDemand(radius)) },
        timing: { level: levelForDemand('timing', timingDemand(windowsForTiming(d.timing).crisp * scale)) },
        reading: { level: levelForDemand('reading', readingDemand(d.approachMs, launch.mods)) },
      },
      full: false,
    };
  }
}

export function PlaySetup() {
  const navigate = useNavigate();
  const { levels: loadedLevels, error: levelsError } = useCurrentLevels();
  const [initial] = useState(() => getAppState().prefs);
  const [preset, setPreset] = useState<number | null>(initial.dynamic.presetLevel);
  const [difficulty, setDifficulty] = useState<DifficultySettings>(initial.dynamic.difficulty ?? { ...DEFAULT_DIFFICULTY });
  const [mods, setMods] = useState<ModId[]>(() => cleanMods(initial.dynamic.mods, 'dynamic'));
  const [lengthSec, setLengthSec] = useState<number>(() => snapDynamicLength(initial.dynamic.lengthSec ?? LEVEL_PRESETS[(initial.dynamic.presetLevel ?? 4) - 1]?.lengthSec ?? 90));
  const [seed, setSeed] = useState<number>(() => randomSeed());
  const [fullscreen, setFullscreen] = useState(initial.fullscreen);

  const levels = useMemo(() => loadedLevels ?? {}, [loadedLevels]);
  const launch = useMemo(
    () => dynamicLaunch({ presetLevel: preset, difficulty, mods, lengthSec, seed, levels }),
    [preset, difficulty, mods, lengthSec, seed, levels],
  );
  const { game, failed } = useGame();
  const preview = useMemo(() => previewFor(launch, game), [launch, game]);

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

  const presetLength = preset === null ? null : LEVEL_PRESETS[preset - 1]?.lengthSec ?? null;
  const start = () => {
    if (!loadedLevels) return;
    updatePrefs((p) => ({ ...p, fullscreen, dynamic: { presetLevel: preset, difficulty, mods, lengthSec } }));
    startPlay(navigate, launch, '/play', fullscreen);
  };

  return (
    <>
      <PageHeader title="Play" intro={INTRO.play} />

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card>
            <SectionTitle>Level</SectionTitle>
            <div role="radiogroup" aria-label="Level" className="grid gap-3 sm:grid-cols-2">
              {LEVEL_PRESETS.map((p) => (
                <label key={p.level} className="fw-choice">
                  <input type="radio" name="level" className="sr-only" checked={preset === p.level} onChange={() => choosePreset(p.level)} />
                  <span className="block font-display font-semibold">{p.label}</span>
                  <span className="block text-sm text-ink-2">{p.description}</span>
                </label>
              ))}
              <label className="fw-choice sm:col-span-2">
                <input type="radio" name="level" className="sr-only" checked={preset === null} onChange={() => setPreset(null)} />
                <span className="block font-display font-semibold">Custom</span>
                <span className="block text-sm text-ink-2">Set each part of the difficulty yourself.</span>
              </label>
            </div>
          </Card>

          {preset === null && (
            <Card>
              <SectionTitle>Custom difficulty</SectionTitle>
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

          <Card>
            <SectionTitle aside={`Score multiplier x${modMultiplier(mods).toFixed(2)}`}>Mods</SectionTitle>
            <ul className="grid gap-3 sm:grid-cols-2">
              {DYNAMIC_MODS.map((id) => {
                const info = MODS[id];
                const blocked = !mods.includes(id) && info.conflicts.some((c) => mods.includes(c));
                return (
                  <li key={id}>
                    <label className="fw-choice flex gap-3">
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
                        {blocked && <span className="block text-sm text-warn">Can't be used with {info.conflicts.map((c) => MODS[c].label).join(' or ')}.</span>}
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
            <SectionTitle>Target</SectionTitle>
            <svg viewBox="0 0 1000 625" className="w-full rounded-md border border-line bg-bg-2" role="img" aria-label={`Target of radius ${Math.round(shownRadius)} on a 1000 wide field`}>
              <circle cx={500} cy={312.5} r={shownRadius} fill="color-mix(in srgb, var(--color-accent) 18%, transparent)" stroke="var(--color-accent)" strokeWidth={4} />
              <circle cx={500} cy={312.5} r={Math.max(4, shownRadius * 0.08)} fill="var(--color-accent)" />
            </svg>
            <dl className="mt-4 grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-ink-2">Radius</dt>
              <dd>{Math.round(shownRadius)} units</dd>
              <dt className="text-ink-2">Approach</dt>
              <dd>{difficulty.approachMs} ms</dd>
              <dt className="text-ink-2">Crisp</dt>
              <dd>{(w.crisp * windowScale).toFixed(0)} ms either side</dd>
              <dt className="text-ink-2">Solid</dt>
              <dd>{(w.solid * windowScale).toFixed(0)} ms</dd>
              <dt className="text-ink-2">Rough</dt>
              <dd>{(w.rough * windowScale).toFixed(0)} ms</dd>
            </dl>
          </Card>

          <Card>
            <SectionTitle>Demand</SectionTitle>
            <DemandBars demand={preview.demand} />
            {!preview.full && (game !== null || failed) && (
              <div className="mt-3">
                <Notice>{PREVIEW_UNAVAILABLE}</Notice>
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle>Length and seed</SectionTitle>
            <Segmented
              legend="Length"
              value={lengthSec}
              options={MODES.dynamic.lengthOptions.map((n) => ({ value: n, label: `${n} s` }))}
              onChange={setLengthSec}
            />
            {presetLength !== null && !MODES.dynamic.lengthOptions.includes(presetLength) && (
              <p className="mt-2 text-sm text-ink-2">
                This level is {presetLength} s by design. The closest option, {snapDynamicLength(presetLength)} s, is selected.
              </p>
            )}
            <Field label="Seed" help="The same seed gives the same map in this browser. A new seed is picked every time you open this page.">
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  max={4294967295}
                  value={seed}
                  aria-label="Seed"
                  className="w-full min-w-0"
                  onChange={(e) => {
                    const v = Math.floor(Number(e.target.value));
                    if (Number.isFinite(v) && v >= 0 && v <= 4294967295) setSeed(v);
                  }}
                />
                <Button size="sm" onClick={() => setSeed(randomSeed())}>
                  New seed
                </Button>
              </div>
            </Field>
            <Toggle label="Full screen" checked={fullscreen} onChange={setFullscreen} />
            <Button variant="primary" size="lg" className="mt-3 w-full" disabled={!loadedLevels} onClick={start}>
              Start
            </Button>
            {levelsError && (
              <div className="mt-3">
                <Notice tone="bad">{levelsError} Reload the page to try again.</Notice>
              </div>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
