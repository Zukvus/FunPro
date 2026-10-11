/**
 * Ingestion of OLD orders found by the deep history import.
 *
 * Safety: history is baseline by definition. These orders are written WITHOUT domain events, so no
 * automation (post-order messages, delivery, workflows) ever reacts to an order just because the
 * seller imported their history. Status changes discovered this way are recorded silently in the
 * order's history with `source: 'import'`.
 *
 * The first page of an import goes through the regular `ingestOrders` (it holds the newest orders
 * and establishes the baseline on a fresh install); only older pages use this function.
 */
import type { ParsedOrder } from '@/adapters/funpay/types';
import { getDb } from '@/core/db/db';
import { customerKey } from '@/features/sync/ingest';
import type { Customer, Order, OrderDirection } from '@/shared/models';
import { canTransition } from '@/shared/models/order';
import type { PageIngestResult } from './pagination';

export async function ingestHistoricalOrders(
  parsed: readonly ParsedOrder[],
  direction: OrderDirection,
  now = Date.now(),
): Promise<PageIngestResult> {
  const db = getDb();
  const at = new Date(now).toISOString();
  const result: PageIngestResult = { created: 0, updated: 0 };
  await db.transaction('rw', db.orders, db.customers, async () => {
    for (const p of parsed) {
      if (p.direction !== direction) continue;
      const existing = await db.orders.get(p.id);
      if (!existing) {
        const order: Order = {
          ...p,
          firstSeenAt: at,
          updatedAt: at,
          history: [{ status: p.status, at, source: 'import' }],
        };
        await db.orders.add(order);
        result.created++;
      } else {
        // Same merge rules as the regular ingestion: freshly fetched values win when present.
        const patch: Partial<Order> = {
          counterpartyName: p.counterpartyName || existing.counterpartyName,
          counterpartyId: p.counterpartyId ?? existing.counterpartyId,
          description: p.description || existing.description,
          categoryName: p.categoryName || existing.categoryName,
          price: p.price.currency === 'UNKNOWN' ? existing.price : p.price,
          createdAt: existing.createdAt ?? p.createdAt,
        };
        if (
          p.status !== existing.status &&
          p.status !== 'unknown' &&
          canTransition(existing.status, p.status)
        ) {
          patch.status = p.status;
          patch.history = [...existing.history, { status: p.status, at, source: 'import' }];
          patch.updatedAt = at;
          result.updated++;
        }
        await db.orders.update(p.id, patch);
      }
      if (direction === 'sale' && p.counterpartyName) {
        const key = customerKey(p.counterpartyId, p.counterpartyName);
        if (!(await db.customers.get(key))) {
          const c: Customer = {
            id: key,
            name: p.counterpartyName,
            tags: [],
            notes: '',
            pinned: false,
            followUpAt: null,
            followUpNote: '',
            firstSeenAt: at,
            lastSeenAt: at,
          };
          await db.customers.add(c);
        }
      }
    }
  });
  return result;
}
