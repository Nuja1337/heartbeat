// Export and import of everything Heartbeat stores, as JSON or gzipped JSON.
// Import merges by id: plays and drills that already exist are skipped, tombstones are applied.

import { MODES } from '../shared/catalog';
import { t } from '../shared/i18n';
import type { SkillId } from '../shared/types';
import { OBJECT_COLUMNS, SLIDER_COLUMNS, SPINNER_COLUMNS, tableFromJson, tableToJson } from './columns';
import { getAll, req, withTx } from './db';
import { base64ToBytes, bytesToBase64, gunzipBytes, gzipBytes, hasGzipHeader } from './gzip';
import { cleanMilestones, cleanOnboarding, getDeviceId, mergeMilestones, setLastExport } from './meta';
import type {
  Drill,
  MetaRow,
  Milestones,
  Onboarding,
  PlayDetail,
  PlaySummary,
  ProgressRow,
  ReplayBytesRow,
  ReplayRow,
  TierHistory,
  TierHistoryEntry,
  Tombstone,
} from './schema';
import { upgradeDetail, upgradeSummary } from './plays';
import { loadSettings, sanitizeSettings } from './settings';
import type { Settings } from '../shared/types';

export const EXPORT_FORMAT = 'heartbeat-export';
// Export files made before the app was renamed use this format value. Import still accepts it.
export const LEGACY_EXPORT_FORMAT = 'flickwise-export';
export const EXPORT_VERSION = 2;
/** A replay larger than this after decoding is skipped on import. */
export const MAX_IMPORT_REPLAY_BYTES = 16 * 1024 * 1024;

type JsonTable = { count: number; columns: Record<string, (number | null)[]> };
type JsonDetail = { v: number; objects: JsonTable; sliders: JsonTable; spinners: JsonTable };

/** A stored replay row in an export file. */
export interface JsonReplay {
  v: 1;
  keep: boolean;
  events: number;
  rawBytes: number;
  engineVersion: number;
  /** Standard base64 with padding, of the gzip bytes. */
  data: string;
}

export interface ExportFile {
  format: typeof EXPORT_FORMAT | typeof LEGACY_EXPORT_FORMAT;
  formatVersion: number;
  exportedAt: number;
  app: { engineVersion: number; generatorVersion: number };
  deviceId: string;
  settings: Settings;
  progress: ProgressRow[];
  drills: Drill[];
  meta: { tiers: TierHistory; milestones?: Milestones; onboarding?: Onboarding };
  tombstones: Tombstone[];
  plays: { summary: PlaySummary; detail: JsonDetail | null; replay?: JsonReplay | null }[];
}

export class ImportError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The fields the app reads from every summary. A play without them would break the dashboards. */
export function isValidSummary(s: unknown): s is PlaySummary {
  if (!isObject(s)) return false;
  return (
    typeof s.id === 'string' &&
    s.id.length > 0 &&
    typeof s.modeId === 'string' &&
    s.modeId in MODES &&
    isNum(s.startedAt) &&
    isNum(s.endedAt) &&
    isNum(s.playedMs) &&
    isNum(s.accuracy) &&
    isNum(s.score) &&
    isNum(s.maxCombo) &&
    isNum(s.objectCount) &&
    (s.status === 'completed' || s.status === 'failed' || s.status === 'quit') &&
    isObject(s.launch) &&
    isObject(s.launch.difficulty) &&
    isObject(s.counts) &&
    isObject(s.timing) &&
    isObject(s.aim) &&
    isObject(s.kinds) &&
    isObject(s.buckets) &&
    isObject(s.skills) &&
    isObject(s.finalLevels) &&
    isObject(s.input) &&
    isObject(s.pb) &&
    Array.isArray(s.mods) &&
    Array.isArray(s.levels) &&
    Array.isArray(s.quarters) &&
    Array.isArray(s.tiers) &&
    isObject(s.halves)
  );
}

export interface ImportReport {
  playsAdded: number;
  playsSkipped: number;
  /** Plays in the file that were malformed or from a newer version, and were left out. */
  playsInvalid: number;
  detailsAdded: number;
  replaysAdded: number;
  /** Replays in the file that were malformed or too large, and were left out. Their plays were still imported. */
  replaysInvalid: number;
  drillsAdded: number;
  progressUpdated: number;
  tombstonesApplied: number;
  settingsApplied: boolean;
}

export interface ExportOptions {
  /** Include every stored replay. Default true. */
  includeReplays?: boolean;
}

