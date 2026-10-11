/**
 * Stock reservation. All state changes happen inside ONE Dexie transaction over `deliveries` and
 * `inventoryItems`, so:
 *  - an order is reserved at most once (deliveries PK = orderId ⇒ idempotent per order);
 *  - an item is never assigned twice (IndexedDB serialises overlapping read-write transactions and
 *    every item's status is re-checked before it is taken).
 */
import { getDb } from '@/core/db/db';
import type { InventoryItem } from '@/shared/models';
import { toDelivery, type DeliveryRecord, type Pool } from './model';

export interface ReserveInput {
  orderId: string;
  pool: Pool;
  quantity: number;
  buyerId: string | null;
  buyerName: string;
  now?: number;
  /**
   * Explicit seller action: re-try a delivery that is waiting for stock (status `manual`, no items).
   * Never used by automatic handlers.
   */
  refill?: boolean;
}

export type ReserveOutcome =
  | { kind: 'created'; delivery: DeliveryRecord }
  | { kind: 'existing'; delivery: DeliveryRecord }
  | { kind: 'out_of_stock'; delivery: DeliveryRecord; needed: number; available: number };

/** Hard cap: one order never takes more than this many items. */
export const MAX_ITEMS_PER_ORDER = 500;

export function itemsNeeded(quantity: number, itemsPerUnit: number): number {
  return Math.min(MAX_ITEMS_PER_ORDER, Math.max(1, Math.trunc(quantity)) * Math.max(1, Math.trunc(itemsPerUnit)));
}

export async function reserveForOrder(input: ReserveInput): Promise<ReserveOutcome> {
  const db = getDb();
  const now = input.now ?? Date.now();
  const at = new Date(now).toISOString();
  const needed = itemsNeeded(input.quantity, input.pool.itemsPerUnit);
  return db.transaction('rw', db.deliveries, db.inventoryItems, async (): Promise<ReserveOutcome> => {
    const existingRaw = await db.deliveries.get(input.orderId);
    const existing = existingRaw ? toDelivery(existingRaw) : null;
    if (existing && !(input.refill && existing.status === 'manual' && existing.itemIds.length === 0)) {
      return { kind: 'existing', delivery: existing };
    }
    const candidates = await db.inventoryItems.where('[poolId+status]').equals([input.pool.id, 'available']).limit(needed).toArray();
    const free = candidates.filter((i) => i.status === 'available' && i.orderId === null && i.poolId === input.pool.id);
    const base: DeliveryRecord = {
      ...(existing ?? {
        orderId: input.orderId,
        attempts: 0,
        createdAt: at,
        taskId: null,
        draftId: null,
        channel: 'none' as const,
        messagePreview: '',
        deliveredAt: null,
        refundedAt: null,
      }),
      orderId: input.orderId,
      poolId: input.pool.id,
      buyerId: input.buyerId,
      buyerName: input.buyerName,
      chatId: existing?.chatId ?? null,
      quantity: Math.max(1, Math.trunc(input.quantity)),
      itemIds: [],
      status: 'manual',
      lastError: null,
      reason: null,
      updatedAt: at,
    };
    if (free.length < needed) {
      const d: DeliveryRecord = { ...base, status: 'manual', reason: 'out_of_stock', lastError: `Not enough stock: needed ${needed}, available ${free.length}` };
      await db.deliveries.put(d);
      return { kind: 'out_of_stock', delivery: d, needed, available: free.length };
    }
    for (const item of free) {
      // Conditional update: only an item that is still available and unassigned can be taken.
      const changed = await db.inventoryItems
        .where('id')
        .equals(item.id)
        .and((i: InventoryItem) => i.status === 'available' && i.orderId === null)
        .modify({ status: 'reserved', orderId: input.orderId, reservedAt: at });
      if (changed !== 1) throw new Error('Inventory changed during reservation — retry');
    }
    const d: DeliveryRecord = { ...base, status: 'reserved', itemIds: free.map((i) => i.id) };
    await db.deliveries.put(d);
    return { kind: 'created', delivery: d };
  });
}

export type ReleaseResult = { released: number; delivery: DeliveryRecord } | null;

/**
 * Put a delivery's reserved items back into stock and mark the delivery `cancelled`.
 * Refuses `sent` deliveries, `sending` ones (cancel the task first) and — unless the seller
 * explicitly confirmed — `uncertain` ones (the goods may already be with the buyer).
 */
export async function releaseDelivery(orderId: string, reason: string, opts: { allowUncertain?: boolean; now?: number } = {}): Promise<ReleaseResult> {
  const db = getDb();
  const at = new Date(opts.now ?? Date.now()).toISOString();
  return db.transaction('rw', db.deliveries, db.inventoryItems, async () => {
    const raw = await db.deliveries.get(orderId);
    if (!raw) return null;
    const d = toDelivery(raw);
    if (d.status === 'cancelled') return { released: 0, delivery: d };
    if (d.status === 'sent') throw new Error('The goods were already delivered');
    if (d.status === 'sending') throw new Error('A send is in progress — wait for its outcome');
    if (d.status === 'uncertain' && !opts.allowUncertain) throw new Error('Delivery outcome is uncertain — check the chat first');
    let released = 0;
    for (const id of d.itemIds) {
      released += await db.inventoryItems
        .where('id')
        .equals(id)
        .and((i: InventoryItem) => i.status === 'reserved' && i.orderId === orderId)
        .modify({ status: 'available', orderId: null, reservedAt: null });
    }
    const next: DeliveryRecord = { ...d, status: 'cancelled', reason: reason, lastError: null, updatedAt: at };
    await db.deliveries.put(next);
    return { released, delivery: next };
  });
}

/** Items reserved → delivered and delivery → sent, atomically. */
export async function markItemsDelivered(orderId: string, now = Date.now()): Promise<DeliveryRecord | null> {
  const db = getDb();
  const at = new Date(now).toISOString();
  return db.transaction('rw', db.deliveries, db.inventoryItems, async () => {
    const raw = await db.deliveries.get(orderId);
    if (!raw) return null;
    const d = toDelivery(raw);
    if (d.status === 'sent') return d;
    if (d.status === 'cancelled') throw new Error('Delivery was cancelled');
    if (d.itemIds.length === 0) throw new Error('No items are reserved for this order');
    for (const id of d.itemIds) {
      await db.inventoryItems
        .where('id')
        .equals(id)
        .and((i: InventoryItem) => i.orderId === orderId && i.status === 'reserved')
        .modify({ status: 'delivered', deliveredAt: at });
    }
    const next: DeliveryRecord = { ...d, status: 'sent', deliveredAt: at, reason: null, lastError: null, updatedAt: at };
    await db.deliveries.put(next);
    return next;
  });
}

export async function getDelivery(orderId: string): Promise<DeliveryRecord | null> {
  const raw = await getDb().deliveries.get(orderId);
  return raw ? toDelivery(raw) : null;
}
