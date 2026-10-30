import { useState } from 'react';
import { buttonClass, Button } from '../components/ui';
import { MOVED_EXPORTED, MOVED_MESSAGE, MOVED_SHORT, NEW_URL, isOldAddress } from '../oldAddress';

// The key keeps its own short prefix. It only lives for the browser session.
const COLLAPSED_KEY = 'hb-moved-collapsed';

function readCollapsed(): boolean {
  try {
    return sessionStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(v: boolean): void {
  try {
    sessionStorage.setItem(COLLAPSED_KEY, v ? '1' : '0');
  } catch {
    // Without session storage the banner just opens again on the next page load.
  }
}

/** Shown at the top of every page on the old address. It can fold up for the session but never goes away. */
export function MovedBanner({ hostname = typeof location === 'undefined' ? '' : location.hostname }: { hostname?: string }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  if (!isOldAddress(hostname)) return null;

  const toggle = (v: boolean) => {
    setCollapsed(v);
    writeCollapsed(v);
  };

  const exportData = async () => {
    setBusy(true);
    try {
      // Loaded now, so the banner adds nothing to the first page load.
      const { saveExport } = await import('../state/exportFile');
      const n = await saveExport(true, true);
      setResult({ tone: 'good', text: MOVED_EXPORTED(n) });
    } catch (e) {
      setResult({ tone: 'bad', text: e instanceof Error ? e.message : 'The export failed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="region" aria-label="Heartbeat has a new address" className="border-b border-accent/40 bg-accent/10 text-sm text-ink">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
        {collapsed ? (
          <>
            <p className="min-w-0 flex-1">{MOVED_SHORT}</p>
            <Button size="sm" variant="ghost" aria-expanded={false} onClick={() => toggle(false)}>
              Show details
            </Button>
          </>
        ) : (
          <>
            <p className="min-w-0 flex-1 basis-80">{MOVED_MESSAGE}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void exportData()}>
                Export your data
              </Button>
              <a href={NEW_URL} className={buttonClass('secondary', 'sm')}>
                Open Heartbeat
              </a>
              <Button size="sm" variant="ghost" aria-expanded onClick={() => toggle(true)}>
                Hide details
              </Button>
            </div>
            {result && (
              <p role={result.tone === 'bad' ? 'alert' : 'status'} className={`basis-full ${result.tone === 'bad' ? 'text-danger' : 'text-accent'}`}>
                {result.text}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
