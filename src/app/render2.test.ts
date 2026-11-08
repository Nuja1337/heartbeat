// Server renders of the 2.0 charts and cards, with fixture data, to catch crashes in render code.

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { makeFixture } from '../analytics/fixtures';
import { allRatings } from '../analytics/ratings';
import { summarizePlay } from '../analytics/summary';
import { dailyStreak, playStreak, weeklyGoal } from '../analytics/training';
import { fatigueCurve, radarData, radarMax, ratingHistory, throughputScatter } from '../analytics/views';
import { Fatigue } from './charts/Fatigue';
import { RatingHistory } from './charts/RatingHistory';
import { ThroughputScatter } from './charts/ThroughputScatter';
import { Timeline } from './charts/Timeline';
import { Radar } from './components/Radar';
import { SectionStrip } from './components/SectionStrip';
import { StreakCard } from './components/StreakCard';
import { WeeklyChanges } from './components/WeeklyChanges';

const fx = makeFixture({ seed: 11, objects: 220, longAlong: -0.3, jumpsOnly: true });
const summary = summarizePlay(fx.result, { id: 'x' });
const NOW = summary.endedAt + 1000;

describe('2.0 charts and cards render', () => {
  it('radar, with and without ratings', () => {
    const ratings = allRatings([summary], NOW);
    const html = renderToString(createElement(Radar, { axes: radarData(ratings), max: radarMax(radarData(ratings)) }));
    expect(html).toContain('svg');
    expect(html).toContain('Aim');
    const empty = radarData(allRatings([], NOW));
    expect(renderToString(createElement(Radar, { axes: empty, max: radarMax(empty) }))).toContain('no rating');
  });

  it('fatigue curve and its short-play message', () => {
    const points = fatigueCurve(fx.records);
    expect(points.length).toBeGreaterThan(2);
    expect(renderToString(createElement(Fatigue, { points }))).toContain('path');
    expect(renderToString(createElement(Fatigue, { points, compact: true }))).toContain('at the end');
    expect(renderToString(createElement(Fatigue, { points: [] }))).toContain('too short');
  });

  it('throughput scatter and rating history', () => {
    const points = throughputScatter([{ summary, records: fx.records }]);
    expect(renderToString(createElement(ThroughputScatter, { points }))).toContain('svg');
    expect(renderToString(createElement(ThroughputScatter, { points: [] }))).toContain('Not enough jumps');
    const line = ratingHistory([summary], 90, NOW).find((l) => l.skill === 'aim')!;
    // One rated day draws a dot and no line.
    const oneDay = renderToString(createElement(RatingHistory, { points: line.points, label: 'Aim' }));
    expect(oneDay).toContain('circle');
    expect(oneDay).not.toContain('<path');
    const none = ratingHistory([], 90, NOW)[0]!;
    expect(renderToString(createElement(RatingHistory, { points: none.points, label: 'Aim' }))).toContain('No rating');
  });

  it('section strip', () => {
    expect(renderToString(createElement(SectionStrip, { sections: summary.sections }))).toBeTruthy();
    expect(renderToString(createElement(SectionStrip, { sections: null }))).toContain('no section data');
  });

  it('timeline with and without replay links', () => {
    const plain = renderToString(createElement(Timeline, { records: fx.records }));
    const linked = renderToString(createElement(Timeline, { records: fx.records, onOpen: () => undefined }));
    expect(plain).not.toContain('Enter or Space');
    expect(linked).toContain('Enter or Space');
    // The points are one list outside the image, with a single tab stop, and nothing inside the image can be focused.
    for (const html of [plain, linked]) {
      expect(html.match(/role="listbox"/g)).toHaveLength(1);
      expect(html.match(/tabindex="0"/g)).toHaveLength(1);
      const svg = html.slice(html.indexOf('<svg'), html.indexOf('</svg>'));
      expect(svg).not.toContain('tabindex');
    }
  });

  it('streak card and weekly changes', () => {
    const html = renderToString(
      createElement(
        MemoryRouter,
        null,
        createElement(StreakCard, { streak: playStreak([summary], NOW), week: weeklyGoal([summary], 60, NOW), goalMinutes: 60 }),
        createElement(WeeklyChanges, { changes: [] }),
      ),
    );
    expect(html).toContain('This week');
    expect(html).toContain('Nothing has changed clearly yet');
    expect(dailyStreak([summary], NOW).current).toBe(0);
  });
});
