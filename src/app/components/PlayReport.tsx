import { JUDGMENTS, MODES } from '../../shared/catalog';
import type { Judgment } from '../../shared/types';
import type { PlaySummary } from '../../data/schema';
import type { HitRecord } from '../../shared/types';
import { median } from '../../analytics/stats';
import { AimScatter } from '../charts/AimScatter';
import { Bars } from '../charts/Bars';
import { Histogram, histCounts } from '../charts/Histogram';
import { alongText, duration, int, lateralText, level, offsetText, pct, widthPct } from '../format';
import { Card, SectionTitle, Stat } from './ui';

const ORDER: Judgment[] = ['crisp', 'solid', 'rough', 'miss'];

/** The numbers and small charts shared by the results screen and the play detail page. */
export function PlayReport({ summary: s, records }: { summary: PlaySummary; records: HitRecord[] | null }) {
  const isDynamic = s.modeId === 'dynamic';
  const levelEntries = Object.entries(s.finalLevels) as [string, number][];
  const total = Math.max(1, s.objectCount);
  const crispMs = records && records.length ? median(records.map((r) => r.crispMs)) : 40;
  const timing = records ? records.filter((r) => r.kind !== 'spinner' && r.timingError !== null).map((r) => r.timingError!) : [];

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          {isDynamic ? (
            <Stat label="Score" value={int(s.score)} />
          ) : levelEntries.length > 0 ? (
            levelEntries.map(([id, v]) => <Stat key={id} label={`${MODES[id as keyof typeof MODES].label} level`} value={level(v)} />)
          ) : null}
          <Stat label="Accuracy" value={pct(s.accuracy)} />
          <Stat label="Max combo" value={int(s.maxCombo)} />
          <Stat label="Time played" value={duration(s.playedMs)} />
          <Stat label="Objects" value={int(s.objectCount)} />
        </div>
        <div className="mt-5">
          <div className="flex h-2 overflow-hidden rounded-full bg-line" role="img" aria-label={ORDER.map((j) => `${JUDGMENTS[j].label} ${s.counts[j]}`).join(', ')}>
            {ORDER.map((j) => (
              <span key={j} style={{ width: `${(s.counts[j] / total) * 100}%`, background: JUDGMENTS[j].color }} />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {ORDER.map((j) => (
              <li key={j} className="flex items-center gap-2">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: JUDGMENTS[j].color }} />
                <span className="text-ink-2">{JUDGMENTS[j].label}</span>
                <span>{s.counts[j]}</span>
              </li>
            ))}
            {s.sliderParts.total > 0 && (
              <li className="text-ink-2">
                Slider parts {s.sliderParts.hit} of {s.sliderParts.total}
              </li>
            )}
            <li className="text-ink-2">Stray presses {s.strayPresses}</li>
          </ul>
        </div>
      </Card>

      {s.levels.length > 0 && (
        <Card>
          <SectionTitle>Level by set</SectionTitle>
          <Bars
            label="Level after each set"
            max={Math.max(...s.levels.map((l) => l.level), 1) * 1.1}
            items={s.levels.map((l) => ({
              label: `Set ${l.set + 1}, ${MODES[l.module].label}`,
              value: l.level,
              text: `${level(l.level)} · ${Math.round(l.success * 100)}%`,
            }))}
          />
          <p className="mt-2 text-sm text-ink-2">The number after the level is the share of the set that counted as a success.</p>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <SectionTitle>Timing</SectionTitle>
          {s.timing.n > 0 ? (
            <>
              <div className="mb-3 flex gap-8">
                <Stat label="Average" value={offsetText(s.timing.mean)} />
                <Stat label="Spread" value={`${Math.round(s.timing.sd)} ms`} sub="one standard deviation" />
              </div>
              {timing.length > 0 ? (
                <Histogram
                  label="Timing errors in 5 ms bins"
                  compact
                  height={150}
                  series={[{ label: 'All taps', color: '#7dd3fc', counts: histCounts(timing) }]}
                  mean={s.timing.mean}
                  sd={s.timing.sd}
                  windows={{ crisp: crispMs, solid: crispMs * 2, rough: crispMs * 3 }}
                />
              ) : (
                <p className="text-sm text-ink-2">The histogram needs the per-object detail, which has been removed for this play.</p>
              )}
            </>
          ) : (
            <p className="text-ink-2">No presses were recorded.</p>
          )}
        </Card>

        <Card>
          <SectionTitle>Aim</SectionTitle>
          {s.aim.n > 0 ? (
            <>
              <div className="mb-3 flex flex-wrap gap-x-8 gap-y-2">
                <Stat label="Along the move" value={alongText(s.aim.alongMean)} sub={`spread ${widthPct(s.aim.alongSd)}`} />
                <Stat label="Across the move" value={lateralText(s.aim.lateralMean)} sub={`spread ${widthPct(s.aim.lateralSd)}`} />
                <Stat label="From center" value={widthPct(s.aim.radialMean)} sub="of a target's width" />
              </div>
              {records ? <AimScatter records={records} size={260} /> : <p className="text-sm text-ink-2">The scatter needs the per-object detail, which has been removed for this play.</p>}
            </>
          ) : (
            <p className="text-ink-2">No aimed clicks were recorded.</p>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle>By kind of object</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-2">
                <th className="py-1 pr-4 font-normal">Kind</th>
                <th className="py-1 pr-4 font-normal">Count</th>
                <th className="py-1 pr-4 font-normal">Accuracy</th>
                <th className="py-1 font-normal">Details</th>
              </tr>
            </thead>
            <tbody>
              {s.kinds.circle && (
                <tr className="border-t border-line">
                  <td className="py-1.5 pr-4">Circles</td>
                  <td className="pr-4">{s.kinds.circle.n}</td>
                  <td className="pr-4">{pct(s.kinds.circle.accuracy)}</td>
                  <td className="text-ink-2">
                    {s.kinds.circle.misses} missed, timing {offsetText(s.kinds.circle.timingMean)} with a spread of {Math.round(s.kinds.circle.timingSd)} ms
                  </td>
                </tr>
              )}
              {s.kinds.slider && (
                <tr className="border-t border-line">
                  <td className="py-1.5 pr-4">Sliders</td>
                  <td className="pr-4">{s.kinds.slider.n}</td>
                  <td className="pr-4">{pct(s.kinds.slider.accuracy)}</td>
                  <td className="text-ink-2">
                    {pct(s.kinds.slider.trackedMean, 0)} tracked, {alongText(s.kinds.slider.lagMean).replace('short', 'behind').replace('past', 'ahead')}, end held on {pct(s.kinds.slider.endHitRate, 0)}
                  </td>
                </tr>
              )}
              {s.kinds.spinner && (
                <tr className="border-t border-line">
                  <td className="py-1.5 pr-4">Spinners</td>
                  <td className="pr-4">{s.kinds.spinner.n}</td>
                  <td className="pr-4">{pct(s.kinds.spinner.accuracy)}</td>
                  <td className="text-ink-2">
                    {Math.round(s.kinds.spinner.meanRpm)} rpm on average, {Math.round(s.kinds.spinner.peakRpm)} at the peak
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
