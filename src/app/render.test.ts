// Renders screens and charts on the server to catch crashes in render code. Data screens show
// their loading state here, so the charts are rendered separately with fixture data.

import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { makeFixture } from '../analytics/fixtures';
import { summarizePlay } from '../analytics/summary';
import { dailySeries, trendMetric } from '../analytics/trends';
import { AimScatter } from './charts/AimScatter';
import { Bars } from './charts/Bars';
import { HeatGrid } from './charts/HeatGrid';
import { Histogram, histCounts } from './charts/Histogram';
import { LineChart } from './charts/LineChart';
import { Rose } from './charts/Rose';
import { Timeline } from './charts/Timeline';
import { PlayReport } from './components/PlayReport';
import { Shell } from './layout/Shell';
import { Home } from './pages/Home';
import { ModuleSetup } from './pages/ModuleSetup';
import { PlaySetup } from './pages/PlaySetup';
import { Settings } from './pages/Settings';
import { Train } from './pages/Train';
import { Routes, Route } from 'react-router';

const at = (path: string, element: ReactElement) =>
  renderToString(
    createElement(MemoryRouter, { initialEntries: [path] }, createElement(Routes, null, createElement(Route, { path: '*', element }))),
  );

describe('screens render', () => {
  it('Home, Train, setup and Settings', () => {
    expect(at('/', createElement(Home))).toContain('Heartbeat');
    expect(at('/train', createElement(Train))).toContain('Jumps');
    const play = at('/play', createElement(PlaySetup));
    expect(play).toContain('Level 4');
    expect(play).toContain('Score multiplier');
    expect(play).toContain('Demand');
    const settings = at('/settings', createElement(Settings));
    expect(settings).toContain('Raw input');
    expect(settings).toContain('Hit key 1');
  });

  it('module setup for every module', () => {
    for (const id of ['jumps', 'angles', 'streams', 'tracking', 'spinning', 'precision', 'reading', 'timing', 'mix', 'stamina', 'warmup']) {
      const html = at(`/train/${id}`, createElement(Routes, null, createElement(Route, { path: '/train/:mode', element: createElement(ModuleSetup) })));
      expect(html).toContain('Start');
    }
  });

  it('shell shows the navigation', () => {
    expect(at('/', createElement(Shell))).toContain('Skip to content');
  });
});

describe('charts render', () => {
  const fx = makeFixture({ seed: 7, objects: 160, sliderShare: 0.1, spinnerShare: 0.03, longAlong: -0.3 });
  const summary = summarizePlay(fx.result, { id: 'x' });

  it('play report with and without detail', () => {
    expect(renderToString(createElement(PlayReport, { summary, records: fx.records }))).toContain('Accuracy');
    expect(renderToString(createElement(PlayReport, { summary, records: null }))).toContain('removed');
  });

  it('line chart, histogram, scatter, timeline and bars', () => {
    const points = dailySeries(trendMetric('accuracy'), [summary, { ...summary, startedAt: summary.startedAt + 86_400_000 * 2 }], 'all', summary.startedAt + 86_400_000 * 3);
    expect(renderToString(createElement(LineChart, { points, decimals: 1, format: (v: number) => `${v}%`, label: 'Accuracy' }))).toContain('svg');
    expect(renderToString(createElement(LineChart, { points: [], decimals: 1, format: (v: number) => `${v}%`, label: 'Accuracy' }))).toContain('No data');
    const timing = fx.records.map((r) => r.timingError).filter((v): v is number => v !== null);
    expect(renderToString(createElement(Histogram, { label: 'h', series: [{ label: 'a', color: '#fff', counts: histCounts(timing) }, { label: 'b', color: '#f00', counts: histCounts(timing.slice(5)) }], mean: 3, sd: 20, windows: { crisp: 40, solid: 80, rough: 120 } }))).toContain('svg');
    expect(renderToString(createElement(AimScatter, { records: fx.records }))).toContain('circle');
    expect(renderToString(createElement(Timeline, { records: fx.records }))).toContain('Above zero');
    expect(renderToString(createElement(Bars, { label: 'b', items: [{ label: 'a', value: 1 }] }))).toContain('a');
  });

  it('heat grid and rose', () => {
    const html = renderToString(
      createElement(HeatGrid, {
        rows: [{ key: 'r', label: 'Row' }],
        cols: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
        cell: (_r: string, c: string) => (c === 'a' ? { value: 0.2, n: 50, text: '20%' } : { value: null, n: 3, text: '' }),
        scale: 'sequential',
        max: 0.4,
        rowTitle: 'Row',
        colTitle: 'col',
        describe: () => 'x',
      }),
    );
    expect(html).toContain('20%');
    expect(html).toContain('n 3');
    const sectors = Array.from({ length: 8 }, (_, o) => ({ octant: o, value: o === 2 ? 0.3 : null, n: o === 2 ? 40 : 2, text: '30%' }));
    expect(renderToString(createElement(Rose, { sectors, scale: 'diverging', max: 0.5, metricLabel: 'bias' }))).toContain('Longer wedges');
  });
});
