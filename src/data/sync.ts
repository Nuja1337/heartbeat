// The seam for syncing later. Nothing implements it yet.
// Plays are immutable and every record has a UUID, a deviceId and a createdAt, so a server can
// accept appended plays plus tombstones.

import type { PlayDetail, PlaySummary, Tombstone } from './schema';

export interface SyncPull {
  summaries: PlaySummary[];
  details: PlayDetail[];
  tombstones: Tombstone[];
  cursor: string;
}

export interface SyncAdapter {
  push(summaries: PlaySummary[], details: PlayDetail[]): Promise<void>;
  pull(sinceCursor: string | null): Promise<SyncPull>;
}
