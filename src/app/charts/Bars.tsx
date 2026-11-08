import { useChartColors } from './scale';

export interface BarItem {
  label: string;
  value: number;
  color?: string;
  /** Text shown at the end of the bar. */
  text?: string;
}

/** Horizontal bars with the label on the left and the value on the right. */
export function Bars({ items, max, label }: { items: BarItem[]; max?: number; label: string }) {
  const C = useChartColors();
  const top = max ?? Math.max(0.0001, ...items.map((i) => i.value));
  return (
    <ul className="space-y-1.5" aria-label={label}>
      {items.map((it) => (
        <li key={it.label} className="grid grid-cols-[7.5rem_1fr_4rem] items-center gap-3 text-sm">
          <span className="truncate text-ink-2">{it.label}</span>
          <span className="h-2 rounded-full bg-line">
            <span
              className="block h-2 rounded-full"
              style={{ width: `${Math.max(0, Math.min(1, it.value / top)) * 100}%`, background: it.color ?? C.accent }}
            />
          </span>
          <span className="text-right">{it.text ?? it.value.toFixed(2)}</span>
        </li>
      ))}
    </ul>
  );
}
