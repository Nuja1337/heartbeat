// Export and import of everything Flickwise stores, as JSON or gzipped JSON.
// Import merges by id: plays and drills that already exist are skipped, tombstones are applied.

import { MODES } from '../shared/catalog';
import type { SkillId } from '../shared/types';
import { OBJECT_COLUMNS, SLIDER_COLUMNS, SPINNER_COLUMNS, tableFromJson, tableToJson } from './columns';
import { getAll, req, withTx } from './db';
import { getDeviceId, setLastExport } from './meta';
import type { Drill, MetaRow, PlayDetail, PlaySummary, ProgressRow, TierHistory, TierHistoryEntry, Tombstone } from './schema';
import { upgradeDetail, upgradeSummary } from './plays';
import { loadSettings, sanitizeSettings } from './settings';
import type { Settings } from '../shared/types';

export const EXPORT_FORMAT = 'flickwise-export';
export const EXPORT_VERSION = 1;

type JsonTable = { count: number; columns: Record<string, (number | null)[]> };
type JsonDetail = { v: number; objects: JsonTable; sliders: JsonTable; spinners: JsonTable };

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  formatVersion: number;
  exportedAt: number;
  app: { engineVersion: number; generatorVersion: number };
  deviceId: string;
  settings: Settings;
  progress: ProgressRow[];
  drills: Drill[];
  meta: { tiers: TierHistory };
  tombstones: Tombstone[];
  plays: { summary: PlaySummary; detail: JsonDetail | null }[];
}

export class ImportError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The fields the app reads from every summary. A play without them would break the dashboards. */
export function isValidSummary(s: unknown): s is PlaySummary {
  if (!isObject(s)) return false;
  return (
    typeof s.id === 'string' && s.id.length > 0 &&
    typeof s.modeId === 'string' && s.modeId in MODES &&
    isNum(s.startedAt) && isNum(s.endedAt) && isNum(s.playedMs) &&
    isNum(s.accuracy) && isNum(s.score) && isNum(s.maxCombo) && isNum(s.objectCount) &&
    (s.status === 'completed' || s.status === 'failed' || s.status === 'quit') &&
    isObject(s.launch) && isObject(s.launch.difficulty) &&
    isObject(s.counts) && isObject(s.timing) && isObject(s.aim) && isObject(s.kinds) &&
    isObject(s.buckets) && isObject(s.skills) && isObject(s.finalLevels) && isObject(s.input) && isObject(s.pb) &&
    Array.isArray(s.mods) && Array.isArray(s.levels) && Array.isArray(s.quarters) && Array.isArray(s.tiers) &&
    isObject(s.halves)
  );
}

export interface ImportReport {
  playsAdded: number;
  playsSkipped: number;
  /** Plays in the file that were malformed or from a newer version, and were left out. */
  playsInvalid: number;
  detailsAdded: number;
  drillsAdded: number;
  progressUpdated: number;
  tombstonesApplied: number;
  settingsApplied: boolean;
}

export async function buildExport(app?: { engineVersion: number; generatorVersion: number }, now = Date.now()): Promise<ExportFile> {
  const deviceId = await getDeviceId();
  const settings = await loadSettings();
  const data = await withTx(['plays', 'playDetails', 'progress', 'drills', 'tombstones', 'meta'], 'readonly', async (tx) => ({
    summaries: await getAll<PlaySummary>(tx, 'plays', undefined, 'startedAt'),
    details: await getAll<PlayDetail>(tx, 'playDetails'),
    progress: await getAll<ProgressRow>(tx, 'progress'),
    drills: await getAll<Drill>(tx, 'drills'),
    tombstones: await getAll<Tombstone>(tx, 'tombstones'),
    tiers: await req<MetaRow | undefined>(tx.objectStore('meta').get('tiers')),
  }));
  const detailById = new Map(data.details.map((d) => [d.playId, d]));
  const newest = data.summaries[data.summaries.length - 1];
  const file: ExportFile = {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_VERSION,
    exportedAt: now,
    app: app ?? { engineVersion: newest?.engineVersion ?? 0, generatorVersion: newest?.generatorVersion ?? 0 },
    deviceId,
    settings,
    progress: data.progress,
    drills: data.drills,
    meta: { tiers: (data.tiers?.value as TierHistory | undefined) ?? {} },
    tombstones: data.tombstones,
    plays: data.summaries.map((summary) => {
      const d = detailById.get(summary.id);
      return {
        summary,
        detail: d ? { v: d.v, objects: tableToJson(d.objects), sliders: tableToJson(d.sliders), spinners: tableToJson(d.spinners) } : null,
      };
    }),
  };
  await setLastExport(now);
  return file;
}

export async function exportBytes(file: ExportFile, gzip: boolean): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(file));
  if (!gzip) return bytes;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads a .json or .json.gz file. Gzip is detected by its first two bytes. */
export async function parseExportBytes(bytes: Uint8Array): Promise<unknown> {
  let text: string;
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(stream).text();
  } else {
    text = new TextDecoder().decode(bytes);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ImportError('This file is not valid JSON.');
  }
}

