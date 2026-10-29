import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';

// Checks that IndexedDB keeps typed arrays as typed arrays, which the detail columns rely on.
describe('typed array round trip', () => {
  it('stores and returns typed arrays with their types and NaN values', async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('roundtrip-check', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('s', { keyPath: 'id' });
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const value = {
      id: 'a',
      f: new Float32Array([1.5, NaN, -3.25]),
      u16: new Uint16Array([0, 65535]),
      u8: new Uint8Array([255, 1]),
      i16: new Int16Array([-1, 5]),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('s', 'readwrite');
      tx.objectStore('s').put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const got = await new Promise<typeof value>((resolve, reject) => {
      const r = db.transaction('s').objectStore('s').get('a');
      r.onsuccess = () => resolve(r.result as typeof value);
      r.onerror = () => reject(r.error);
    });
    expect(got.f).toBeInstanceOf(Float32Array);
    expect(got.u16).toBeInstanceOf(Uint16Array);
    expect(got.u8).toBeInstanceOf(Uint8Array);
    expect(got.i16).toBeInstanceOf(Int16Array);
    expect(Array.from(got.f).map((v) => (Number.isNaN(v) ? 'nan' : v))).toEqual([1.5, 'nan', -3.25]);
    expect(Array.from(got.u16)).toEqual([0, 65535]);
    db.close();
  });
});
