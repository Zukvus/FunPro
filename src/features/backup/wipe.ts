import { storage } from 'wxt/utils/storage';
import { getDb } from '@/core/db/db';
import { resetCryptoCache } from '@/core/security/crypto';

export { WIPE_CONFIRMATION } from '@/core/messaging/rpc/settings';

export interface WipeResult {
  tablesCleared: number;
  rowsDeleted: number;
}

/**
 * Delete ALL local FunPro data: every IndexedDB table (including secrets, encryption keys, uploaded
 * assets, logs and the task queue) plus browser.storage.local and browser.storage.session.
 * Data on funpay.com is not affected. Must run in the background context so its in-memory caches
 * are reset too; extension pages reload afterwards.
 */
export async function wipeAllLocalData(): Promise<WipeResult> {
  const db = getDb();
  let rowsDeleted = 0;
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      rowsDeleted += await table.count();
      await table.clear();
    }
  });
  await storage.clear('local');
  await storage.clear('session');
  // The cached device key now refers to a deleted key; drop it so a fresh one is created on demand.
  resetCryptoCache();
  return { tablesCleared: db.tables.length, rowsDeleted };
}
