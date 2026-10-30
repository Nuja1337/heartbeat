// Small looping drawings on the mode cards. They are the only motion that loops in the menus.
// Reduce motion, from the setting or the OS, stops them through the rules in index.css.

import type { CSSProperties, ReactNode } from 'react';
import type { ModeId } from '../../shared/types';

type Kind = 'pulse' | 'hop' | 'row' | 'arc' | 'spin' | 'trio';

const KIND: Partial<Record<ModeId, Kind>> = {
  warmup: 'pulse',
  precision: 'pulse',
  reading: 'pulse',
  timing: 'pulse',
  jumps: 'hop',
  angles: 'hop',
  streams: 'row',
  stamina: 'row',
  tracking: 'arc',
  spinning: 'spin',
  mix: 'trio',
};

const delay = (s: number): CSSProperties => ({ animationDelay: `${s}s` });

function Drawing({ kind }: { kind: Kind }): ReactNode {
  switch (kind) {
    case 'pulse':
      return (
        <>
          <circle cx="36" cy="16" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
          <circle cx="36" cy="16" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" className="fw-pulse" />
          <circle cx="36" cy="16" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" className="fw-pulse" style={delay(1.2)} />
          <circle cx="36" cy="16" r="2.5" fill="currentColor" />
        </>
      );
    case 'hop':
      return (
        <>
          <line x1="12" y1="16" x2="60" y2="16" stroke="currentColor" strokeWidth="1" strokeDasharray="2 3" opacity="0.5" />
          <circle cx="12" cy="16" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="60" cy="16" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <g className="fw-travel" style={{ '--travel': '48px' } as CSSProperties}>
            <circle cx="12" cy="16" r="2.5" fill="currentColor" />
          </g>
        </>
      );
    case 'row':
      return (
        <>
          {[0, 1, 2, 3, 4].map((i) => (
            <circle key={i} cx={10 + i * 13} cy="16" r="3.5" fill="currentColor" className="fw-pulse" style={delay(i * 0.25)} />
          ))}
        </>
      );
    case 'arc':
      return (
        <>
          <path d="M8 24C22 2 50 2 64 24" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 3" opacity="0.5" />
          {/* The x and y moves have different easing, so the dot follows a curve. */}
          <g className="fw-travel" style={{ '--travel': '56px', animationTimingFunction: 'linear' } as CSSProperties}>
            <g className="fw-hump">
              <circle cx="8" cy="24" r="3" fill="currentColor" />
            </g>
          </g>
        </>
      );
    case 'spin':
      return (
        <>
          <circle cx="36" cy="16" r="11" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
          <g className="fw-spin">
            <line x1="36" y1="16" x2="36" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="36" cy="5" r="2.5" fill="currentColor" />
          </g>
        </>
      );
    case 'trio':
      return (
        <>
          <circle cx="18" cy="22" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="54" cy="22" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="36" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="18" cy="22" r="2" fill="currentColor" className="fw-pulse" />
          <circle cx="36" cy="8" r="2" fill="currentColor" className="fw-pulse" style={delay(0.8)} />
          <circle cx="54" cy="22" r="2" fill="currentColor" className="fw-pulse" style={delay(1.6)} />
        </>
      );
  }
}

/** The drawing for a mode. Decorative, so it is hidden from screen readers. */
export function Motif({ mode }: { mode: ModeId }) {
  const kind = KIND[mode];
  if (!kind) return null;
  return (
    <svg viewBox="0 0 72 32" width="72" height="32" aria-hidden="true" focusable="false" className="fw-motif overflow-visible">
      <Drawing kind={kind} />
    </svg>
  );
}