export function validateExport(raw: unknown): ExportFile {
  const f = raw as Partial<ExportFile> | null;
  if (!f || typeof f !== 'object' || f.format !== EXPORT_FORMAT) throw new ImportError('This is not a Flickwise export file.');
  if (typeof f.formatVersion !== 'number') throw new ImportError('The export file has no version.');
  if (f.formatVersion > EXPORT_VERSION) {
    throw new ImportError('This file was made by a newer version of Flickwise. Update the app and try again.');
  }
  if (!Array.isArray(f.plays)) throw new ImportError('The export file has no plays list.');
  return f as ExportFile;
}

function mergeTiers(a: TierHistory, b: TierHistory): TierHistory {
  const out: TierHistory = {};
  for (const skill of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<SkillId>) {
    const byTier = new Map<number, TierHistoryEntry>();
    for (const e of [...(a[skill] ?? []), ...(b[skill] ?? [])]) {
      const prev = byTier.get(e.tier);
      if (!prev || e.at < prev.at) byTier.set(e.tier, e);
    }
    out[skill] = [...byTier.values()].sort((x, y) => x.tier - y.tier);
  }
  return out;
}

export async function importExport(raw: unknown): Promise<ImportReport> {
  const file = validateExport(raw);
  const report: ImportReport = {
    playsAdded: 0, playsSkipped: 0, playsInvalid: 0, detailsAdded: 0, drillsAdded: 0, progressUpdated: 0, tombstonesApplied: 0, settingsApplied: false,
  };
  const summaries: { summary: PlaySummary; detail: PlayDetail | null }[] = [];
  for (const p of file.plays) {
    try {
      const summary = upgradeSummary(p?.summary);
      if (!isValidSummary(summary)) throw new Error('Missing fields.');
      let detail: PlayDetail | null = null;
      if (p.detail) {
        // Each detail is lifted from the version it was written with.
        detail = upgradeDetail({
          playId: summary.id,
          v: typeof p.detail.v === 'number' ? p.detail.v : 1,
          startedAt: summary.startedAt,
          objects: tableFromJson(p.detail.objects, OBJECT_COLUMNS),
          sliders: tableFromJson(p.detail.sliders, SLIDER_COLUMNS),
          spinners: tableFromJson(p.detail.spinners, SPINNER_COLUMNS),
        });
      }
      summaries.push({ summary, detail });
    } catch {
      report.playsInvalid++;
    }
  }
  await withTx(['plays', 'playDetails', 'progress', 'drills', 'tombstones', 'meta', 'settings'], 'readwrite', async (tx) => {
    const plays = tx.objectStore('plays');
    const details = tx.objectStore('playDetails');
    const tombstones = tx.objectStore('tombstones');

    const localTombs = new Set((await getAll<Tombstone>(tx, 'tombstones')).map((t) => t.id));
    for (const t of file.tombstones ?? []) {
      if (!t || typeof t.id !== 'string') continue;
      if (!localTombs.has(t.id)) {
        tombstones.put({ id: t.id, deletedAt: t.deletedAt });
        localTombs.add(t.id);
      }
      if (await req(plays.getKey(t.id))) {
        plays.delete(t.id);
        details.delete(t.id);
        report.tombstonesApplied++;
      }
    }

    for (const { summary, detail } of summaries) {
      if (localTombs.has(summary.id) || (await req(plays.getKey(summary.id)))) {
        report.playsSkipped++;
        continue;
      }
      if (detail) {
        details.put(detail);
        report.detailsAdded++;
      }
      plays.put({ ...summary, hasDetail: detail !== null });
      report.playsAdded++;
    }

    const progress = tx.objectStore('progress');
    for (const row of file.progress ?? []) {
      const prev = await req<ProgressRow | undefined>(progress.get(row.moduleId));
      if (!prev) {
        progress.put(row);
        report.progressUpdated++;
      } else if (row.updatedAt > prev.updatedAt) {
        progress.put({ ...row, bestLevel: Math.max(row.bestLevel, prev.bestLevel), sessions: Math.max(row.sessions, prev.sessions) });
        report.progressUpdated++;
      } else if (row.bestLevel > prev.bestLevel) {
        progress.put({ ...prev, bestLevel: row.bestLevel });
      }
    }

    const drills = tx.objectStore('drills');
    for (const d of file.drills ?? []) {
      if (!(await req(drills.getKey(d.id)))) {
        drills.put(d);
        report.drillsAdded++;
      }
    }

    const meta = tx.objectStore('meta');
    const tierRow = await req<MetaRow | undefined>(meta.get('tiers'));
    const merged = mergeTiers((tierRow?.value as TierHistory | undefined) ?? {}, file.meta?.tiers ?? {});
    meta.put({ key: 'tiers', value: merged } satisfies MetaRow);

    const settingsRow = await req(tx.objectStore('settings').get('settings'));
    if (!settingsRow && file.settings) {
      tx.objectStore('settings').put({ key: 'settings', value: sanitizeSettings(file.settings) });
      report.settingsApplied = true;
    }
  });
  return report;
}

export async function importBytes(bytes: Uint8Array): Promise<ImportReport> {
  return importExport(await parseExportBytes(bytes));
}

