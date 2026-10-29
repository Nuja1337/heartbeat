// Drill storage. Evaluation lives in analytics/drillEval.ts.

import { getAll, req, withTx } from './db';
import type { Drill } from './schema';

export async function saveDrill(drill: Drill): Promise<void> {
  await withTx('drills', 'readwrite', (tx) => {
    tx.objectStore('drills').put(drill);
  });
}

export async function getDrill(id: string): Promise<Drill | undefined> {
  return withTx('drills', 'readonly', (tx) => req<Drill | undefined>(tx.objectStore('drills').get(id)));
}

/** Newest first. */
export async function listDrills(): Promise<Drill[]> {
  const rows = await withTx('drills', 'readonly', (tx) => getAll<Drill>(tx, 'drills'));
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteDrill(id: string): Promise<void> {
  await withTx('drills', 'readwrite', (tx) => {
    tx.objectStore('drills').delete(id);
  });
}
