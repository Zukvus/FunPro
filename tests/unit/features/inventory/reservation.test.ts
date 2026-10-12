import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/core/db/db';
import { onEvent } from '@/core/events/bus';
import { importItems } from '@/features/inventory/items';
import { checkLowStock, rearmLowStock, stockBucket } from '@/features/inventory/lowstock';
import { findPoolForOrder, parseOrderQuantity } from '@/features/inventory/pools';
import { itemsNeeded, releaseDelivery, reserveForOrder } from '@/features/inventory/reservation';
import type { DomainEvent } from '@/shared/models';
import { addOrder, freshDb, makePool } from './helpers';

beforeEach(() => {
  freshDb();
});

const reserve = (orderId: string, pool: Awaited<ReturnType<typeof makePool>>, quantity = 1) =>
  reserveForOrder({ orderId, pool, quantity, buyerId: '555', buyerName: 'b' });

describe('reservation', () => {
  it('reserves FIFO items in one transaction and is idempotent per order', async () => {
    const pool = await makePool({ itemsPerUnit: 2 });
    await importItems(pool.id, ['i1', 'i2', 'i3', 'i4', 'i5']);
    const first = await reserve('ORD1', pool);
    expect(first.kind).toBe('created');
    expect(first.delivery.itemIds).toHaveLength(2);
    const again = await reserve('ORD1', pool);
    expect(again.kind).toBe('existing');
    expect(again.delivery.itemIds).toEqual(first.delivery.itemIds);
    const reserved = await getDb().inventoryItems.where('orderId').equals('ORD1').toArray();
    expect(reserved).toHaveLength(2);
    expect(reserved.every((i) => i.status === 'reserved' && i.reservedAt)).toBe(true);
  });

  it('never assigns the same item twice under concurrency (different orders)', async () => {
    const pool = await makePool({ itemsPerUnit: 2 });
    await importItems(pool.id, ['c1', 'c2', 'c3', 'c4']);
    const [a, b] = await Promise.all([reserve('A1', pool), reserve('B1', pool)]);
    expect(a.kind).toBe('created');
    expect(b.kind).toBe('created');
    const all = [...a.delivery.itemIds, ...b.delivery.itemIds];
    expect(new Set(all).size).toBe(4);
    expect(await getDb().inventoryItems.where('status').equals('available').count()).toBe(0);
  });

  it('under contention the loser waits for stock instead of sharing items', async () => {
    const pool = await makePool({ itemsPerUnit: 2 });
    await importItems(pool.id, ['s1', 's2', 's3']);
    const results = await Promise.all([reserve('X1', pool), reserve('X2', pool), reserve('X3', pool)]);
    const created = results.filter((r) => r.kind === 'created');
    const oos = results.filter((r) => r.kind === 'out_of_stock');
    expect(created).toHaveLength(1);
    expect(oos).toHaveLength(2);
    for (const r of oos) {
      expect(r.delivery.status).toBe('manual');
      expect(r.delivery.itemIds).toEqual([]);
      expect(r.delivery.reason).toBe('out_of_stock');
    }
    const reserved = await getDb().inventoryItems.where('status').equals('reserved').toArray();
    expect(reserved).toHaveLength(2);
    expect(new Set(reserved.map((i) => i.orderId)).size).toBe(1);
  });

  it('concurrent reservations of the SAME order create exactly one delivery', async () => {
    const pool = await makePool();
    await importItems(pool.id, ['q1', 'q2', 'q3']);
    const results = await Promise.all([reserve('SAME', pool), reserve('SAME', pool), reserve('SAME', pool)]);
    expect(results.filter((r) => r.kind === 'created')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'existing')).toHaveLength(2);
    expect(await getDb().inventoryItems.where('orderId').equals('SAME').count()).toBe(1);
    expect(await getDb().deliveries.count()).toBe(1);
  });

  it('refills an out-of-stock delivery only on explicit request', async () => {
    const pool = await makePool();
    const oos = await reserve('R1', pool);
    expect(oos.kind).toBe('out_of_stock');
    await importItems(pool.id, ['late-stock']);
    expect((await reserve('R1', pool)).kind).toBe('existing');
    const refill = await reserveForOrder({
      orderId: 'R1',
      pool,
      quantity: 1,
      buyerId: '555',
      buyerName: 'b',
      refill: true,
    });
    expect(refill.kind).toBe('created');
    expect(refill.delivery.status).toBe('reserved');
  });

  it('release returns items to stock and refuses sent deliveries', async () => {
    const pool = await makePool();
    await importItems(pool.id, ['r1']);
    await reserve('REL', pool);
    const rel = await releaseDelivery('REL', 'test');
    expect(rel?.released).toBe(1);
    expect(rel?.delivery.status).toBe('cancelled');
    expect(await getDb().inventoryItems.where('status').equals('available').count()).toBe(1);

    await reserve('REL2', pool);
    await getDb().deliveries.update('REL2', { status: 'sent' });
    await expect(releaseDelivery('REL2', 'test')).rejects.toThrow();
    await getDb().deliveries.update('REL2', { status: 'uncertain' });
    await expect(releaseDelivery('REL2', 'test')).rejects.toThrow(/uncertain/);
    expect((await releaseDelivery('REL2', 'test', { allowUncertain: true }))?.released).toBe(1);
  });

  it('computes needed items with a hard cap', () => {
    expect(itemsNeeded(3, 2)).toBe(6);
    expect(itemsNeeded(0, 1)).toBe(1);
    expect(itemsNeeded(10_000, 10)).toBe(500);
  });
});