export async function buildExport(
  app?: { engineVersion: number; generatorVersion: number },
  options: ExportOptions = {},
  now = Date.now(),
): Promise<ExportFile> {
  const includeReplays = options.includeReplays ?? true;
  const deviceId = await getDeviceId();
  const settings = await loadSettings();
  const data = await withTx(
    ['plays', 'playDetails', 'progress', 'drills', 'tombstones', 'meta', 'replays', 'replayBytes'],
    'readonly',
    async (tx) => ({
      summaries: await getAll<PlaySummary>(tx, 'plays', undefined, 'startedAt'),
      details: await getAll<PlayDetail>(tx, 'playDetails'),
      progress: await getAll<ProgressRow>(tx, 'progress'),
      drills: await getAll<Drill>(tx, 'drills'),
      tombstones: await getAll<Tombstone>(tx, 'tombstones'),
      tiers: await req<MetaRow | undefined>(tx.objectStore('meta').get('tiers')),
      milestones: await req<MetaRow | undefined>(tx.objectStore('meta').get('milestones')),
      onboarding: await req<MetaRow | undefined>(tx.objectStore('meta').get('onboarding')),
      replayRows: includeReplays ? await getAll<ReplayRow>(tx, 'replays') : [],
      replayBytes: includeReplays ? await getAll<ReplayBytesRow>(tx, 'replayBytes') : [],
    }),
  );
  const detailById = new Map(data.details.map((d) => [d.playId, d]));
  const rowById = new Map(data.replayRows.map((r) => [r.playId, r]));
  const bytesById = new Map(data.replayBytes.map((r) => [r.playId, r.bytes]));
  const replayOf = (id: string): JsonReplay | null => {
    const row = rowById.get(id);
    const bytes = bytesById.get(id);
    if (!row || !bytes) return null;
    return {
      v: 1,
      keep: row.keep === 1,
      events: row.events,
      rawBytes: row.rawBytes,
      engineVersion: row.engineVersion,
      data: bytesToBase64(bytes),
    };
  };
  const milestones = cleanMilestones(data.milestones?.value);
  const onboarding = cleanOnboarding(data.onboarding?.value);
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
    meta: {
      tiers: (data.tiers?.value as TierHistory | undefined) ?? {},
      ...(Object.keys(milestones).length > 0 ? { milestones } : {}),
      ...(onboarding ? { onboarding } : {}),
    },
    tombstones: data.tombstones,
    plays: data.summaries.map((summary) => {
      const d = detailById.get(summary.id);
      return {
        summary,
        detail: d ? { v: d.v, objects: tableToJson(d.objects), sliders: tableToJson(d.sliders), spinners: tableToJson(d.spinners) } : null,
        ...(includeReplays ? { replay: replayOf(summary.id) } : {}),
      };
    }),
  };
  await setLastExport(now);
  return file;
}

export async function exportBytes(file: ExportFile, gzip: boolean): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(file));
  return gzip ? gzipBytes(bytes) : bytes;
}

/** Reads a .json or .json.gz file. Gzip is detected by its first two bytes. */
export async function parseExportBytes(bytes: Uint8Array): Promise<unknown> {
  let text: string;
  if (hasGzipHeader(bytes)) {
    text = new TextDecoder().decode(await gunzipBytes(bytes));
  } else {
    text = new TextDecoder().decode(bytes);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ImportError(t('This file is not valid JSON.'));
  }
}

export function validateExport(raw: unknown): ExportFile {
  const f = raw as Partial<ExportFile> | null;
  if (!f || typeof f !== 'object' || (f.format !== EXPORT_FORMAT && f.format !== LEGACY_EXPORT_FORMAT))
    throw new ImportError(t('This is not a Heartbeat export file.'));
  if (typeof f.formatVersion !== 'number') throw new ImportError(t('The export file has no version.'));
  if (f.formatVersion > EXPORT_VERSION) {
    throw new ImportError(t('This file was made by a newer version of Heartbeat. Update the app and try again.'));
  }
  if (!Array.isArray(f.plays)) throw new ImportError(t('The export file has no plays list.'));
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

/** A replay read from a file: the bytes are checked and ready to store. */
interface ImportedReplay {
  keep: boolean;
  events: number;
  rawBytes: number;
  engineVersion: number;
  bytes: Uint8Array;
}

/** null when the replay can't be used. The play it belongs to is still imported. */
function readJsonReplay(raw: unknown): ImportedReplay | null {
  if (!isObject(raw) || raw.v !== 1 || typeof raw.data !== 'string') return null;
  if (!isNum(raw.events) || !isNum(raw.rawBytes) || !isNum(raw.engineVersion)) return null;
  // Base64 is 4 characters for 3 bytes. Check the size before decoding anything.
  if ((raw.data.length / 4) * 3 > MAX_IMPORT_REPLAY_BYTES + 3) return null;
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(raw.data);
  } catch {
    return null;
  }
  if (bytes.length > MAX_IMPORT_REPLAY_BYTES || !hasGzipHeader(bytes)) return null;
  return { keep: raw.keep === true, events: raw.events, rawBytes: raw.rawBytes, engineVersion: raw.engineVersion, bytes };
}

