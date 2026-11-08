// The in-app guide. It explains what the README explains, in the same words where the facts are the same. Numbers that
// have a constant in the catalog are read from it. The others are copied from the code and checked when that code changes.

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import {
  DAILY_LENGTH_SEC,
  DEFAULT_MODULE_LEVEL,
  DEFAULT_SETTINGS,
  GRADES,
  JUDGMENTS,
  LEVEL_PRESETS,
  MODES,
  MODS,
  MODULE_IDS,
  PLACEMENT,
  RETRY_HOLD_MS,
  windowsForTiming,
} from '../../shared/catalog';
import type { ModId } from '../../shared/types';
import { Card, LinkButton, PageHeader, SectionTitle, keyLabel } from '../components/ui';
import { INTRO, PLACEMENT_TIME } from '../copy';
import { andList, level, lowerLabel, pct0 } from '../format';
import { FRAME_STEP_MS, SEEK_STEP_MS } from '../state/replayMarkers';
import { LOCALES } from '../../shared/locales';
import { msg, t, tx } from '../i18n';
import { useSettings } from '../state/store';

const SECTIONS = [
  ['playing', msg('Playing')],
  ['modes', msg('Modes')],
  ['mods', msg('Mods')],
  ['controls', msg('Controls')],
  ['replays', msg('Replays')],
  ['stats', msg('Stats and insights')],
  ['habits', msg('Practice habits')],
  ['calibration', msg('Calibration')],
  ['offline', msg('Offline and install')],
  ['accessibility', msg('Accessibility')],
  ['data', msg('Your data')],
  ['browsers', msg('Browser notes')],
] as const;

type SectionId = (typeof SECTIONS)[number][0];

function Section({ id, title, children }: { id: SectionId; title: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-20">
      <Card>
        <SectionTitle>{title}</SectionTitle>
        <div className="space-y-3 text-ink-2 [&_strong]:text-ink">{children}</div>
      </Card>
    </div>
  );
}

