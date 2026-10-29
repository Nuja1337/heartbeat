// Sessions are plays separated by less than 30 minutes.

import type { PlaySummary } from '../data/schema';
import { mean } from './stats';

export const SESSION_GAP_MS = 30 * 60_000;
const DAY = 86_400_000;

export interface Session {
  start: number;
  end: number;
  /** Oldest first. */
  plays: PlaySummary[];
  /** Sum of play time, pauses excluded. */
  playedMs: number;
}

/** Newest session first, plays inside each oldest first. */
export function groupSessions(summaries: readonly PlaySummary[]): Session[] {
  const sorted = [...summaries].sort((a, b) => a.startedAt - b.startedAt);
  const sessions: Session[] = [];
  for (const p of sorted) {
    const last = sessions[sessions.length - 1];
    if (last && p.startedAt - last.end < SESSION_GAP_MS) {
      last.plays.push(p);
      last.end = Math.max(last.end, p.endedAt);
      last.playedMs += p.playedMs;
    } else {
      sessions.push({ start: p.startedAt, end: p.endedAt, plays: [p], playedMs: p.playedMs });
    }
  }
  return sessions.reverse();
}

export interface WeekStats {
  plays: number;
  minutes: number;
  accuracy: number | null;
}

function weekOf(summaries: readonly PlaySummary[], from: number, to: number): WeekStats {
  const inside = summaries.filter((s) => s.startedAt >= from && s.startedAt < to);
  return {
    plays: inside.length,
    minutes: inside.reduce((m, s) => m + s.playedMs, 0) / 60_000,
    accuracy: inside.length ? mean(inside.map((s) => s.accuracy)) : null,
  };
}

/** The last 7 days against the 7 before. */
export function weekCompare(summaries: readonly PlaySummary[], now: number): { thisWeek: WeekStats; lastWeek: WeekStats } {
  return {
    thisWeek: weekOf(summaries, now - 7 * DAY, now + 1),
    lastWeek: weekOf(summaries, now - 14 * DAY, now - 7 * DAY),
  };
}
