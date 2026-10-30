// Text that appears in more than one place, and page intros. Follows reference/writing.md.

export const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/play', label: 'Play', end: false },
  { to: '/train', label: 'Train', end: false },
  { to: '/stats', label: 'Stats', end: false },
] as const;

export const INTRO = {
  home: 'Flickwise is an aim trainer that shows where you miss and what to practice.',
  play: 'Choose how hard the map is. Each map is generated from a seed.',
  train: 'Short modules that raise or lower their difficulty after every set.',
  settings: 'Input, sound, display and your saved data.',
  stats: 'Ratings, trends and the patterns in how you aim and time your clicks.',
  overview: 'Your ratings and the next thing to practice.',
  trends: 'How your numbers change from day to day.',
  patterns: 'Where on the screen and at which speeds you miss.',
  timing: 'When your clicks land compared with the beat.',
  bests: 'Your best scores and module levels.',
  history: 'Every play, newest first.',
} as const;

export const TIER_NOTE = 'A tier is the whole-number part of a rating. Ratings marked provisional are based on fewer than 5 plays.';

export const EMPTY_STATS = 'Nothing here yet. Play a few maps and your stats will show up.';

export const OUTDATED = 'Flickwise was updated in another tab. Reload to continue.';

export const PREVIEW_UNAVAILABLE = 'The map preview is not available yet, so only the values set directly by your choices are shown.';

export const FAKE_BANNER = 'Fake game mode is on. Plays return made-up results after 3 seconds.';

export const SKILL_EXPLAIN: Record<string, string> = {
  aim: 'Rating from jump length and speed, scaled by how many jumps you hit and how close to the center.',
  speed: 'Rating from stream tempo, scaled by the average judgment on stream notes, where Crisp counts most.',
  tracking: 'Rating from slider speed, scaled by how much of each slider you keep.',
  precision: 'Rating from target size, scaled by how close to the center you click.',
  timing: 'Rating from hit window size, scaled by your share of Crisp hits.',
  reading: 'Rating from approach time, with Fade and Spotlight counting extra, scaled by your hit rate.',
  spin: 'Rating from spinner speed, scaled by how many rotations you finish.',
};

/** The sentence under a trend chart when the last 14 days differ clearly from the 14 before. */
export function changeSentence(label: string, before: string, after: string, diff: number, improved: boolean | null): string {
  const lead = `${label} averaged ${after} over the last 14 days, ${diff > 0 ? 'up' : 'down'} from ${before} in the 14 days before.`;
  if (improved === null) return lead;
  return `${lead} That is ${improved ? 'an improvement' : 'a step back'}.`;
}
