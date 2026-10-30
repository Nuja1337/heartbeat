import { useId } from 'react';

export interface PointNavItem {
  /** What a screen reader says for the point. */
  label: string;
}

/** The index to move to for a key, or null when the key does nothing. `current` is null before the first move. */
export function nextPoint(key: string, current: number | null, count: number): number | null {
  if (count === 0) return null;
  const last = count - 1;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return current === null ? 0 : Math.min(last, current + 1);
    case 'ArrowLeft':
    case 'ArrowUp':
      return current === null ? 0 : Math.max(0, current - 1);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

/**
 * The keyboard and screen reader side of a chart whose points can be selected. The chart's own picture is an image
 * to assistive technology, so its points can't be reached from inside it. This is one tab stop for the whole chart:
 * a list the arrow keys move through, with Enter or Space opening the point. It is visually hidden. Put it before the
 * chart's wrapper and give the wrapper the PEER_FOCUS classes so the focus shows on the chart.
 */
export function PointNav({
  label,
  items,
  active,
  onActive,
  onOpen,
}: {
  label: string;
  items: readonly PointNavItem[];
  active: number | null;
  onActive(i: number | null): void;
  /** Called with the point's index on Enter or Space. */
  onOpen?(i: number): void;
}) {
  const id = useId();
  const optionId = (i: number) => `${id}-${i}`;
  return (
    <div
      role="listbox"
      tabIndex={0}
      aria-label={label}
      aria-activedescendant={active === null ? undefined : optionId(active)}
      className="peer sr-only"
      onFocus={() => onActive(active ?? (items.length > 0 ? 0 : null))}
      onBlur={() => onActive(null)}
      onKeyDown={(e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if ((e.key === 'Enter' || e.key === ' ') && onOpen && active !== null) {
          e.preventDefault();
          onOpen(active);
          return;
        }
        const next = nextPoint(e.key, active, items.length);
        if (next !== null) {
          e.preventDefault();
          onActive(next);
        }
      }}
    >
      {items.map((item, i) => (
        <div key={i} id={optionId(i)} role="option" aria-selected={active === i}>
          {item.label}
        </div>
      ))}
    </div>
  );
}

/** The classes for the chart wrapper that follows a PointNav. */
export const PEER_FOCUS = 'rounded-sm peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent';
