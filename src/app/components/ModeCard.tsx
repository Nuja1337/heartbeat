// The cards on the Train page: one per mode, and the Placement card for a player with no module progress.

import { Link } from 'react-router';
import { DEFAULT_MODULE_LEVEL, MODES, PLACEMENT, SKILLS } from '../../shared/catalog';
import type { ModeId } from '../../shared/types';
import { PLACEMENT_TIME } from '../copy';
import { ago, andList, level as levelText } from '../format';
import { Motif } from './Motif';
import { Badge, Button, Panel } from './ui';

/** What a card shows in the level slot. A module has a level, the other modes say how they pick one. */
export interface ModeLevel {
  /** The number, or null when the mode has none. */
  value: number | null;
  /** The micro label above it. */
  caption: string;
  /** Shown instead of a number. */
  text?: string;
}

export function modeLevel(modeId: ModeId, row: { level: number } | undefined, isModule: boolean): ModeLevel {
  if (isModule) {
    return row
      ? { value: row.level, caption: 'Your level' }
      : { value: DEFAULT_MODULE_LEVEL, caption: 'Starting level' };
  }
  const mode = MODES[modeId];
  return { value: null, caption: 'Level', text: mode.adaptive ? 'Adaptive' : 'Fixed' };
}

export function lastPlayedText(at: number | null, now = Date.now()): string {
  return at === null ? 'Not played yet' : `Last played ${ago(at, now)}`;
}

export function ModeCard({
  modeId,
  level,
  lastPlayed,
}: {
  modeId: ModeId;
  level: ModeLevel;
  /** Epoch ms of the newest play in this mode, or null. */
  lastPlayed: number | null;
}) {
  const mode = MODES[modeId];
  return (
    <Link to={`/train/${modeId}`} className="fw-panel fw-marks fw-interactive flex h-full flex-col p-4 sm:p-6">
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-micro uppercase text-ink-3">{level.caption}</span>
          <span className={`block font-display leading-tight ${level.value !== null ? 'text-3xl' : 'text-xl'}`}>
            {level.value !== null ? levelText(level.value) : level.text}
          </span>
        </span>
        <Motif mode={modeId} />
      </span>
      <span className="mt-3 font-display text-lg font-semibold">{mode.label}</span>
      <span className="mt-1 flex-1 text-sm text-ink-2">{mode.description}</span>
      {mode.skills.length > 0 && (
        <span className="mt-3 flex flex-wrap gap-1.5">
          {mode.skills.map((s) => (
            <Badge key={s}>{SKILLS[s].label}</Badge>
          ))}
        </span>
      )}
      <span className="mt-3 text-sm text-ink-3">{lastPlayedText(lastPlayed)}</span>
    </Link>
  );
}

/** Shown when no module has a level yet. */
export function PlacementCard({ disabled, error, onStart }: { disabled: boolean; error: string | null; onStart(): void }) {
  const mode = MODES.placement;
  return (
    <Panel marks className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <span className="text-micro uppercase text-ink-3">Start here</span>
        <h2 className="font-display text-xl font-semibold">{mode.label}</h2>
        <p className="mt-1 max-w-2xl text-ink-2">
          {mode.description} It takes {PLACEMENT_TIME} and covers {andList(PLACEMENT.modules.map((m) => MODES[m].label.toLowerCase()))}.
        </p>
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
      <Button variant="primary" size="lg" className="shrink-0" disabled={disabled} onClick={onStart}>
        Start placement
      </Button>
    </Panel>
  );
}
