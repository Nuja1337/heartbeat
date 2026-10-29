// IndexedDB access: open, migrate, and small promise helpers.

export const DB_NAME = 'flickwise';
export const DB_VERSION = 1;

export type StoreName = 'meta' | 'settings' | 'plays' | 'playDetails' | 'progress' | 'drills' | 'tombstones';
export const STORE_NAMES: StoreName[] = ['meta', 'settings', 'plays', 'playDetails', 'progress', 'drills', 'tombstones'];

type Migration = (db: IDBDatabase, tx: IDBTransaction) => void;

/** One step per version. onupgradeneeded runs the steps from oldVersion + 1 to DB_VERSION. */
export const MIGRATIONS: Record<number, Migration> = {
  1: (db) => {
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
  },
};

let dbPromise: Promise<IDBDatabase> | null = null;
const outdatedListeners = new Set<() => void>();

/** Called when another tab opened a newer version of the database. */
export function onDbOutdated(fn: () => void): () => void {
  outdatedListeners.add(fn);
  return () => outdatedListeners.delete(fn);
}

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB, so Flickwise cannot save anything.'));
      return;
    }
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = (event) => {
      const db = open.result;
      const tx = open.transaction!;
      for (let v = event.oldVersion + 1; v <= DB_VERSION; v++) MIGRATIONS[v]?.(db, tx);
    };
    open.onsuccess = () => {
      const db = open.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
        outdatedListeners.forEach((fn) => fn());
      };
      resolve(db);
    };
    open.onerror = () => reject(open.error ?? new Error('Could not open the database.'));
    open.onblocked = () => reject(new Error('The database is blocked by another tab. Close other Flickwise tabs and reload.'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

/** Closes the connection and deletes the whole database. Used by tests and by nothing else. */
export async function deleteDatabase(): Promise<void> {
  if (dbPromise) {
    try {
      (await dbPromise).close();
    } catch {
      // already failed to open
    }
    dbPromise = null;
  }
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
    r.onblocked = () => resolve();
  });
}

export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted.'));
  });
}

/** Runs fn in one transaction and resolves with its result once the transaction has committed. */
export async function withTx<T>(
  stores: StoreName | StoreName[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(stores, mode);
  const done = txDone(tx);
  let result: T;
  try {
    result = await fn(tx);
  } catch (e) {
    try {
      tx.abort();
    } catch {
      // already finished
    }
    done.catch(() => undefined);
    throw e;
  }
  await done;
  return result;
}

export function getAll<T>(tx: IDBTransaction, store: StoreName, range?: IDBKeyRange, index?: string): Promise<T[]> {
  const s = tx.objectStore(store);
  return req((index ? s.index(index) : s).getAll(range));
}
