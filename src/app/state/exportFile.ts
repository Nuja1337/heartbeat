// Builds an export file and hands it to the browser as a download.

import { buildExport, exportBytes } from '../../data/exportImport';
import { loadGame } from './engine';

export interface DownloadOptions {
  /** Put the stored replays in the file. On by default. */
  includeReplays?: boolean;
  /** The engine and generator versions to write into the file. */
  app?: { engineVersion: number; generatorVersion: number };
}

/** Saves every play and setting as a file. Resolves with the number of plays in it. */
export async function downloadExport(gzip: boolean, options: DownloadOptions = {}): Promise<number> {
  const file = await buildExport(options.app, { includeReplays: options.includeReplays ?? true });
  const bytes = await exportBytes(file, gzip);
  const blob = new Blob([bytes as BlobPart], { type: gzip ? 'application/gzip' : 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `heartbeat-${new Date().toISOString().slice(0, 10)}.json${gzip ? '.gz' : ''}`;
  a.click();
  URL.revokeObjectURL(url);
  return file.plays.length;
}

/** The export the Settings page and the old-address notice offer: stamped with the engine and generator versions. */
export async function saveExport(gzip: boolean, includeReplays: boolean): Promise<number> {
  const g = await loadGame();
  return downloadExport(gzip, { includeReplays, app: { engineVersion: g.ENGINE_VERSION, generatorVersion: g.GENERATOR_VERSION } });
}
