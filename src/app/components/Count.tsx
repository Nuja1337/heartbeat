// A number that counts up to its value over 600 ms. With reduced motion it shows the final value at once.

import { useEffect, useState } from 'react';
import { motionReduced } from '../state/appearance';

const DURATION_MS = 600;

export function Count({ value, format }: { value: number; format(v: number): string }) {
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (motionReduced()) {
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      // Ease out, so the last digits settle slowly.
      setShown(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{format(shown)}</>;
}
