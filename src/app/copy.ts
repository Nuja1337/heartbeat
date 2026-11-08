// Text that appears in more than one place, and page intros. Follows reference/writing.md. The constants hold the
// English, marked with msg(); the page that shows one passes it through t(). INTRO and SKILL_EXPLAIN translate on read.

import { msg, t } from '../shared/i18n';

export const NAV = [
  { to: '/', label: msg('Home'), end: true },
  { to: '/play', label: msg('Play'), end: false },
  { to: '/train', label: msg('Train'), end: false },
  { to: '/daily', label: msg('Daily'), end: false },
  { to: '/stats', label: msg('Stats'), end: false },
] as const;

export const FOOTER = [
  { to: '/guide', label: msg('Guide') },
  { to: '/guide#controls', label: msg('Controls') },
  { to: '/guide#accessibility', label: msg('Accessibility') },
  { to: '/guide#data', label: msg('Your data') },
] as const;

export const INTRO = {
  get home() {
    return t('Heartbeat is an aim trainer that shows where you miss and what to practice.');
  },
  get play() {
    return t('Choose how hard the map is. Each map is generated from a seed.');
  },
  get train() {
    return t('Short modules that raise or lower their difficulty after every set.');
  },
  get daily() {
    return t('Each day has its own map, which stays the same until midnight at the level you pick. Your daily plays are listed here.');
  },
  get replay() {
    return t('Watch a play again, slow it down and jump to the misses.');
  },
  get aim() {
    return t('How well your clicks keep up with the distance and the time you have.');
  },
  get settings() {
    return t('Input, sound, display and your saved data.');
  },
  get stats() {
    return t('Ratings, trends and the patterns in how you aim and time your clicks.');
  },
  get overview() {
    return t('Your ratings and the next thing to practice.');
  },
  get trends() {
    return t('How your numbers change from day to day.');
  },
  get patterns() {
    return t('Where on the screen and at which speeds you miss.');
  },
  get timing() {
    return t('When your clicks land compared with the beat.');
  },
  get bests() {
    return t('Your best scores and module levels.');
  },
  get history() {
    return t('Every play, newest first.');
  },
  get guide() {
    return t('How Heartbeat works, from the hit windows to what happens to your data.');
  },
};

/** How long the placement test takes. The 240 s on its mode is only the limit. */
export const PLACEMENT_TIME = msg('about a minute');

export const TIER_NOTE = msg('A tier is the whole-number part of a rating. Ratings marked provisional are based on fewer than 5 plays.');

export const EMPTY_STATS = msg('Nothing here yet. Play a few maps and your stats will show up.');

export const OUTDATED = msg('Heartbeat was updated in another tab. Reload to continue.');

export const PREVIEW_UNAVAILABLE = msg('The map preview is not available yet, so only the values set directly by your choices are shown.');

export const FAKE_BANNER = msg('Fake game mode is on. Plays return made-up results after 3 seconds.');

export const SKILL_EXPLAIN: Record<string, string> = {
  get aim() {
    return t('Rating from jump length and speed, scaled by how many jumps you hit and how close to the center.');
  },
  get speed() {
    return t('Rating from stream tempo, scaled by the average judgment on stream notes, where Crisp counts most.');
  },
  get tracking() {
    return t('Rating from slider speed, scaled by how much of each slider you keep.');
  },
  get precision() {
    return t('Rating from target size, scaled by how close to the center you click.');
  },
  get timing() {
    return t('Rating from hit window size, scaled by your share of Crisp hits.');
  },
  get reading() {
    return t('Rating from approach time, with Fade and Spotlight counting extra, scaled by your hit rate.');
  },
  get spin() {
    return t('Rating from spinner speed, scaled by how many rotations you finish.');
  },
};

/** The sentence under a trend chart when the last 14 days differ clearly from the 14 before. */
export function changeSentence(label: string, before: string, after: string, diff: number, improved: boolean | null): string {
  const lead = t(
    '{label} averaged {after} over the last 14 days, {direction, select, up {up} other {down}} from {before} in the 14 days before.',
    {
      label,
      after,
      before,
      direction: diff > 0 ? 'up' : 'down',
    },
  );
  if (improved === null) return lead;
  return `${lead} ${improved ? t('That is an improvement.') : t('That is a step back.')}`;
}
