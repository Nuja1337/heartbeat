import { useState } from 'react';
import { t } from '../i18n';
import { contrast, divergingColor, sequentialColor, useChartColors } from './scale';

export interface HeatCell {
  /** The metric. null when no taps fall in the cell. */
  value: number | null;
  n: number;
  /** Value as shown, such as "12%". */
  text: string;
}

/**
 * A grid of rows and columns, one colored cell for each pair. Cells with fewer than `minN` taps are
 * grayed out and show their count only. A sequential scale runs from 0 to `max`. A diverging scale
 * runs from -max to max around a gray midpoint.
 */
export function HeatGrid({
  rows,
  cols,
  cell,
  scale,
  max,
  minN = 20,
  rowTitle,
  colTitle,
  describe,
}: {
  rows: { key: string; label: string }[];
  cols: { key: string; label: string }[];
  cell(row: string, col: string): HeatCell;
  scale: 'sequential' | 'diverging';
  max: number;
  minN?: number;
  rowTitle: string;
  colTitle: string;
  describe(row: string, col: string, c: HeatCell): string;
}) {
  const C = useChartColors();
  const [hover, setHover] = useState<string | null>(null);
  return (
    <figure className="m-0">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-sm">
          <caption className="sr-only">{t('{rowTitle} by {colTitle}', { rowTitle, colTitle })}</caption>
          <thead>
            <tr>
              <th className="text-left text-xs font-normal text-ink-2">{rowTitle}</th>
              {cols.map((c) => (
                <th key={c.key} scope="col" className="px-1 text-xs font-normal text-ink-2">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row" className="whitespace-nowrap pr-2 text-left text-xs font-normal text-ink-2">
                  {r.label}
                </th>
                {cols.map((c) => {
                  const h = cell(r.key, c.key);
                  const enough = h.value !== null && h.n >= minN;
                  const bg = !enough
                    ? C.bg
                    : scale === 'sequential'
                      ? sequentialColor(Math.min(1, Math.max(0, h.value! / max)), C)
                      : divergingColor(Math.max(-1, Math.min(1, h.value! / max)), C);
                  // Ink or the page background, whichever reads better on the cell.
                  const dark = enough && contrast(bg, C.bg) > contrast(bg, C.ink);
                  const id = `${r.key}/${c.key}`;
                  return (
                    <td
                      key={c.key}
                      tabIndex={0}
                      aria-label={describe(r.key, c.key, h)}
                      onMouseEnter={() => setHover(id)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(id)}
                      onBlur={() => setHover(null)}
                      className="h-10 min-w-14 rounded text-center"
                      style={{
                        background: bg,
                        color: dark ? C.bg : enough ? C.ink : C.neutral,
                        outline: hover === id ? `2px solid ${C.ink}` : undefined,
                      }}
                    >
                      {enough ? h.text : h.n > 0 ? t('n {n}', { n: h.n }) : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption className="min-h-6 text-sm text-ink-2" aria-live="polite">
        {hover
          ? (() => {
              const [r, c] = hover.split('/') as [string, string];
              return describe(r, c, cell(r, c));
            })()
          : t('Cells with fewer than {min} taps are grayed out.', { min: minN })}
      </figcaption>
    </figure>
  );
}