/** A definition list drawn as two columns on wide screens. */
function Terms({ rows }: { rows: readonly [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[minmax(8rem,auto)_1fr]">
      {rows.map(([term, text], i) => (
        <div key={i} className="contents">
          <dt className="text-ink">{term}</dt>
          <dd className="m-0 sm:mb-0">{text}</dd>
        </div>
      ))}
    </dl>
  );
}

function Key({ children }: { children: ReactNode }) {
  return <kbd className="rounded-sm border border-line-2 bg-bg-2 px-1.5 font-sans text-xs text-ink">{children}</kbd>;
}

/** A hash such as "%E0" is not valid UTF-8, and a bad link should not take the page down. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const MOD_ORDER: readonly ModId[] = [
  'fade',
  'spotlight',
  'fast',
  'slow',
  'tight',
  'wide',
  'mirror',
  'nofail',
  'onelife',
  'bullseye',
  'norings',
];

export function Guide() {
  const [settings] = useSettings();
  const { hash } = useLocation();
  const windows = windowsForTiming(5);
  const hitKeys = settings.input.keys.map(keyLabel);
  const retryKey = settings.input.retryKey;
  const hitParts = { first: <Key>{hitKeys[0]}</Key>, second: <Key>{hitKeys[1]}</Key> };

  // A footer link such as /guide#controls lands here from another page, where the router does not scroll to the anchor.
  useEffect(() => {
    if (hash.length > 1) document.getElementById(safeDecode(hash.slice(1)))?.scrollIntoView();
  }, [hash]);

  return (
    <>
      <PageHeader title={t('Guide')} intro={INTRO.guide} />
      <nav aria-label={t('Guide sections')} className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 whitespace-nowrap px-3 py-2 text-ink-2 transition hover:text-ink">
            {t(label)}
          </a>
        ))}
      </nav>

      <div className="space-y-6">
        <Section id="playing" title={t('Playing')}>
          <p>
            {t(
              'You click targets in time with a beat. Every click is saved with its position, its timing and the movement that led to it, and the stats pages turn that into ratings, trends and advice.',
            )}
          </p>
          <p>{t('Targets come in three kinds.')}</p>
          <Terms
            rows={[
              [t('Circles'), t('Click them as the approach ring closes.')],
              [t('Sliders'), t('Hold a key or button and follow the moving ball to the end.')],
              [t('Spinners'), t('Hold and move the cursor in circles around the center until the spinner is done.')],
            ]}
          />
          <p>
            {tx(
              'Each click is judged {crisp}, {solid}, {rough} or {miss}. The windows depend on the timing setting of the map. At timing strictness 5 they are {crispMs}, {solidMs} and {roughMs} ms either side of the beat. The Dynamic levels use strictness 1 to 8, so a higher level also means tighter windows.',
              {
                crisp: <strong>{JUDGMENTS.crisp.label}</strong>,
                solid: <strong>{JUDGMENTS.solid.label}</strong>,
                rough: <strong>{JUDGMENTS.rough.label}</strong>,
                miss: <strong>{JUDGMENTS.miss.label}</strong>,
                crispMs: windows.crisp,
                solidMs: windows.solid,
                roughMs: windows.rough,
              },
            )}
          </p>
          <p>{t('A finished play gets a grade from its accuracy and its misses.')}</p>
          <Terms
            rows={GRADES.map((g) => [
              g.label,
              g.minAccuracy === 0
                ? t('Below the others.')
                : g.noMisses
                  ? t('{pct} accuracy or more, with no misses.', { pct: pct0(g.minAccuracy) })
                  : t('{pct} accuracy or more.', { pct: pct0(g.minAccuracy) }),
            ])}
          />
        </Section>

        <Section id="modes" title={t('Modes')}>
          <p>
            {tx(
              '{dynamic} builds a full map from a seed. Each map is planned as an intro, a build, a peak, rests and an outro, so its difficulty rises and falls. Pick a level from 1 to 8, or set each part of the difficulty yourself. The same seed gives the same map in the same browser.',
              { dynamic: <strong>{MODES.dynamic.label}</strong> },
            )}
          </p>
          <Terms
            rows={LEVEL_PRESETS.map((p) => [
              p.label,
              `${p.description} ${t('{n, plural, one {# second} other {# seconds}} by design.', { n: p.lengthSec })}`,
            ])}
          />
          <p>
            {tx(
              '{modules} play short sets and change their difficulty after every set, so that about 70% to 86% of targets count as a success. Every module starts at level {level} until the placement test or your plays move it.',
              { modules: <strong>{t('Training modules')}</strong>, level: level(DEFAULT_MODULE_LEVEL) },
            )}
          </p>
          <Terms rows={MODULE_IDS.map((id) => [MODES[id].label, MODES[id].description])} />
          <Terms
            rows={[
              [MODES.mix.label, MODES.mix.description],
              [MODES.warmup.label, MODES.warmup.description],
              [MODES.stamina.label, MODES.stamina.description],
              [
                MODES.placement.label,
                t('{sets} short sets of each of {modules}. It takes {time} and sets the level each module starts at.', {
                  sets: PLACEMENT.setsPerModule,
                  modules: andList(PLACEMENT.modules.map((m) => lowerLabel(MODES[m].label))),
                  time: t(PLACEMENT_TIME),
                }),
              ],
            ]}
          />
        </Section>

        <Section id="mods" title={t('Mods')}>
          <p>
            {t(
              "Mods change how a map plays, and each one has a score multiplier. Personal bests are kept separately for each set of mods. A module's level changes only after plays with no mods, or with Mirror alone.",
            )}
          </p>
          <Terms
            rows={MOD_ORDER.map((id) => {
              const m = MODS[id];
              const conflicts = m.conflicts.length
                ? ` ${t("Can't be combined with {mods}.", { mods: andList(m.conflicts.map((c) => MODS[c].label)) })}`
                : '';
              return [`${m.label}, x${m.multiplier}`, `${m.description}${conflicts}`];
            })}
          />
        </Section>

        <Section id="controls" title={t('Controls')}>
          <Terms
            rows={[
              [
                t('Hit', undefined, 'action'),
                <>
                  {settings.input.mouseButtons
                    ? tx('Click, or press {first} or {second}. Both keys can be changed in Settings.', hitParts)
                    : tx('Press {first} or {second}. Both keys can be changed in Settings.', hitParts)}{' '}
                  {settings.input.mouseButtons
                    ? t('Left and right mouse buttons count too, and you can hold one while pressing the other.')
                    : t('Mouse buttons are turned off in Settings, so only the keys hit.')}
                </>,
              ],
              [t('Pause'), tx('Press {esc}. The pause menu has Resume, Restart and Quit.', { esc: <Key>Esc</Key> })],
              [
                t('Retry'),
                retryKey === ''
                  ? t('The retry key is turned off. Turn it on in Settings to restart a map by holding a key.')
                  : t(
                      'Hold the {key} key for {n, plural, one {# second} other {# seconds}} during a play to end it and start the same map again.',
                      {
                        key: keyLabel(retryKey),
                        n: RETRY_HOLD_MS / 1000,
                      },
                    ),
              ],
              [
                t('Results'),
                tx('{r} retries, {n} plays a new map, {w} watches the replay and {esc} goes back.', {
                  r: <Key>R</Key>,
                  n: <Key>N</Key>,
                  w: <Key>W</Key>,
                  esc: <Key>Esc</Key>,
                }),
              ],
              [
                t('Raw input'),
                t(
                  'Locks the pointer and reads mouse movement directly. It needs a click to lock again after a pause, which is why Resume is a button.',
                ),
              ],
              [t('Menus'), t('Tab moves between controls and the arrow keys change options in a group.')],
            ]}
          />
        </Section>

        <Section id="replays" title={t('Replays')}>
          <p>
            {t(
              'The engine records every input on a fixed time and position grid, and a replay plays that record back through the same game rules. The viewer has play and pause, speeds from 0.25x to 2x, a scrubber with markers for misses and broken sliders, and a list of misses that jumps to the moment before each one.',
            )}
          </p>
          <Terms
            rows={[
              [<Key key="space">Space</Key>, t('Plays and pauses.')],
              [
                <span key="seek">
                  <Key>Left</Key> <Key>Right</Key>
                </span>,
                t('Seek {n, plural, one {# second} other {# seconds}}.', { n: SEEK_STEP_MS / 1000 }),
              ],
              [
                <span key="frame">
                  <Key>,</Key> <Key>.</Key>
                </span>,
                t('Step one frame of {ms} ms.', { ms: FRAME_STEP_MS }),
              ],
              [
                <span key="speed">
                  <Key>[</Key> <Key>]</Key>
                </span>,
                t('Change the speed.'),
              ],
              [<Key key="miss">M</Key>, t('Jumps to the next miss.')],
            ]}
          />
          <p>
            {t(
              'Mark a replay to keep it and it is never removed. Results and the play detail page link to the replay. The newest {n, plural, one {# replay is} other {# replays are}} kept by default, and Settings offers other limits.',
              { n: DEFAULT_SETTINGS.data.replayLimit ?? 0 },
            )}
          </p>
        </Section>

        <Section id="stats" title={t('Stats and insights')}>
          <p>
            {t(
              'Each saved play keeps a summary and, for a while, a record of every object. A summary holds the score, accuracy, timing, aim errors, movement metrics and grouped statistics that show up on the Patterns and Aim tabs.',
            )}
          </p>
          <Terms
            rows={[
              [
                t('Aim errors'),
                t(
                  "Measured in target radii and shown as a percentage of a target's width. Along the movement, a positive value means you went past the target. Across the movement, a positive value means to the right of the line you moved along.",
                ),
              ],
              [
                t('Movement'),
                t(
                  'These come from the cursor path before each click. They are when you leave the previous target, where your first motion stops, and how far you move afterwards to correct it.',
                ),
              ],
              [
                t('Throughput'),
                t(
                  'In bits per second. Your jumps are grouped by distance and time, the spread of your clicks around the target is measured for each group, and distance and spread are combined into one number. It needs at least 15 jumps in a play.',
                ),
              ],
              [
                t('Ratings'),
                t(
                  'Aim, speed, tracking, precision, timing, reading and spinning. For each play, the demand of the map is converted to the level 1 to 8 scale, then multiplied by your performance squared. A rating is a weighted mean of your best 20 scores from the last 60 days. It is marked provisional below 5 plays, and the tier is its whole-number part.',
                ),
              ],
              [
                t('Insights'),
                t(
                  'Rules that look at your clicks from the last 30 days, at most 3000 of them. Each rule needs a minimum number of clicks and a clear effect before it says anything. Every insight states its numbers and how many clicks they came from, and names a module and options to train it with.',
                ),
              ],
              [
                t('Drills'),
                t(
                  'Start from the Train this button on an insight. Heartbeat stores the measurement the insight was based on. After at least 3 drill sessions it measures the same thing on plays outside the drill, so you can see whether the change carried over. The result is better, no clear change or worse, and it locks after 30 days.',
                ),
              ],
              [t('This week'), t('Compares the last 7 days with the 4 weeks before them, and reports only the changes that are clear.')],
            ]}
          />
        </Section>

        <Section id="habits" title={t('Practice habits')}>
          <Terms
            rows={[
              [
                t('Daily plan'),
                t(
                  'Each day has a plan of four steps, which are a warm-up, two drills chosen from your insights and ratings, and a Dynamic play at a suggested level. A step is ticked off when you finish it or play it for at least a minute.',
                ),
              ],
              [
                t('Daily map'),
                t(
                  'One Dynamic map a day of {n, plural, one {# second} other {# seconds}}, made from the date. It changes at your local midnight. Players who pick the same level on the same date start from the same seed, though another browser can build it a little differently.',
                  { n: DAILY_LENGTH_SEC },
                ),
              ],
              [
                t('Streaks'),
                t(
                  'A streak counts days in a row with at least one saved play that you finished or played for at least a minute. The weekly goal counts minutes from Monday to Sunday against the target in Settings, which is {n} by default.',
                  { n: DEFAULT_SETTINGS.goals.weeklyMinutes },
                ),
              ],
              [
                t('Milestones'),
                t(
                  'Plays, hours, streaks, combos, daily maps, a drill that worked, the placement test and clearing each level 1 to 8 with 90% accuracy are marked the first time you reach them.',
                ),
              ],
              [
                t('Share links'),
                t(
                  'Share map on the play setup, the results and the Daily page copies a link. Opening it fills in the setup with the same mode, difficulty, mods, length and seed. It never starts a play by itself, and module links use your own levels.',
                ),
              ],
            ]}
          />
        </Section>

        <Section id="calibration" title={t('Calibration')}>
          <p>
            {t(
              'Displays and speakers delay what you see and hear. The calibration page measures that delay. Visual calibration shows a target whose ring closes every 600 ms, and audio calibration plays a metronome click at the same interval.',
            )}
          </p>
          <p>
            {t(
              'The first press starts the run. After four lead-in beats, you tap 24 times with a hit key or a mouse button. Taps more than 200 ms from a beat are dropped. The result is the median of your taps, with their spread, and above 30 ms of spread the page asks you to try again.',
            )}
          </p>
          <p>
            {t(
              'Apply saves the rounded median as the visual offset or the audio offset. The visual offset draws targets earlier, and the audio offset plays the metronome earlier. Hit sounds always play at once.',
            )}
          </p>
          <LinkButton to="/calibrate?kind=visual" size="sm">
            {t('Calibrate now')}
          </LinkButton>
        </Section>

        <Section id="offline" title={t('Offline and install')}>
          <p>
            {t(
              'After the first visit, Heartbeat loads without a connection. When a new version is ready, a banner offers a reload. Browsers that support it offer Install in Settings, under App, so Heartbeat opens from your desktop or home screen.',
            )}
          </p>
        </Section>

        <Section id="accessibility" title={t('Accessibility')}>
          <p>
            {t(
              'Heartbeat can be used with a keyboard, with a screen reader, in another language and on a light or a dark screen. The choices are under Accessibility and Look in Settings.',
            )}
          </p>
          <Terms
            rows={[
              [
                t('Language'),
                t(
                  '{n} languages. Automatic follows your browser, and Settings lets you pick one. English is the source text and the others are translations, so a sentence that reads oddly is worth a report.',
                  { n: LOCALES.length },
                ),
              ],
              [
                t('Theme'),
                t(
                  'Dark, light, or whatever your operating system uses. The playfield follows, and on the light theme the target colors are darkened so they stay visible on white.',
                ),
              ],
              [
                t('Text size'),
                t('Three sizes for the text on every page. The playfield keeps its size, because target size is part of the difficulty.'),
              ],
              [
                t('High contrast'),
                t('Stronger text, lines and focus rings. It also turns on when your operating system asks for more contrast.'),
              ],
              [
                t('Reduce motion'),
                t(
                  'Turns off page animations and the sparks, shakes and flashes in a play. On the first visit it follows your operating system.',
                ),
              ],
              [
                t('Colors'),
                t(
                  'The Clear view palette uses colors that stay apart with red-green color blindness. A judgment is also shown as a word and played as a sound, so no information is carried by color alone.',
                ),
              ],
              [
                t('Keyboard'),
                t(
                  'Every control can be reached with Tab, and groups of choices move with the arrow keys. A skip link at the top of each page goes straight to the content. In a play, two keys of your choice count as hits, Esc pauses, and the retry key restarts.',
                ),
              ],
              [
                t('Screen readers'),
                t('Pages have landmarks and headings, every control has a name, and a play says when it starts, pauses and ends.'),
              ],
            ]}
          />
          <LinkButton to="/settings#settings-access" size="sm">
            {t('Open accessibility settings')}
          </LinkButton>
        </Section>

        <Section id="data" title={t('Your data')}>
          <p>
            {t(
              'Everything is stored in this browser. There is no account, there are no cookies, and nothing is sent anywhere. Heartbeat has no analytics of its own and asks for nothing about you.',
            )}
          </p>
          <Terms
            rows={[
              [t('Play summaries'), t('Kept forever.')],
              [
                t('Per-object detail'),
                t(
                  "Kept for {n, plural, one {# day} other {# days}} by default. You can change this in Settings. Removing old detail doesn't change ratings, trends or bests.",
                  { n: DEFAULT_SETTINGS.data.detailRetentionDays ?? 0 },
                ),
              ],
              [
                t('Replays'),
                t(
                  'Stored compressed. The newest {n} are kept by default. Replays you mark to keep, and replays of new bests, are never removed.',
                  {
                    n: DEFAULT_SETTINGS.data.replayLimit ?? 0,
                  },
                ),
              ],
              [
                t('Export and import'),
                t(
                  'Settings can export everything as a .json or .json.gz file and import it again. Without replays the file is much smaller. Importing skips plays that are already there, and files from version 1.0 still import.',
                ),
              ],
              [
                t('The browser'),
                t(
                  'It can clear site data. Settings shows whether it has agreed to keep yours, and a regular export is the safe copy. Data belongs to one address, so moving to a new address means exporting here and importing there.',
                ),
              ],
              [t('Delete'), t('Settings can delete every play, progress and drill. Your settings stay.')],
            ]}
          />
          <LinkButton to="/settings#settings-data" size="sm">
            {t('Open data settings')}
          </LinkButton>
        </Section>

        <Section id="browsers" title={t('Browser notes')}>
          <Terms
            rows={[
              [t('Chrome and Firefox'), t('The main targets. Safari works with a few differences.')],
              [
                t('Raw input'),
                t(
                  'Without acceleration it needs a recent browser. When that is not available, Heartbeat falls back to raw input with acceleration and says so in Settings.',
                ),
              ],
              [
                t('Latency'),
                t(
                  'Safari has no high-rate pointer events, and Firefox has no low latency canvas. Both play normally with slightly more delay.',
                ),
              ],
              [t('Pens and tablets'), t('They are absolute devices, so they use the normal cursor even when raw input is on.')],
              [
                t('Seeds'),
                t(
                  'The same seed can give a slightly different map in a different browser, because math functions differ a little between them. Saved plays store positions, so your stats never depend on regenerating a map.',
                ),
              ],
            ]}
          />
        </Section>
      </div>
    </>
  );
}
