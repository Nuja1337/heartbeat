// Copies the link to a map. The link carries the launch settings and the generator version, not the play.

import { useEffect, useRef, useState } from 'react';
import { MODS } from '../../shared/catalog';
import { encodeShare } from '../../shared/codes';
import type { LaunchRequest } from '../../shared/types';
import { playTitle } from '../format';
import { t } from '../i18n';
import { loadGame } from '../state/engine';
import { Button } from './ui';

/** "Heartbeat map: Dynamic, Level 4, Mirror. {url}" */
export function shareText(launch: Pick<LaunchRequest, 'modeId' | 'presetLevel' | 'mods'>, url: string): string {
  const parts = [playTitle(launch), ...launch.mods.map((m) => MODS[m].label)];
  return t('Heartbeat map: {parts}. {url}', { parts: parts.join(', '), url });
}

/** The placement test is the same fixed set of rounds for everyone, so there is no map to share. */
export const canShare = (modeId: string): boolean => modeId !== 'placement';

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ShareButton({
  launch,
  label,
  variant = 'secondary',
  size = 'md',
}: {
  launch: LaunchRequest;
  label?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = (text: string) => {
    setMessage(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 4000);
  };

  const share = async () => {
    try {
      const { GENERATOR_VERSION } = await loadGame();
      const url = `${window.location.origin}/s/${encodeShare(launch, GENERATOR_VERSION)}`;
      show((await copy(shareText(launch, url))) ? t('Link copied.') : t('Could not copy. The link is {url}', { url }));
    } catch {
      show(t('Could not make a link for this map.'));
    }
  };

  return (
    <span className="inline-flex items-center gap-3">
      <Button variant={variant} size={size} onClick={() => void share()}>
        {label ?? t('Share map')}
      </Button>
      <span role="status" aria-live="polite" className="min-w-0 break-all text-sm text-ink-2 empty:hidden">
        {message}
      </span>
    </span>
  );
}
