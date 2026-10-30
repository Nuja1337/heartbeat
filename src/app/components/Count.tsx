// A number that counts up to its value over 600 ms. With reduced motion it shows the final value at once.

import { useEffect, useState } from 'react';
import { motionReduced } from '../state/appearance';

const DURATION_MS = 600;

/** The value shown `elapsedMs` after the count started. Eases out, so the last digits settle slowly. */
export function countAt(value: number, elapsedMs: number, durationMs = DURATION_MS): number {
  if (!(durationMs > 0) || elapsedMs >= durationMs) return value;
  const t = Math.max(0, elapsedMs) / durationMs;
  return value * (1 - Math.pow(1 - t, 3));
}

export function Count({ value, format }: { value: number; format(v: number): string }) {
  // It starts at 0 when it will count, so the final number doesn't show for a frame first.
  const [shown, setShown] = useState(() => (typeof document === 'undefined' || motionReduced() ? value : 0));

  useEffect(() => {
    if (motionReduced()) {
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      setShown(countAt(value, elapsed));
      if (elapsed < DURATION_MS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{format(shown)}</>;
}
