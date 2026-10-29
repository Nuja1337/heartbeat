import { useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { OCTANT_PHRASE } from '../../analytics/insightCopy';
import { DEFAULT_MODULE_LEVEL, MODES, MODS, MODULE_IDS, SKILLS } from '../../shared/catalog';
import type { LaunchRequest, ModId, ModeId, ModuleId, ModuleOptions } from '../../shared/types';
import { Button, Card, Field, LinkButton, Notice, PageHeader, Segmented, SectionTitle, Toggle } from '../components/ui';
import { level } from '../format';
import { useAnalysis } from '../state/analysis';
import { useCurrentLevels } from '../state/levels';
import { cleanMods, moduleLaunch, randomSeed, startPlay } from '../state/launch';
import { getAppState, updatePrefs } from '../state/store';

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export function ModuleSetup() {
  const { mode } = useParams();
  const info = mode && mode in MODES ? MODES[mode as ModeId] : null;
  if (!info || info.id === 'dynamic') return <Navigate to="/train" replace />;
  return <Setup key={info.id} modeId={info.id} />;
}

function Setup({ modeId }: { modeId: ModeId }) {
  const info = MODES[modeId];
  const navigate = useNavigate();
  const location = useLocation();
  const { data } = useAnalysis();
  const prefill = (location.state as { prefill?: LaunchRequest } | null)?.prefill;
  const drill = prefill && prefill.modeId === modeId ? prefill : null;
  const [stored] = useState(() => getAppState().prefs.modules[modeId]);

  const [options, setOptions] = useState<ModuleOptions>(() => ({ ...info.defaultOptions, ...(drill ? drill.options : stored?.options) }));
  const [mods, setMods] = useState<ModId[]>(() => cleanMods(drill ? drill.mods : (stored?.mods ?? []), modeId));
  const [lengthSec, setLengthSec] = useState<number>(() => {
    const want = drill?.lengthSec ?? stored?.lengthSec ?? info.defaultLengthSec;
    return info.lengthOptions.includes(want) ? want : info.defaultLengthSec;
  });
  const [fullscreen, setFullscreen] = useState(() => getAppState().prefs.fullscreen);

  const { levels, error: levelsError } = useCurrentLevels();
  const set = (patch: Partial<ModuleOptions>) => setOptions((o) => ({ ...o, ...patch }));

  const start = () => {
    if (!levels) return;
    updatePrefs((p) => ({ ...p, fullscreen, modules: { ...p.modules, [modeId]: { options, mods, lengthSec } } }));
    const launch = moduleLaunch({ modeId, options, mods, lengthSec, seed: drill?.seed ?? randomSeed(), levels, drillId: drill?.drillId ?? null });
    startPlay(navigate, launch, `/train/${modeId}`, fullscreen);
  };

  const mix = options.mixModules ?? [];
  const toggleMix = (id: ModuleId, on: boolean) => {
    const next = on ? [...mix, id] : mix.filter((m) => m !== id);
    set({ mixModules: next });
  };
  const mixValid = modeId !== 'mix' || (mix.length >= 2 && mix.length <= 4);
  const shownLevels: ModuleId[] = modeId === 'mix' ? mix : (MODULE_IDS as string[]).includes(modeId) ? [modeId as ModuleId] : [];

  return (
    <>
      <PageHeader
        title={info.label}
        intro={info.description}
        actions={<LinkButton to="/train" variant="ghost">All modules</LinkButton>}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {drill?.drillId && (
            <Card>
              <p>
                This drill was set up from an insight. Your results will be compared with how you played before.
              </p>
            </Card>
          )}

          {info.options.length > 0 && (
            <Card>
              <SectionTitle>Options</SectionTitle>
              {info.options.includes('distanceFocus') && (
                <Field label="Jump distance">
                  <Segmented legend="Jump distance" value={options.distanceFocus ?? 'mixed'} onChange={(v) => set({ distanceFocus: v })}
                    options={[{ value: 'mixed', label: 'Mixed' }, { value: 'short', label: 'Short' }, { value: 'long', label: 'Long' }]} />
                </Field>
              )}
              {info.options.includes('directionFocus') && (
                <Field label="Direction" help="Most jumps will move this way.">
                  <select
                    aria-label="Direction"
                    value={options.directionFocus ?? ''}
                    onChange={(e) => set({ directionFocus: e.target.value === '' ? null : Number(e.target.value) })}
                  >
                    <option value="">Any direction</option>
                    {OCTANT_PHRASE.map((name, i) => (
                      <option key={name} value={i}>{cap(name)}</option>
                    ))}
                  </select>
                </Field>
              )}
              {info.options.includes('angleFocus') && (
                <Field label="Turns">
                  <Segmented legend="Turns" value={options.angleFocus ?? 'mixed'} onChange={(v) => set({ angleFocus: v })}
                    options={[{ value: 'mixed', label: 'Mixed' }, { value: 'sharp', label: 'Sharp' }, { value: 'wide', label: 'Wide' }]} />
                </Field>
              )}
              {info.options.includes('streamLength') && (
                <Field label="Stream length" help="Short is 3 to 5 taps, medium 6 to 12 and long 13 to 24.">
                  <Segmented legend="Stream length" value={options.streamLength ?? 'medium'} onChange={(v) => set({ streamLength: v })}
                    options={[{ value: 'short', label: 'Short' }, { value: 'medium', label: 'Medium' }, { value: 'long', label: 'Long' }]} />
                </Field>
              )}
              {info.options.includes('sliderFocus') && (
                <Field label="Sliders">
                  <Segmented legend="Sliders" value={options.sliderFocus ?? 'mixed'} onChange={(v) => set({ sliderFocus: v })}
                    options={[{ value: 'mixed', label: 'Mixed' }, { value: 'straight', label: 'Straight' }, { value: 'curves', label: 'Curves' }, { value: 'repeats', label: 'Repeats' }]} />
                </Field>
              )}
              {info.options.includes('mixModules') && (
                <Field label="Modules in this mix" help="Pick 2 to 4. They play in the order you pick them, one set each.">
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {MODULE_IDS.map((id) => {
                      const on = mix.includes(id);
                      const full = !on && mix.length >= 4;
                      return (
                        <li key={id}>
                          <label className={`flex items-center gap-2 py-1 ${full ? 'opacity-40' : 'cursor-pointer'}`}>
                            <input type="checkbox" className="accent-[var(--color-accent)]" checked={on} disabled={full} onChange={(e) => toggleMix(id, e.target.checked)} />
                            <span>{MODES[id].label}</span>
                            {on && <span className="text-sm text-ink-2">{mix.indexOf(id) + 1}</span>}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  {!mixValid && <p role="status" className="text-sm text-rough">Pick at least 2 modules.</p>}
                </Field>
              )}
            </Card>
          )}

          {info.allowedMods.length > 0 && (
            <Card>
              <SectionTitle>Mods</SectionTitle>
              {info.allowedMods.map((id) => (
                <Toggle
                  key={id}
                  label={MODS[id].label}
                  help={MODS[id].description}
                  checked={mods.includes(id)}
                  onChange={(on) => setMods((cur) => (on ? cleanMods([...cur, id], modeId) : cur.filter((m) => m !== id)))}
                />
              ))}
              <p className="mt-2 text-sm text-ink-2">Levels change only after plays with no mods, or with Mirror alone.</p>
            </Card>
          )}
        </div>

        <aside className="space-y-6">
          {shownLevels.length > 0 && (
            <Card>
              <SectionTitle>Your level</SectionTitle>
              <ul className="space-y-1">
                {shownLevels.map((id) => {
                  const row = data?.progress[id];
                  return (
                    <li key={id} className="flex justify-between">
                      <span>{MODES[id].label}</span>
                      <span className="text-ink-2">{row ? level(row.level) : `${DEFAULT_MODULE_LEVEL}.0, not played yet`}</span>
                    </li>
                  );
                })}
              </ul>
              {info.adaptive && <p className="mt-2 text-sm text-ink-2">The level moves after every set to keep about 70% to 86% of targets a success.</p>}
            </Card>
          )}
          {shownLevels.length === 0 && info.skills.length > 0 && (
            <Card>
              <p className="text-sm text-ink-2">Trains {info.skills.map((s) => SKILLS[s].label.toLowerCase()).join(' and ')} at a fixed level taken from your module levels.</p>
            </Card>
          )}
          <Card>
            <SectionTitle>Length</SectionTitle>
            <Segmented legend="Length" value={lengthSec} options={info.lengthOptions.map((n) => ({ value: n, label: n >= 120 ? `${n / 60} min` : `${n} s` }))} onChange={setLengthSec} />
            <Toggle label="Full screen" checked={fullscreen} onChange={setFullscreen} />
            <Button variant="primary" size="lg" className="mt-3 w-full" disabled={!mixValid || !levels} onClick={start}>
              {drill?.drillId ? 'Start drill' : 'Start'}
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
