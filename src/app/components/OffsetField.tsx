// A timing offset in milliseconds: a slider, a number box for exact values, and a link to the calibration screen.

import { useId, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { t } from '../i18n';

/**
 * The value typed into the number box, or null while it isn't a number yet ("", "-", "1e", words). A number
 * is rounded to the step and clamped to the range. A true minus sign or the typographic one both count.
 */
export function parseOffsetText(text: string, min: number, max: number, step = 1): number | null {
  const s = text.trim().replace('\u2212', '-');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, Math.round(v / step) * step)) || 0;
}

export function OffsetField({
  label,
  help,
  value,
  min,
  max,
  step = 1,
  calibrate,
  onChange,
}: {
  label: string;
  help?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Which calibration to open. */
  calibrate: 'visual' | 'audio';
  onChange(v: number): void;
}) {
  const id = useId();
  // What is typed in the number box while it has focus. null shows the saved value.
  const [draft, setDraft] = useState<string | null>(null);
  const helpId = `${id}-help`;
  const fill = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  const set = (v: number) => {
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, Math.round(v / step) * step)));
  };
  const commit = () => {
    const v = draft === null ? null : parseOffsetText(draft, min, max, step);
    if (v !== null) onChange(v);
    setDraft(null);
  };
  return (
    <div className="py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <label htmlFor={id}>{label}</label>
        <div className="flex items-center gap-2">
          <input
            id={`${id}-number`}
            type="text"
            autoComplete="off"
            spellCheck={false}
            aria-label={t('{label}, in milliseconds', { label })}
            className="w-20 text-right"
            value={draft ?? String(value)}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape' && draft !== null) {
                e.stopPropagation();
                setDraft(null);
              }
            }}
          />
          <span className="text-sm text-ink-2">ms</span>
        </div>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        aria-describedby={help ? helpId : undefined}
        onChange={(e) => set(Number(e.target.value))}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        {help && (
          <p id={helpId} className="min-w-0 flex-1 text-sm text-ink-2">
            {help}
          </p>
        )}
        <Link to={`/calibrate?kind=${calibrate}`} className="shrink-0 text-sm text-accent underline-offset-4 hover:underline">
          {t('Calibrate')}
        </Link>
      </div>
    </div>
  );
}
