import { useEffect, useRef, useState } from 'react';
import { keyLabel } from './ui';

/** Why a key can't be a hit key, or null when it can. */
export function rejectHitKey(code: string, other: string): string | null {
  if (code === 'Tab') return "Tab moves between controls, so it can't be a hit key.";
  if (code === 'Escape') return "Esc is used to pause, so it can't be a hit key.";
  if (code === other) return "Both hit keys can't be the same.";
  return null;
}

/** Click, then press a key. The key's `event.code` is stored, so it works on any layout. */
export function KeyCapture({
  label,
  value,
  other,
  onChange,
}: {
  label: string;
  value: string;
  /** The code the other hit key uses. It can't be picked twice. */
  other: string;
  onChange(code: string): void;
}) {
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const why = rejectHitKey(e.code, other);
      if (why) {
        setMessage(why);
        setListening(false);
        return;
      }
      setMessage(null);
      setListening(false);
      onChange(e.code);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, other, onChange]);

  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <span>{label}</span>
        <button
          ref={button}
          type="button"
          onClick={() => {
            setMessage(null);
            setListening(true);
          }}
          onBlur={() => setListening(false)}
          className="min-w-24 rounded-md border border-line-2 bg-bg px-3 py-1.5 font-mono text-sm hover:border-ink-3"
          aria-label={`${label}, currently ${keyLabel(value)}. Press to change.`}
        >
          {listening ? 'Press a key' : keyLabel(value)}
        </button>
      </div>
      {message && (
        <p role="status" className="mt-1 text-sm text-rough">
          {message}
        </p>
      )}
    </div>
  );
}