describe('pool matching', () => {
  it('parses quantities from FunPay descriptions', () => {
    expect(parseOrderQuantity('Steam key, 3 шт.')).toBe(3);
    expect(parseOrderQuantity('Gems 100, 2 pcs.')).toBe(2);
    expect(parseOrderQuantity('Gems 100')).toBe(1);
    // Numbers inside the title are never quantities (only FunPay's trailing suffix counts).
    expect(parseOrderQuantity('Steam key bundle 10 pcs')).toBe(1);
    expect(parseOrderQuantity('Gold 1000 units')).toBe(1);
    expect(parseOrderQuantity('Gold 1000 units, 2 шт.')).toBe(2);
  });

  it('prefers listing id, then listing title, then the longest keyword; ties are ambiguous', async () => {
    await getDb().listings.add({
      id: '777',
      nodeId: '1',
      gameId: '1',
      categoryName: 'Steam',
      title: 'Cyberpunk 2077 Steam key',
      price: { amountMinor: 100, currency: 'RUB' },
      amount: null,
      active: true,
      promoted: false,
      autoDelivery: false,
      costMinor: null,
      sortIndex: 0,
      seenAt: '',
      updatedAt: '',
    });
    const byListing = await makePool({ name: 'CP', listingIds: ['777'], matchText: [] });
    const kw = await makePool({ name: 'KW', matchText: ['steam', 'steam key'] });
    expect(
      await findPoolForOrder({ listingId: '777', description: 'whatever', categoryName: '' }),
    ).toMatchObject({ kind: 'match', via: 'listing', pool: { id: byListing.id } });
    expect(
      await findPoolForOrder({
        listingId: null,
        description: 'Cyberpunk 2077 Steam key, 2 шт.',
        categoryName: 'Steam',
      }),
    ).toMatchObject({ kind: 'match', via: 'title', pool: { id: byListing.id } });
    expect(
      await findPoolForOrder({ listingId: null, description: 'Random steam key', categoryName: '' }),
    ).toMatchObject({ kind: 'match', via: 'keyword', pool: { id: kw.id } });
    await makePool({ name: 'KW2', matchText: ['steam key'] });
    expect(
      (await findPoolForOrder({ listingId: null, description: 'Random steam key', categoryName: '' })).kind,
    ).toBe('ambiguous');
    expect(
      (await findPoolForOrder({ listingId: null, description: 'Nothing related', categoryName: '' })).kind,
    ).toBe('none');
  });
});

describe('low stock', () => {
  it('buckets and dedupes INVENTORY_LOW per cycle, re-arming after a restock', async () => {
    const events: DomainEvent[] = [];
    onEvent('INVENTORY_LOW', (e) => {
      events.push(e);
    });
    expect(stockBucket(0, 2)).toBe('empty');
    expect(stockBucket(2, 2)).toBe('low');
    expect(stockBucket(3, 2)).toBeNull();
    const pool = await makePool({ lowStockThreshold: 2 });
    await importItems(pool.id, ['l1', 'l2', 'l3', 'l4']);
    for (const id of ['O1', 'O2', 'O3', 'O4']) {
      await addOrder(id);
      await reserve(id, pool);
      await checkLowStock(pool.id);
      await checkLowStock(pool.id); // repeated checks never duplicate
    }
    expect(events.map((e) => e.payload['bucket'])).toEqual(['low', 'empty']);
    expect(events[0]!.id).toBe(`INVENTORY_LOW:${pool.id}:0:low`);
    const notes = await getDb().notifications.toArray();
    expect(notes.filter((n) => n.kind === 'inventory')).toHaveLength(2);

    await importItems(pool.id, ['n1', 'n2', 'n3', 'n4']);
    await rearmLowStock(pool);
    await reserve('O5', pool);
    await reserve('O6', pool);
    await checkLowStock(pool.id);
    expect(events.map((e) => e.id)).toEqual([
      `INVENTORY_LOW:${pool.id}:0:low`,
      `INVENTORY_LOW:${pool.id}:0:empty`,
      `INVENTORY_LOW:${pool.id}:1:low`,
    ]);
  });
});
