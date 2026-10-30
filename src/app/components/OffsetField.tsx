// A timing offset in milliseconds: a slider, a number box for exact values, and a link to the calibration screen.

import { useId } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';

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
  const helpId = `${id}-help`;
  const fill = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  const set = (v: number) => {
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, Math.round(v / step) * step)));
  };
  return (
    <div className="py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <label htmlFor={id}>{label}</label>
        <div className="flex items-center gap-2">
          <input
            id={`${id}-number`}
            type="number"
            inputMode="numeric"
            aria-label={`${label}, in milliseconds`}
            className="w-20 text-right"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => set(Number(e.target.value))}
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
          Calibrate
        </Link>
      </div>
    </div>
  );
}
