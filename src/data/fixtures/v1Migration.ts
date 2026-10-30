// A frozen copy of the 1.0 database migration (DB_VERSION 1). Tests use it to build a 1.0 database,
// so a change to the live MIGRATIONS can never alter what a real 1.0 profile looks like. Never edit this file.

export const V1_DB_NAME = 'heartbeat';

export function migrateV1(db: IDBDatabase): void {
  db.createObjectStore('meta', { keyPath: 'key' });
  db.createObjectStore('settings', { keyPath: 'key' });
  const plays = db.createObjectStore('plays', { keyPath: 'id' });
  plays.createIndex('startedAt', 'startedAt');
  plays.createIndex('modeId', 'modeId');
  plays.createIndex('mode_startedAt', ['modeId', 'startedAt']);
  plays.createIndex('drillId', 'drillId');
  const details = db.createObjectStore('playDetails', { keyPath: 'playId' });
  details.createIndex('startedAt', 'startedAt');
  db.createObjectStore('progress', { keyPath: 'moduleId' });
  const drills = db.createObjectStore('drills', { keyPath: 'id' });
  drills.createIndex('createdAt', 'createdAt');
  drills.createIndex('status', 'status');
  db.createObjectStore('tombstones', { keyPath: 'id' });
}

/** Opens (and creates) the database at version 1 and returns the open connection. */
export function openV1(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(V1_DB_NAME, 1);
    open.onupgradeneeded = () => migrateV1(open.result);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