export async function importExport(raw: unknown): Promise<ImportReport> {
  const file = validateExport(raw);
  const report: ImportReport = {
    playsAdded: 0,
    playsSkipped: 0,
    playsInvalid: 0,
    detailsAdded: 0,
    replaysAdded: 0,
    replaysInvalid: 0,
    drillsAdded: 0,
    progressUpdated: 0,
    tombstonesApplied: 0,
    settingsApplied: false,
  };
  const summaries: { summary: PlaySummary; detail: PlayDetail | null; replay: ImportedReplay | null }[] = [];
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
      let replay: ImportedReplay | null = null;
      if (p.replay !== undefined && p.replay !== null) {
        replay = readJsonReplay(p.replay);
        if (!replay) report.replaysInvalid++;
      }
      summaries.push({ summary, detail, replay });
    } catch {
      report.playsInvalid++;
    }
  }
  await withTx(
    ['plays', 'playDetails', 'progress', 'drills', 'tombstones', 'meta', 'settings', 'replays', 'replayBytes'],
    'readwrite',
    async (tx) => {
      const plays = tx.objectStore('plays');
      const details = tx.objectStore('playDetails');
      const tombstones = tx.objectStore('tombstones');
      const replays = tx.objectStore('replays');
      const replayBytes = tx.objectStore('replayBytes');

      const localTombs = new Set((await getAll<Tombstone>(tx, 'tombstones')).map((tomb) => tomb.id));
      for (const tomb of file.tombstones ?? []) {
        if (!tomb || typeof tomb.id !== 'string') continue;
        if (!localTombs.has(tomb.id)) {
          tombstones.put({ id: tomb.id, deletedAt: tomb.deletedAt });
          localTombs.add(tomb.id);
        }
        if (await req(plays.getKey(tomb.id))) {
          plays.delete(tomb.id);
          details.delete(tomb.id);
          replays.delete(tomb.id);
          replayBytes.delete(tomb.id);
          report.tombstonesApplied++;
        }
      }

      for (const { summary, detail, replay } of summaries) {
        if (localTombs.has(summary.id) || (await req(plays.getKey(summary.id)))) {
          report.playsSkipped++;
          continue;
        }
        if (detail) {
          details.put(detail);
          report.detailsAdded++;
        }
        // Existing replay rows win. hasReplay says whether a row is there, whatever the file's summary says.
        let hasReplay = (await req(replays.getKey(summary.id))) !== undefined;
        if (replay && !hasReplay) {
          replays.put({
            playId: summary.id,
            v: 1,
            startedAt: summary.startedAt,
            keep: replay.keep ? 1 : 0,
            size: replay.bytes.byteLength,
            rawBytes: replay.rawBytes,
            events: replay.events,
            engineVersion: replay.engineVersion,
          } satisfies ReplayRow);
          replayBytes.put({ playId: summary.id, bytes: replay.bytes } satisfies ReplayBytesRow);
          hasReplay = true;
          report.replaysAdded++;
        }
        plays.put({ ...summary, hasDetail: detail !== null, hasReplay });
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

      const fileMilestones = cleanMilestones(file.meta?.milestones);
      if (Object.keys(fileMilestones).length > 0) {
        const localRow = await req<MetaRow | undefined>(meta.get('milestones'));
        meta.put({ key: 'milestones', value: mergeMilestones(cleanMilestones(localRow?.value), fileMilestones) } satisfies MetaRow);
      }
      const fileOnboarding = cleanOnboarding(file.meta?.onboarding);
      if (fileOnboarding && !(await req<MetaRow | undefined>(meta.get('onboarding')))) {
        meta.put({ key: 'onboarding', value: fileOnboarding } satisfies MetaRow);
      }

      const settingsRow = await req(tx.objectStore('settings').get('settings'));
      if (!settingsRow && file.settings) {
        tx.objectStore('settings').put({ key: 'settings', value: sanitizeSettings(file.settings) });
        report.settingsApplied = true;
      }
    },
  );
  return report;
}

export async function importBytes(bytes: Uint8Array): Promise<ImportReport> {
  return importExport(await parseExportBytes(bytes));
}
