/**
 * Low-stock alerts. INVENTORY_LOW is emitted with the dedupe key `<poolId>:<gen>:<bucket>`:
 *  - bucket `low` (available ≤ threshold) and `empty` (available = 0) each fire once per cycle;
 *  - the cycle counter `gen` advances when stock is replenished above the threshold, so the next
 *    shortage alerts again. State lives in kv `invlow:<poolId>`.
 */
import { getDb } from '@/core/db/db';
import { emitEvent } from '@/core/events/bus';
import { notify } from '@/features/notifications/notify';
import { toPool, type Pool } from './model';

export type StockBucket = 'low' | 'empty';

export function stockBucket(available: number, threshold: number): StockBucket | null {
  if (available <= 0) return 'empty';
  if (available <= threshold) return 'low';
  return null;
}

interface LowState {
  gen: number;
  last: StockBucket | null;
}

async function readState(poolId: string): Promise<LowState> {
  const rec = await getDb().kv.get(`invlow:${poolId}`);
  const v = rec?.value as Partial<LowState> | undefined;
  return {
    gen: typeof v?.gen === 'number' ? v.gen : 0,
    last: v?.last === 'low' || v?.last === 'empty' ? v.last : null,
  };
}

async function writeState(poolId: string, s: LowState): Promise<void> {
  await getDb().kv.put({ key: `invlow:${poolId}`, value: s });
}

export async function availableCount(poolId: string): Promise<number> {
  return getDb().inventoryItems.where('[poolId+status]').equals([poolId, 'available']).count();
}

/** Re-arm alerts after a restock (safe to call from any context; emits nothing). */
export async function rearmLowStock(pool: Pool): Promise<void> {
  const available = await availableCount(pool.id);
  const s = await readState(pool.id);
  if (stockBucket(available, pool.lowStockThreshold) === null && s.last !== null)
    await writeState(pool.id, { gen: s.gen + 1, last: null });
}

export interface LowStockResult {
  available: number;
  bucket: StockBucket | null;
  emitted: boolean;
}

/**
 * Evaluate a pool and emit INVENTORY_LOW (+ a notification) when it enters a new bucket.
 * Call from the background so workflow rules and notification sinks see the event.
 */
export async function checkLowStock(
  poolOrId: Pool | string,
  opts: { notify?: boolean } = {},
): Promise<LowStockResult> {
  const db = getDb();
  const raw = typeof poolOrId === 'string' ? await db.inventoryPools.get(poolOrId) : poolOrId;
  if (!raw) return { available: 0, bucket: null, emitted: false };
  const pool = toPool(raw);
  const available = await availableCount(pool.id);
  const bucket = stockBucket(available, pool.lowStockThreshold);
  const s = await readState(pool.id);
  if (bucket === null) {
    if (s.last !== null) await writeState(pool.id, { gen: s.gen + 1, last: null });
    return { available, bucket, emitted: false };
  }
  if (s.last !== bucket) await writeState(pool.id, { gen: s.gen, last: bucket });
  const emitted = await emitEvent('INVENTORY_LOW', `${pool.id}:${s.gen}:${bucket}`, {
    poolId: pool.id,
    poolName: pool.name,
    available,
    threshold: pool.lowStockThreshold,
    bucket,
  });
  if (emitted && opts.notify !== false) {
    await notify({
      kind: 'inventory',
      title: bucket === 'empty' ? `Out of stock: ${pool.name}` : `Low stock: ${pool.name}`,
      body:
        bucket === 'empty'
          ? 'No items left. New paid orders for this pool will wait for stock.'
          : `${available} item(s) left (threshold ${pool.lowStockThreshold}).`,
      dedupeKey: `inventory:${pool.id}:${s.gen}:${bucket}`,
    });
  }
  return { available, bucket, emitted };
}
