import { useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { OCTANT_PHRASE } from '../../analytics/insightCopy';
import { DEFAULT_MODULE_LEVEL, MODES, MODS, MODULE_IDS, SKILLS } from '../../shared/catalog';
import type { LaunchRequest, ModId, ModeId, ModuleId, ModuleOptions } from '../../shared/types';
import { Button, Card, Field, LinkButton, Notice, PageHeader, Segmented, SectionTitle, StickyStart, Toggle } from '../components/ui';
import { andList, level, lowerLabel } from '../format';
import { t } from '../i18n';
import { useAnalysis } from '../state/analysis';
import { useCurrentLevels } from '../state/levels';
import { cleanMods, moduleLaunch, randomSeed, sharedFrom, startPlay } from '../state/launch';
import { getAppState, updatePrefs } from '../state/store';
import { SharedBanner } from './Share';

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** A length in seconds, or in minutes from two minutes up. */
const lengthText = (sec: number): string => (sec >= 120 ? t('{n} min', { n: sec / 60 }) : `${sec} s`);

export function ModuleSetup() {
  const { mode } = useParams();
  const info = mode && mode in MODES ? MODES[mode as ModeId] : null;
  if (!info || info.id === 'dynamic' || info.id === 'placement') return <Navigate to="/train" replace />;
  return <Setup key={info.id} modeId={info.id} />;
}

function Setup({ modeId }: { modeId: ModeId }) {
  const info = MODES[modeId];
  const navigate = useNavigate();
  const location = useLocation();
  const { data } = useAnalysis();
  const prefill = (location.state as { prefill?: LaunchRequest } | null)?.prefill;
  const drill = prefill && prefill.modeId === modeId ? prefill : null;
  const shared = sharedFrom(location.state, modeId);
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
    const launch = moduleLaunch({
      modeId,
      options,
      mods,
      lengthSec,
      seed: drill?.seed ?? randomSeed(),
      levels,
      drillId: drill?.drillId ?? null,
    });
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
        actions={
          <LinkButton to="/train" variant="ghost">
            {t('All modules')}
          </LinkButton>
        }
      />
      {shared && (
        <div className="mb-6">
          <SharedBanner generatorVersion={shared.shared.generatorVersion} />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {drill?.drillId && (
            <Card>
              <p>{t('This drill was set up from an insight. Your results will be compared with how you played before.')}</p>
            </Card>
          )}

          {info.options.length > 0 && (
            <Card>
              <SectionTitle>{t('Options')}</SectionTitle>
              {info.options.includes('distanceFocus') && (
                <Field label={t('Jump distance')}>
                  <Segmented
                    legend={t('Jump distance')}
                    value={options.distanceFocus ?? 'mixed'}
                    onChange={(v) => set({ distanceFocus: v })}
                    options={[
                      { value: 'mixed', label: t('Mixed') },
                      { value: 'short', label: t('Short') },
                      { value: 'long', label: t('Long') },
                    ]}
                  />
                </Field>
              )}
              {info.options.includes('directionFocus') && (
                <Field label={t('Direction')} help={t('Most jumps will move this way.')}>
                  <select
                    aria-label={t('Direction')}
                    value={options.directionFocus ?? ''}
                    onChange={(e) => set({ directionFocus: e.target.value === '' ? null : Number(e.target.value) })}
                  >
                    <option value="">{t('Any direction')}</option>
                    {OCTANT_PHRASE.map((name, i) => (
                      <option key={name} value={i}>
                        {cap(t(name))}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {info.options.includes('angleFocus') && (
                <Field label={t('Turns')}>
                  <Segmented
                    legend={t('Turns')}
                    value={options.angleFocus ?? 'mixed'}
                    onChange={(v) => set({ angleFocus: v })}
                    options={[
                      { value: 'mixed', label: t('Mixed') },
                      { value: 'sharp', label: t('Sharp') },
                      // The mod of the same name makes targets bigger, so this one needs its own context.
                      { value: 'wide', label: t('Wide', undefined, 'turn angle') },
                    ]}
                  />
                </Field>
              )}
              {info.options.includes('streamLength') && (
                <Field label={t('Stream length')} help={t('Short is 3 to 5 taps, medium 6 to 12 and long 13 to 24.')}>
                  <Segmented
                    legend={t('Stream length')}
                    value={options.streamLength ?? 'medium'}
                    onChange={(v) => set({ streamLength: v })}
                    options={[
                      { value: 'short', label: t('Short') },
                      { value: 'medium', label: t('Medium') },
                      { value: 'long', label: t('Long') },
                    ]}
                  />
                </Field>
              )}
              {info.options.includes('sliderFocus') && (
                <Field label={t('Sliders')}>
                  <Segmented
                    legend={t('Sliders')}
                    value={options.sliderFocus ?? 'mixed'}
                    onChange={(v) => set({ sliderFocus: v })}
                    options={[
                      { value: 'mixed', label: t('Mixed') },
                      { value: 'straight', label: t('Straight') },
                      { value: 'curves', label: t('Curves') },
                      { value: 'repeats', label: t('Repeats') },
                    ]}
                  />
                </Field>
              )}
              {info.options.includes('mixModules') && (
                <Field label={t('Modules in this mix')} help={t('Pick 2 to 4. They play in the order you pick them, one set each.')}>
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {MODULE_IDS.map((id) => {
                      const on = mix.includes(id);
                      const full = !on && mix.length >= 4;
                      return (
                        <li key={id}>
                          <label className={`flex items-center gap-2 py-1 ${full ? 'opacity-40' : 'cursor-pointer'}`}>
                            <input
                              type="checkbox"
                              className="accent-[var(--color-accent)]"
                              checked={on}
                              disabled={full}
                              onChange={(e) => toggleMix(id, e.target.checked)}
                            />
                            <span>{MODES[id].label}</span>
                            {on && <span className="text-sm text-ink-2">{mix.indexOf(id) + 1}</span>}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  {!mixValid && (
                    <p role="status" className="text-sm text-warn">
                      {t('Pick at least 2 modules.')}
                    </p>
                  )}
                </Field>
              )}
            </Card>
          )}

          {info.allowedMods.length > 0 && (
            <Card>
              <SectionTitle>{t('Mods')}</SectionTitle>
              {info.allowedMods.map((id) => (
                <Toggle
                  key={id}
                  label={MODS[id].label}
                  help={MODS[id].description}
                  checked={mods.includes(id)}
                  onChange={(on) => setMods((cur) => (on ? cleanMods([...cur, id], modeId) : cur.filter((m) => m !== id)))}
                />
              ))}
              <p className="mt-2 text-sm text-ink-2">
                {t('Levels change only after plays with no mods, or with {mirror} alone.', { mirror: MODS.mirror.label })}
              </p>
            </Card>
          )}
        </div>

        <aside className="space-y-6">
          {shownLevels.length > 0 && (
            <Card>
              <SectionTitle>{t('Your level')}</SectionTitle>
              <ul className="space-y-1">
                {shownLevels.map((id) => {
                  const row = data?.progress[id];
                  return (
                    <li key={id} className="flex justify-between">
                      <span>{MODES[id].label}</span>
                      <span className="text-ink-2">
                        {row ? level(row.level) : t('{level}, not played yet', { level: level(DEFAULT_MODULE_LEVEL) })}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {info.adaptive && (
                <p className="mt-2 text-sm text-ink-2">
                  {t('The level moves after every set to keep about 70% to 86% of targets a success.')}
                </p>
              )}
            </Card>
          )}
          {shownLevels.length === 0 && info.skills.length > 0 && (
            <Card>
              <p className="text-sm text-ink-2">
                {t('Trains {skills} at a fixed level taken from your module levels.', {
                  skills: andList(info.skills.map((s) => lowerLabel(SKILLS[s].label))),
                })}
              </p>
            </Card>
          )}
          <Card>
            <SectionTitle>{t('Length')}</SectionTitle>
            <Segmented
              legend={t('Length')}
              value={lengthSec}
              options={info.lengthOptions.map((n) => ({ value: n, label: lengthText(n) }))}
              onChange={setLengthSec}
            />
            <Toggle label={t('Full screen')} checked={fullscreen} onChange={setFullscreen} />
            <Button variant="primary" size="lg" className="mt-3 w-full max-lg:hidden" disabled={!mixValid || !levels} onClick={start}>
              {drill?.drillId ? t('Start drill') : t('Start')}
            </Button>
            {levelsError && (
              <div className="mt-3">
                <Notice tone="bad">{t('{error} Reload the page to try again.', { error: levelsError })}</Notice>
              </div>
            )}
          </Card>
        </aside>
      </div>
      <StickyStart summary={t('{mode}, {length}', { mode: info.label, length: lengthText(lengthSec) })}>
        <Button variant="primary" size="lg" className="px-8" disabled={!mixValid || !levels} onClick={start}>
          {drill?.drillId ? t('Start drill') : t('Start')}
        </Button>
      </StickyStart>
    </>
  );
}
