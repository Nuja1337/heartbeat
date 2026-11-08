import { describe, expect, it } from 'vitest';
import type { PlayData } from '../data/schema';
import { MODES } from '../shared/catalog';
import { archiveDrill, createDrill, evaluateDrill, refreshDrill } from './drillEval';
import type { FixtureOptions } from './fixtures';
import { makeFixture, makeHistory } from './fixtures';
import { detectInsights, drillLaunch, playNotes } from './insights';
import type { Insight } from './insights';
import { drillText, insightText } from './insightCopy';
import { summarizePlay } from './summary';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

const play = (o: FixtureOptions): PlayData => {
  const fx = makeFixture(o);
  return { summary: summarizePlay(fx.result), records: fx.records };
};

/** Several days of plays that share a planted weakness. */
function history(o: FixtureOptions, count = 7, step = DAY): PlayData[] {
  return makeHistory(count, { objects: 200, jumpsOnly: true, ...o }, { endAt: NOW - 600_000, spacingMs: step }).map((fx) => ({
    summary: summarizePlay(fx.result),
    records: fx.records,
  }));
}

const find = (list: Insight[], id: string) => list.find((i) => i.ruleId === id);

describe('insight rules', () => {
  it('stays silent with fewer than 3 plays', () => {
    expect(detectInsights(history({ longAlong: -0.5 }, 2), NOW)).toEqual([]);
  });

  it('stays silent on a player with no planted weakness', () => {
    const found = detectInsights(history({ jumpsOnly: false, sliderShare: 0.1, streamShare: 1 }, 8), NOW);
    expect(found.map((i) => i.ruleId)).toEqual([]);
  });

  it('long-undershoot', () => {
    const found = detectInsights(history({ longAlong: -0.45 }), NOW);
    const i = find(found, 'long-undershoot')!;
    expect(i).toBeDefined();
    expect(found[0]!.ruleId).toBe('long-undershoot');
    expect(i.text).toMatch(
      /^You stop short on long, fast jumps \(over [\d.]+ target widths\)\. Your clicks land about \d+% of a target's width before the center\.$/,
    );
    expect(Number(i.text.match(/about (\d+)%/)![1])).toBeGreaterThanOrEqual(18);
    expect(Number(i.text.match(/about (\d+)%/)![1])).toBeLessThanOrEqual(26);
    expect(i.basis).toMatch(/^Based on \d+ jumps from the last 30 days\.$/);
    expect(i.recommendation?.modeId).toBe('jumps');
    expect(i.recommendation?.options.distanceFocus).toBe('long');
    expect(i.baseline?.kind).toBe('mean');
    expect(find(found, 'long-overshoot')).toBeUndefined();
  });

  it('long-overshoot and short-overshoot', () => {
    const found = detectInsights(history({ longAlong: 0.45, shortAlong: 0.4 }), NOW);
    expect(find(found, 'long-overshoot')?.text).toMatch(/^You overshoot long, fast jumps \(over [\d.]+ target widths\)\./);
    expect(find(found, 'long-undershoot')).toBeUndefined();
    const short = find(found, 'short-overshoot')!;
    expect(short.text).toMatch(/^You overshoot short jumps by about \d+% of a target's width\.$/);
    expect(short.recommendation?.options.distanceFocus).toBe('short');
  });

  it('direction-drift names the octant and the side', () => {
    const found = detectInsights(history({ octantLateral: { octant: 2, mean: 0.5 } }), NOW);
    const i = find(found, 'direction-drift')!;
    expect(i.text).toMatch(/^When you move down, your clicks land about \d+% of a target's width to the left of the line\.$/);
    expect(i.recommendation?.options.directionFocus).toBe(2);
    const left = find(detectInsights(history({ octantLateral: { octant: 4, mean: -0.5 } }), NOW), 'direction-drift')!;
    expect(left.text).toContain('When you move left');
    expect(left.text).toContain('below the line');
  });

  it('stream-offset says late or early', () => {
    const late = find(
      detectInsights(history({ jumpsOnly: false, streamShare: 3, sliderShare: 0, spinnerShare: 0, streamOffsetMs: 22 }), NOW),
      'stream-offset',
    )!;
    expect(late.text).toMatch(/^You're late on fast streams by about \d+ ms on average\.$/);
    expect(late.recommendation?.modeId).toBe('streams');
    expect(late.recommendation?.options.streamLength).toBe('short');
    const early = find(
      detectInsights(history({ jumpsOnly: false, streamShare: 3, sliderShare: 0, spinnerShare: 0, streamOffsetMs: -22 }), NOW),
      'stream-offset',
    )!;
    expect(early.text).toMatch(/^You rush fast streams, about \d+ ms early on average\.$/);
  });

  it('stream-fade compares the spread late in a stream with the start', () => {
    const found = detectInsights(history({ jumpsOnly: false, streamShare: 3, sliderShare: 0, spinnerShare: 0, streamFade: 2 }, 10), NOW);
    const i = find(found, 'stream-fade')!;
    expect(i).toBeDefined();
    const [, a, b] = i.text.match(/\((\d+) ms spread against (\d+) ms\)/)!.map(Number);
    expect(a!).toBeGreaterThan(b! * 1.35);
    expect(i.recommendation?.options.streamLength).toBe('long');
  });

  it('second-half needs a steady drop over at least 5 plays', () => {
    const found = detectInsights(history({ secondHalfDrop: 0.12 }, 6), NOW);
    const i = find(found, 'second-half')!;
    expect(i.text).toMatch(/^Your accuracy drops by about \d+ points in the second half of a play\.$/);
    expect(i.recommendation?.modeId).toBe('stamina');
    expect(find(detectInsights(history({ secondHalfDrop: 0.12 }, 4), NOW), 'second-half')).toBeUndefined();
  });

  it('sharp-wide names the weaker kind of jump', () => {
    const sharp = find(detectInsights(history({ sharpExtraMiss: 0.18 }), NOW), 'sharp-wide')!;
    expect(sharp.text).toMatch(/^You miss more on sharp back-and-forth jumps than on wide, flowing ones \(\d+% against \d+%\)\.$/);
    expect(sharp.recommendation?.options.angleFocus).toBe('sharp');
    const wide = find(detectInsights(history({ wideExtraMiss: 0.18 }), NOW), 'sharp-wide')!;
    expect(wide.text).toMatch(/^You miss more on wide, flowing jumps/);
    expect(wide.recommendation?.options.angleFocus).toBe('wide');
  });

  it('slider rules', () => {
    const slidersOnly = { jumpsOnly: false, sliderShare: 0.35, streamShare: 0, spinnerShare: 0 };
    const lag = find(detectInsights(history({ ...slidersOnly, sliderLag: -0.5 }), NOW), 'slider-lag')!;
    expect(lag.text).toMatch(/^You trail behind slider balls by about \d+% of a target's width\.$/);
    expect(lag.recommendation?.modeId).toBe('tracking');
    const curves = find(detectInsights(history({ ...slidersOnly, curvePenalty: 0.25 }), NOW), 'slider-curves')!;
    expect(curves.text).toMatch(/\(\d+% kept against \d+%\)/);
    expect(curves.recommendation?.options.sliderFocus).toBe('curves');
    const release = find(detectInsights(history({ ...slidersOnly, endDrop: 0.35 }), NOW), 'early-release')!;
    expect(release.text).toMatch(
      /^You often let go of sliders shortly before they end\. The end counted on \d+% of sliders, while \d+% of the ticks counted\.$/,
    );
    expect(release.recommendation?.options.sliderFocus).toBe('repeats');
  });

  it('timing-bias', () => {
    const i = find(detectInsights(history({ timingMean: 14 }), NOW), 'timing-bias')!;
    expect(i.text).toMatch(/^You click about \d+ ms late on average\.$/);
    expect(i.recommendation?.modeId).toBe('timing');
    expect(find(detectInsights(history({ timingMean: -14 }), NOW), 'timing-bias')!.text).toContain('early');
    expect(find(detectInsights(history({ timingMean: 5 }), NOW), 'timing-bias')).toBeUndefined();
  });

  it('busy-screen', () => {
    const i = find(detectInsights(history({ busyExtraMiss: 0.2, busyFrom: 3 }, 10), NOW), 'busy-screen')!;
    expect(i.text).toMatch(/^You miss more when \d+ or more targets are on screen \(\d+% against \d+% on quieter screens\)\.$/);
    expect(i.recommendation?.modeId).toBe('reading');
  });

  it('off-center needs a high hit rate and clicks far from the center', () => {
    const i = find(detectInsights(history({ offCenter: true, baseMiss: 0.01 }), NOW), 'off-center')!;
    expect(i.text).toMatch(
      /^You hit almost every target, but your clicks land far from the center\. On average a click is \d+% of a target's width off\./,
    );
    expect(i.recommendation?.modeId).toBe('precision');
    expect(find(detectInsights(history({ offCenter: true, baseMiss: 0.2 }), NOW), 'off-center')).toBeUndefined();
  });

  it('spinners', () => {
    const i = find(
      detectInsights(history({ jumpsOnly: false, spinnerShare: 0.25, streamShare: 0, sliderShare: 0, spinnerFail: 0.7 }), NOW),
      'spinners',
    )!;
    expect(i.text).toMatch(/^You finish only \d+% of spinners in time\.$/);
    expect(i.recommendation?.modeId).toBe('spinning');
  });

  it('same-module points at the next insight module', () => {
    const plays = [...history({ longAlong: -0.45 }, 4).map((p) => ({ ...p, summary: { ...p.summary, modeId: 'streams' as const } }))];
    const found = detectInsights(plays, NOW);
    const i = find(found, 'same-module')!;
    expect(i.text).toBe("You've played Streams four times in a row. Try another module next, then come back to it.");
    expect(i.recommendation?.modeId).toBe('jumps');
    const drilled = plays.map((p) => ({ ...p, summary: { ...p.summary, drillId: 'd1' } }));
    expect(find(detectInsights(drilled, NOW), 'same-module')).toBeUndefined();
  });

  it('long-session fires for a recent long session that ends with a drop', () => {
    const list = makeHistory(
      7,
      { objects: 120, jumpsOnly: true },
      {
        endAt: NOW - 2 * 60_000,
        spacingMs: 6 * 60_000,
        vary: (i) => ({ baseMiss: i < 4 ? 0.02 : 0.2 }),
      },
    ).map((fx) => ({ summary: summarizePlay(fx.result), records: fx.records }));
    const i = find(detectInsights(list, NOW), 'long-session')!;
    expect(i).toBeDefined();
    expect(i.text).toMatch(/^Your accuracy over your last three plays is \d+%, against \d+% for this session\./);
    expect(i.recommendation).toBeNull();
    expect(i.basis).toMatch(/in this session\.$/);
    expect(find(detectInsights(list, NOW + 3 * 3_600_000), 'long-session')).toBeUndefined();
  });

  it('ranks by severity and gives one insight per rule', () => {
    const found = detectInsights(history({ longAlong: -0.6, timingMean: 20 }), NOW);
    expect(found.length).toBeGreaterThanOrEqual(2);
    for (let k = 1; k < found.length; k++) expect(found[k - 1]!.severity).toBeGreaterThanOrEqual(found[k]!.severity);
    expect(new Set(found.map((i) => i.ruleId)).size).toBe(found.length);
  });

  it('ignores plays older than 30 days', () => {
    const old = makeHistory(7, { objects: 200, jumpsOnly: true, longAlong: -0.5 }, { endAt: NOW - 40 * DAY, spacingMs: DAY }).map((fx) => ({
      summary: summarizePlay(fx.result),
      records: fx.records,
    }));
    expect(detectInsights(old, NOW)).toEqual([]);
  });
});

describe('play notes', () => {
  it('finds the weakness in one play at half the usual counts', () => {
    const p = play({ seed: 3, objects: 260, jumpsOnly: true, longAlong: -0.6 });
    const notes = playNotes(p.records, p.summary);
    const note = notes.find((n) => n.ruleId === 'long-undershoot');
    expect(note).toBeDefined();
    expect(note!.basis).toMatch(/in this play\.$/);
  });

  it('is silent on a clean play', () => {
    const p = play({ seed: 3, objects: 200, jumpsOnly: true });
    expect(playNotes(p.records, p.summary)).toEqual([]);
  });
});

describe('drill launch', () => {
  it('builds a full launch from a recommendation', () => {
    const i = find(detectInsights(history({ longAlong: -0.45 }), NOW), 'long-undershoot')!;
    const launch = drillLaunch(i.recommendation!, { jumps: 4.5 }, 'drill-1', 1234);
    expect(launch).toMatchObject({
      modeId: 'jumps',
      presetLevel: null,
      mods: [],
      seed: 1234,
      lengthSec: 90,
      drillId: 'drill-1',
      levels: { jumps: 4.5 },
    });
    expect(launch.options.distanceFocus).toBe('long');
    expect(MODES.stamina.lengthOptions.includes(90)).toBe(false);
    const stamina = drillLaunch({ modeId: 'stamina', options: {}, label: 'Stamina' }, {}, null, 1);
    expect(stamina.lengthSec).toBe(180);
  });
});

describe('drill evaluation', () => {
  const before = () => history({ longAlong: -0.45, seed: 1 } as FixtureOptions);

  function setup() {
    const prior = before();
    const insight = find(detectInsights(prior, NOW), 'long-undershoot')!;
    const drill = createDrill(insight, 'drill-1', NOW)!;
    // Three drill sessions, two hours apart.
    const drillPlays = [0, 1, 2].map((k) =>
      play({ seed: 900 + k, modeId: 'jumps', objects: 60, jumpsOnly: true, drillId: 'drill-1', startedAt: NOW + (k + 1) * 2 * 3_600_000 }),
    );
    return { prior, drill, drillPlays };
  }

  const afterPlays = (o: FixtureOptions, count = 6) =>
    Array.from({ length: count }, (_, k) =>
      play({ seed: 500 + k, objects: 200, jumpsOnly: true, startedAt: NOW + DAY + k * 3_600_000, ...o }),
    );

  it('creates a drill only from an insight with a module and a baseline', () => {
    const { drill } = setup();
    expect(drill).toMatchObject({ ruleId: 'long-undershoot', modeId: 'jumps', status: 'active' });
    expect(drill.baseline.kind).toBe('mean');
    const tired = { ...find(detectInsights(before(), NOW), 'long-undershoot')!, recommendation: null };
    expect(createDrill(tired, 'x', NOW)).toBeNull();
  });

  it('collects until there are 3 drill sessions and enough later data', () => {
    const { drill, drillPlays } = setup();
    const none = evaluateDrill(drill, [], NOW);
    expect(none.outcome).toBe('collecting');
    expect(none.sessions).toBe(0);
    const two = evaluateDrill(drill, [...drillPlays.slice(0, 2), ...afterPlays({ longAlong: -0.05 })], NOW + 2 * DAY);
    expect(two.outcome).toBe('collecting');
    expect(two.sessions).toBe(2);
    expect(drillText({ ruleId: drill.ruleId, variant: drill.variant, createdAt: drill.createdAt, eval: two })).toBe(
      'Do 1 more drill session to start the comparison.',
    );
    const thin = evaluateDrill(drill, [...drillPlays, ...afterPlays({ longAlong: -0.05, objects: 40 }, 1)], NOW + 2 * DAY);
    expect(thin.outcome).toBe('collecting');
    expect(thin.morePlays).toBeGreaterThan(0);
    expect(drillText({ ruleId: drill.ruleId, variant: drill.variant, createdAt: drill.createdAt, eval: thin })).toMatch(
      /^Play \d+ more maps? outside the drill to measure it\.$/,
    );
  });

  it('measures only plays outside the drill', () => {
    const { drill, drillPlays } = setup();
    const ev = evaluateDrill(drill, [...drillPlays, ...afterPlays({ longAlong: -0.05 })], NOW + 2 * DAY);
    const outside = afterPlays({ longAlong: -0.05 }).reduce((n, p) => n + p.records.length, 0);
    expect(ev.nAfter).toBeLessThan(outside);
    expect(ev.nAfter).toBeGreaterThanOrEqual(40);
  });

  it('reports better when the bias shrinks', () => {
    const { drill, drillPlays } = setup();
    const ev = evaluateDrill(drill, [...drillPlays, ...afterPlays({ longAlong: -0.05 })], NOW + 2 * DAY);
    expect(ev.outcome).toBe('better');
    expect(Math.abs(ev.after!)).toBeLessThan(Math.abs(ev.before!));
    const text = drillText({ ruleId: drill.ruleId, variant: drill.variant, createdAt: drill.createdAt, eval: ev });
    expect(text).toMatch(
      /^Since you started this drill on \d{1,2} \w{3}, your aim on long, fast jumps went from \d+% short to (\d+% (short|past)|on the center)\. That's based on \d+ jumps before and \d+ after\.$/,
    );
  });

  it('reports no clear change when nothing moved', () => {
    const { drill, drillPlays } = setup();
    const ev = evaluateDrill(drill, [...drillPlays, ...afterPlays({ longAlong: -0.45 })], NOW + 2 * DAY);
    expect(ev.outcome).toBe('unclear');
    const text = drillText({ ruleId: drill.ruleId, variant: drill.variant, createdAt: drill.createdAt, eval: ev });
    expect(text).toMatch(/^No clear change in your aim on long, fast jumps yet\. \d+ jumps measured since \d{1,2} \w{3}\.$/);
  });

  it('reports worse when the bias grows', () => {
    const { drill, drillPlays } = setup();
    const ev = evaluateDrill(drill, [...drillPlays, ...afterPlays({ longAlong: -0.9 })], NOW + 2 * DAY);
    expect(ev.outcome).toBe('worse');
    const text = drillText({ ruleId: drill.ruleId, variant: drill.variant, createdAt: drill.createdAt, eval: ev });
    expect(text).toMatch(/^Your aim on long, fast jumps is worse than before this drill \(\d+% short then, \d+% short now\)\.$/);
  });

  it('locks after 30 days and when archived', () => {
    const { drill, drillPlays } = setup();
    const plays = [...drillPlays, ...afterPlays({ longAlong: -0.05 })];
    const early = refreshDrill(drill, plays, NOW + 2 * DAY);
    expect(early.changed).toBe(false);
    const late = refreshDrill(drill, plays, NOW + 31 * DAY);
    expect(late.changed).toBe(true);
    expect(late.drill.final?.outcome).toBe('better');
    // A locked drill ignores later data.
    expect(evaluateDrill(late.drill, [], NOW + 40 * DAY).outcome).toBe('better');
    const archived = archiveDrill(drill, plays, NOW + 3 * DAY);
    expect(archived.status).toBe('archived');
    expect(archived.final).not.toBeNull();
  });
});

describe('copy', () => {
  it('renders every rule with numbers', () => {
    expect(insightText('timing-bias', 'late', { ms: 12 })).toBe('You click about 12 ms late on average.');
    expect(insightText('spinners', null, { pct: 40 })).toBe('You finish only 40% of spinners in time.');
  });
});
