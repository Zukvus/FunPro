/**
 * Inventory pools: CRUD and order → pool matching.
 */
import { getDb } from '@/core/db/db';
import { newId } from '@/core/util/id';
import type { Order } from '@/shared/models';
import { PoolSchema, toPool, type Pool } from './model';

export interface PoolInput {
  name: string;
  listingIds: string[];
  lowStockThreshold: number;
  deliveryTemplate: string;
  itemsPerUnit: number;
  matchText: string[];
  autoReserve: boolean;
}

export async function listPools(): Promise<Pool[]> {
  const rows = await getDb().inventoryPools.toArray();
  return rows.map(toPool).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getPool(id: string): Promise<Pool | null> {
  const raw = await getDb().inventoryPools.get(id);
  return raw ? toPool(raw) : null;
}

/** A listing can feed at most one pool, otherwise reservation would be ambiguous. */
async function assertListingsFree(listingIds: readonly string[], selfId: string | null): Promise<void> {
  const pools = await listPools();
  for (const p of pools) {
    if (p.id === selfId) continue;
    const clash = p.listingIds.find((l) => listingIds.includes(l));
    if (clash) throw new Error(`Listing ${clash} is already linked to pool "${p.name}"`);
  }
}

export async function createPool(input: PoolInput, now = new Date()): Promise<Pool> {
  const at = now.toISOString();
  const pool = PoolSchema.parse({
    ...normalizeInput(input),
    id: newId('pool'),
    createdAt: at,
    updatedAt: at,
  });
  await assertListingsFree(pool.listingIds, null);
  await getDb().inventoryPools.add(pool);
  return pool;
}

export async function updatePool(id: string, input: PoolInput, now = new Date()): Promise<Pool> {
  const existing = await getPool(id);
  if (!existing) throw new Error('Pool not found');
  const pool = PoolSchema.parse({ ...existing, ...normalizeInput(input), id, updatedAt: now.toISOString() });
  await assertListingsFree(pool.listingIds, id);
  await getDb().inventoryPools.put(pool);
  return pool;
}

function normalizeInput(input: PoolInput): PoolInput {
  return {
    ...input,
    name: input.name.trim(),
    listingIds: Array.from(new Set(input.listingIds.map((s) => s.trim()).filter(Boolean))),
    matchText: Array.from(new Set(input.matchText.map((s) => s.trim()).filter(Boolean))),
  };
}

/**
 * Delete a pool and its items. Refused while any item is reserved for an order (finish or release
 * those deliveries first) — deleting would silently drop goods a buyer has paid for.
 */
export async function deletePool(id: string): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.inventoryPools, db.inventoryItems, db.kv, async () => {
    const reserved = await db.inventoryItems.where('[poolId+status]').equals([id, 'reserved']).count();
    if (reserved > 0)
      throw new Error(
        `${reserved} item(s) are reserved for orders — finish or release those deliveries first`,
      );
    await db.inventoryItems.where('poolId').equals(id).delete();
    await db.inventoryPools.delete(id);
    await db.kv.delete(`invlow:${id}`);
  });
}

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------

const QTY_RE = /(\d{1,5})\s*(?:шт|pcs|pc|units?)\.?(?![\p{L}])/giu;

/** Quantity from FunPay order descriptions (", 3 шт." / "3 pcs."). Defaults to 1. */
export function parseOrderQuantity(description: string): number {
  let qty = 1;
  for (const m of description.matchAll(QTY_RE)) qty = Number(m[1]);
  return Number.isFinite(qty) && qty >= 1 ? Math.min(qty, 1000) : 1;
}

/** Order description without the trailing quantity suffix, lower-cased, whitespace collapsed. */
export function normalizeTitle(text: string): string {
  return text
    .replace(QTY_RE, ' ')
    .toLowerCase()
    .replace(/[\s,.;:!]+/g, ' ')
    .trim();
}

export type PoolMatch =
  | { kind: 'match'; pool: Pool; via: 'listing' | 'title' | 'keyword'; score: number }
  | { kind: 'ambiguous'; pools: Pool[] }
  | { kind: 'none' };

export interface MatchOptions {
  /** Only consider pools with autoReserve on (automatic reservation). */
  autoOnly?: boolean;
}

/**
 * Find the pool for an order:
 *  1. the pool linked to the order's listing id (exact);
 *  2. a pool whose linked listing title equals the order description (FunPay uses the offer title);
 *  3. keyword phrases (longest matching phrase wins).
 * Ties at the best score are reported as ambiguous — FunPro never guesses which goods to send.
 */
export async function findPoolForOrder(
  order: Pick<Order, 'listingId' | 'description' | 'categoryName'>,
  opts: MatchOptions = {},
): Promise<PoolMatch> {
  const db = getDb();
  const pools = (await listPools()).filter((p) => !opts.autoOnly || p.autoReserve);
  if (pools.length === 0) return { kind: 'none' };
  if (order.listingId) {
    const linked = pools.find((p) => p.listingIds.includes(order.listingId!));
    if (linked) return { kind: 'match', pool: linked, via: 'listing', score: Number.MAX_SAFE_INTEGER };
  }
  const desc = normalizeTitle(order.description);
  const haystack = `${order.description} ${order.categoryName}`.toLowerCase();
  const scored: { pool: Pool; score: number; via: 'title' | 'keyword' }[] = [];
  const allListingIds = pools.flatMap((p) => p.listingIds);
  const listings = allListingIds.length ? await db.listings.bulkGet(allListingIds) : [];
  const titleById = new Map<string, string>();
  listings.forEach((l) => {
    if (l) titleById.set(l.id, normalizeTitle(l.title));
  });
  for (const p of pools) {
    if (
      desc &&
      p.listingIds.some((id) => {
        const t = titleById.get(id);
        return (
          !!t &&
          (t === desc || (desc.length >= 8 && t.startsWith(desc)) || (t.length >= 8 && desc.startsWith(t)))
        );
      })
    ) {
      scored.push({ pool: p, score: 1_000_000, via: 'title' });
      continue;
    }
    let best = 0;
    for (const phrase of p.matchText) {
      const ph = phrase.toLowerCase().trim();
      if (ph && haystack.includes(ph)) best = Math.max(best, ph.length);
    }
    if (best > 0) scored.push({ pool: p, score: best, via: 'keyword' });
  }
  if (scored.length === 0) return { kind: 'none' };
  const top = Math.max(...scored.map((s) => s.score));
  const winners = scored.filter((s) => s.score === top);
  if (winners.length > 1) return { kind: 'ambiguous', pools: winners.map((w) => w.pool) };
  const w = winners[0]!;
  return { kind: 'match', pool: w.pool, via: w.via, score: w.score };
}
