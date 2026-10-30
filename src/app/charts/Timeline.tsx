import { useState } from 'react';
import type { HitRecord } from '../../shared/types';
import { JUDGMENTS } from '../../shared/catalog';
import { PEER_FOCUS, PointNav } from './PointNav';
import { CHART, JCOLOR, linear, niceTicks } from './scale';

const W = 720;
const H = 240;
const M = { l: 48, r: 12, t: 12, b: 26 };

/**
 * Timing error of every tap through the play. Misses with no press are red ticks along the bottom.
 * With `onOpen`, a tap can be selected to open the replay at that object's time.
 */
export function Timeline({ records, onOpen }: { records: readonly HitRecord[]; onOpen?(time: number): void }) {
  const [active, setActive] = useState<number | null>(null);
  const taps = records.filter((r) => r.kind !== 'spinner');
  if (taps.length === 0) return <p className="text-ink-2">No taps in this play.</p>;
  const tMax = Math.max(...taps.map((r) => r.time));
  const cap = 200;
  const x = linear(0, tMax || 1, M.l, W - M.r);
  const y = linear(-cap, cap, H - M.b, M.t);
  const a = active === null ? null : taps[active];
  const describe = (r: HitRecord) =>
    `Object ${r.index + 1}, ${JUDGMENTS[r.judgment].label}${r.timingError === null ? ', no press' : `, ${Math.round(r.timingError)} milliseconds`}`;

  return (
    <figure className="m-0">
      <PointNav
        label={`Taps, ${taps.length} in all. Use the arrow keys to move between them${onOpen ? ' and Enter or Space to watch the replay at that tap' : ''}.`}
        items={taps.map((r) => ({ label: describe(r) }))}
        active={active}
        onActive={setActive}
        onOpen={onOpen ? (i) => onOpen(taps[i]!.time) : undefined}
      />
      <div className={PEER_FOCUS}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Timing error of each tap over the play">
          {niceTicks(-cap, cap, 5).map((v) => (
            <g key={v}>
              <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? CHART.axis : CHART.grid} />
              <text x={M.l - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill={CHART.ink2}>
                {v > 0 ? `+${v}` : v}
              </text>
            </g>
          ))}
          <text x={M.l} y={H - 8} fontSize={11} fill={CHART.ink2}>Start</text>
          <text x={W - M.r} y={H - 8} fontSize={11} fill={CHART.ink2} textAnchor="end">End</text>
          {taps.map((r, i) =>
            r.timingError === null ? (
              <line key={r.index} x1={x(r.time)} x2={x(r.time)} y1={H - M.b - 8} y2={H - M.b} stroke={JCOLOR.miss} strokeWidth={2} />
            ) : (
              <circle
                key={r.index}
                cx={x(r.time)}
                cy={y(Math.max(-cap, Math.min(cap, r.timingError)))}
                r={active === i ? 4.5 : 2.6}
                fill={JCOLOR[r.judgment]}
                fillOpacity={0.85}
              />
            ),
          )}
          {taps.map((r, i) => (
            <rect
              key={`h${r.index}`}
              x={x(r.time) - 3}
              width={6}
              y={M.t}
              height={H - M.t - M.b}
              fill="transparent"
              style={onOpen ? { cursor: 'pointer' } : undefined}
              onClick={onOpen ? () => onOpen(r.time) : undefined}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            />
          ))}
        </svg>
      </div>
      <figcaption className="min-h-6 text-sm text-ink-2">
        {a ? (
          <>
            Object {a.index + 1}, {JUDGMENTS[a.judgment].label}
            {a.timingError === null ? ', no press' : `, ${a.timingError > 0 ? '+' : ''}${Math.round(a.timingError)} ms`}
          </>
        ) : (
          `Above zero is late and below zero is early.${onOpen ? ' Select a tap to watch it in the replay.' : ''}`
        )}
      </figcaption>
    </figure>
  );
}
