// Catches render errors and failed route loads so one broken page doesn't blank the app (PLAN-2 §8.2).

import { Component, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { IconDownload, IconHome, IconRefresh } from './icons';
import { Button, Notice, buttonClass } from './ui';

interface Props {
  children: ReactNode;
  /** The boundary clears itself when this changes, so moving to another page tries again. */
  resetKey?: string;
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    return this.state.error ? <Broken error={this.state.error} /> : this.props.children;
  }
}

function Broken({ error }: { error: Error }) {
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const exportData = async () => {
    setBusy(true);
    try {
      // Loaded now, so a broken chunk can't stop the export from being offered.
      const { downloadExport } = await import('../state/exportFile');
      const count = await downloadExport(false);
      setMessage({ tone: 'good', text: `Exported ${count} plays.` });
    } catch (e) {
      setMessage({ tone: 'bad', text: e instanceof Error ? e.message : 'The export failed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="alert" className="mx-auto my-12 max-w-xl px-4">
      <div className="fw-panel fw-marks p-6 sm:p-8">
        <span className="fw-kicker text-danger before:bg-danger">Error</span>
        <h1 className="mt-3 text-2xl">Something broke on this page.</h1>
        <p className="mt-2 text-ink-2">Reloading usually fixes it. Your plays stay on this device.</p>
        {error.message && <p className="mt-3 break-words font-mono text-sm text-ink-3">{error.message}</p>}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => window.location.reload()}>
            <IconRefresh size={16} />
            Reload
          </Button>
          {/* A plain link, so it works even when the router is what broke. */}
          <a href="/" className={buttonClass('secondary')}>
            <IconHome size={16} />
            Go home
          </a>
          <Button disabled={busy} onClick={() => void exportData()}>
            <IconDownload size={16} />
            Export your data
          </Button>
        </div>
        {message && (
          <div className="mt-4">
            <Notice tone={message.tone}>{message.text}</Notice>
          </div>
        )}
      </div>
    </div>
  );
}
